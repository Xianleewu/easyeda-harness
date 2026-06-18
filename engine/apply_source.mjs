// Plexus 源式就地投递(沙箱):不用逐条 sch_PrimitiveWire.create(EDA 非确定性合并丢线),
// 而是改 EDA 文档源(setDocumentSource)——改 COMPONENT 位 + 复用现有 WIRE 组改/加 LINE 到
// 合成几何 + 改 Name ATTR,原子加载、零合并 → faithful live 投递。
// 实验确证:setDocumentSource 接受「改现有记录」「给现有组加 LINE」,拒「加顶层 WIRE」;源 y 取负。
import { readFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { executeCode } from './bridge_client.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');

// 解析源为记录数组(保序)。每行 `{head}||{data}|`。
function parseSource(src) {
	return String(src || '').split('\n').map((raw, i) => {
		const s = raw.indexOf('||');
		if (s < 0) return { raw, i, head: null, data: null };
		try { return { raw, i, head: JSON.parse(raw.slice(0, s)), data: JSON.parse(raw.slice(s + 2).replace(/\|$/, '')) }; }
		catch { return { raw, i, head: null, data: null }; }
	});
}
const emit = (head, data) => `${JSON.stringify(head)}||${JSON.stringify(data)}|`;
let hexCtr = 0x100000;
const hexId = () => ('a1b2' + (hexCtr++).toString(16).padStart(12, '0')).slice(0, 16);

// 合成模型(本地快照)。
function synth() {
	const snap = JSON.parse(readFileSync(`${ROOT}/live_clean.json`, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });
	const idByDes = new Map((snap.components || []).map(c => [c.designator, c.id]));
	return { r, idByDes };
}

// concatNamedPaths:整条 pin→label 路径拼一条命名折线(与 create 路径一致的几何)。
function concatNamedPaths(wires) {
	const used = new Set(); const result = [];
	for (const stub of wires) {
		if (!stub.net || stub.line.length !== 4) continue;
		const [ax, ay, bx, by] = stub.line; if (ay !== by) continue;
		for (const [ix, iy, fx, fy] of [[ax, ay, bx, by], [bx, by, ax, ay]]) {
			const esc = wires.find(w => !w.net && !used.has(w) && (w.line || []).length >= 4 && Math.abs(w.line[w.line.length - 2] - ix) < 1 && Math.abs(w.line[w.line.length - 1] - iy) < 1);
			if (esc) { used.add(esc); used.add(stub); result.push({ net: stub.net, line: [...esc.line, fx, fy] }); break; }
		}
	}
	for (const w of wires) if (!used.has(w)) result.push(w);
	return result;
}

function buildSource(src, r, idByDes) {
	const recs = parseSource(src);
	const placeBy = new Map(r.placements.map(p => [p.designator, p]));
	const synthWires = concatNamedPaths(r.model.wires);
	const dirty = new Set();   // 只重序列化被改的记录;未改的保留原 raw(否则细微格式差异致 setDocumentSource 整体回退)。

	// 1) 移器件:COMPONENT 记录 id → 设合成位(y 取负)。
	const idSet = new Set([...idByDes.entries()].filter(([d]) => placeBy.has(d)).map(([, id]) => id));
	const idToDes = new Map([...idByDes.entries()].map(([d, id]) => [id, d]));
	for (const rec of recs) {
		if (rec.head?.type !== 'COMPONENT' || !idSet.has(rec.head.id)) continue;
		const pl = placeBy.get(idToDes.get(rec.head.id));
		rec.data.x = pl.x; rec.data.y = -pl.y; rec.data.rotation = pl.rot || 0; rec.data.isMirror = !!pl.mirror;
		dirty.add(rec);
	}

	// 2) 现有 WIRE 组索引:wireId → {wireRec, lineRecs[], nameAttr}。
	const groups = new Map();
	for (const rec of recs) {
		if (rec.head?.type === 'WIRE') groups.set(rec.head.id, { wireRec: rec, lineRecs: [], nameAttr: null });
	}
	for (const rec of recs) {
		if (rec.head?.type === 'LINE' && groups.has(rec.data.lineGroup)) groups.get(rec.data.lineGroup).lineRecs.push(rec);
		if (rec.head?.type === 'ATTR' && rec.data.key === 'Name' && groups.has(rec.data.parentId)) groups.get(rec.data.parentId).nameAttr = rec;
	}
	const groupIds = [...groups.keys()];

	// 3) 复用前 N 个组承载合成线;改其 LINE 几何 + Name;多余 LINE 标删;不足则加 LINE。
	const drop = new Set();          // 要删除的记录(原始 raw 索引)
	const addAfter = new Map();      // 在某 raw 索引后插入的新行
	const cap = Math.min(synthWires.length, groupIds.length);
	for (let i = 0; i < cap; i++) {
		const w = synthWires[i]; const g = groups.get(groupIds[i]);
		const pts = []; for (let k = 0; k + 1 < w.line.length; k += 2) pts.push([w.line[k], -w.line[k + 1]]);  // y 取负
		const segCount = pts.length - 1;
		// 改/加/删 LINE:复用现有 LINE 记录改坐标,多则加,少则删。
		for (let s = 0; s < segCount; s++) {
			const [sx, sy] = pts[s], [ex, ey] = pts[s + 1];
			if (s < g.lineRecs.length) {
				const lr = g.lineRecs[s];
				lr.data.startX = sx; lr.data.startY = sy; lr.data.endX = ex; lr.data.endY = ey;
				dirty.add(lr);
			} else {
				// 加新 LINE 到本组(实验证明组内加 LINE 可行)。
				const nl = emit({ type: 'LINE', ticket: 900000 + hexCtr, id: hexId() },
					{ fillColor: null, fillStyle: null, strokeColor: null, strokeStyle: null, strokeWidth: null, startX: sx, startY: sy, endX: ex, endY: ey, lineGroup: groupIds[i] });
				const anchor = g.lineRecs[g.lineRecs.length - 1] || g.wireRec;
				if (!addAfter.has(anchor.i)) addAfter.set(anchor.i, []);
				addAfter.get(anchor.i).push(nl);
			}
		}
		for (let s = segCount; s < g.lineRecs.length; s++) drop.add(g.lineRecs[s].i);   // 多余段删
		// Name attr:命名线设 value=net;无名线清空。
		if (g.nameAttr) { g.nameAttr.data.value = w.net || ''; dirty.add(g.nameAttr); }
	}
	// 4) 多余的 WIRE 组(synth 不足时)→ 删其 wire+line+name。
	for (let i = cap; i < groupIds.length; i++) {
		const g = groups.get(groupIds[i]);
		drop.add(g.wireRec.i); for (const lr of g.lineRecs) drop.add(lr.i); if (g.nameAttr) drop.add(g.nameAttr.i);
	}

	// 5) 重组源(改 data 已就地;删/加按 raw 索引)。
	const out = [];
	for (const rec of recs) {
		if (drop.has(rec.i)) { /* 删 */ }
		else if (rec.head && dirty.has(rec)) out.push(emit(rec.head, rec.data));   // 只重序列化改过的
		else out.push(rec.raw);                                                     // 未改的保留原 raw(关键)
		for (const nl of (addAfter.get(rec.i) || [])) out.push(nl);
	}
	return { newSrc: out.join('\n'), delivered: cap, synthWireCount: synthWires.length, groupCount: groupIds.length };
}

export async function applySource() {
	const { r, idByDes } = synth();
	const { result: src } = await executeCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 60000 });
	const { newSrc, delivered, synthWireCount, groupCount } = buildSource(src, r, idByDes);
	console.log(`源式投递:合成线=${synthWireCount} 现有组=${groupCount} 投递=${delivered}（封顶 min）`);
	const code = `await eda.sys_FileManager.setDocumentSource(${JSON.stringify(newSrc)}); return { ok: true };`;
	const { result } = await executeCode(code, { timeoutMs: 90000 });
	console.log('setDocumentSource:', JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	applySource().catch(e => { console.error('源式投递失败:', e.message); process.exit(1); });
}
