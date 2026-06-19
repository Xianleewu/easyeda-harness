// Plexus 源式就地投递(沙箱):不用逐条 sch_PrimitiveWire.create(EDA 非确定性合并丢线),
// 而是改 EDA 文档源(setDocumentSource)——改 COMPONENT 位 + 复用现有 WIRE 组改/加 LINE 到
// 合成几何 + 改 Name ATTR,原子加载、零合并 → faithful live 投递。
// 实验确证:setDocumentSource 接受「改现有记录」「给现有组加 LINE」,拒「加顶层 WIRE」;源 y 取负。
//
// ⚠️ 可靠性(实测校正):setDocumentSource 是**非确定性**的——同一源、同一改动,有时生效有时
//    `ok:true` 却静默整体回退(早先误判为「只在自然源生效」,但 `--undo`(自然源)→ apply 也偶尔
//    回退;且往返归一化只改 DOCHEAD client id + 少数 ATTR 的 bbox 重算,结构/记录数全保留、无害)。
//    **正解 = `--robust`**:投递后自检(回读源验证首器件移位),回退则 `--undo` 重建源+重试(有界 3 次)。
//    可靠用法:`node engine/apply_source.mjs --robust`。还原:`plexus_apply_live.mjs --undo`。
//    实测成果:画布 1232×909→3076×2291(紧凑 1.34=美观)、extract floating 41 ≤ 原图 42 = 完全等价。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { wireConnectivity } from './wire_connectivity.mjs';
import { executeCode } from './bridge_client.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
// 被投板的捕获快照:可配置(服务「任意原理图」——捕获任意板→指 EASYEDA_APPLY_MODEL→合成投递),默认 live_clean.json。
const APPLY_MODEL = process.env.EASYEDA_APPLY_MODEL || `${ROOT}/live_clean.json`;

// 解析源为记录数组(保序)。每行 `{head}||{data}|`。
export function parseSource(src) {
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
	const snap = JSON.parse(readFileSync(APPLY_MODEL, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });
	const idByDes = new Map((snap.components || []).map(c => [c.designator, c.id]));
	return { r, idByDes, logical, contract };
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

export function buildSource(src, r, idByDes) {
	const recs = parseSource(src);
	const placeBy = new Map(r.placements.map(p => [p.designator, p]));
	const synthWires = concatNamedPaths(r.model.wires);
	const dirty = new Set();   // 只重序列化被改的记录;未改的保留原 raw(否则细微格式差异致 setDocumentSource 整体回退)。
	const expectedLines = [];  // 记录写入的每条 LINE 段 [groupId,sx,sy,ex,ey](源 y 已取负),供投递后直接核对线落地。

	// 1) 移器件:COMPONENT 记录 id → 设合成位(y 取负)。记录实际命中的 id,供预检漏匹配。
	const idSet = new Set([...idByDes.entries()].filter(([d]) => placeBy.has(d)).map(([, id]) => id));
	const idToDes = new Map([...idByDes.entries()].map(([d, id]) => [id, d]));
	const movedIds = new Set();
	for (const rec of recs) {
		if (rec.head?.type !== 'COMPONENT' || !idSet.has(rec.head.id)) continue;
		const pl = placeBy.get(idToDes.get(rec.head.id));
		rec.data.x = pl.x; rec.data.y = -pl.y; rec.data.rotation = pl.rot || 0; rec.data.isMirror = !!pl.mirror;
		dirty.add(rec); movedIds.add(rec.head.id);
	}
	// 漏匹配的器件(live 文档与 live_clean 项目不一致 → id 对不上):全部该移而未命中的。
	const missingDes = [...placeBy.keys()].filter(d => { const id = idByDes.get(d); return !id || !movedIds.has(id); });

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
			expectedLines.push([groupIds[i], sx, sy, ex, ey]);
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
		// Name attr:命名线设 value=net(连通靠同名)。无 Name attr 的组暂不补(批量加 ATTR 会破坏
		// setDocumentSource 一致性致整体回退;单条可行,批量待查)→ 这些线靠几何 + 网标连通。
		if (g.nameAttr) { g.nameAttr.data.value = w.net || ''; dirty.add(g.nameAttr); }
	}
	// 4a) 槽不够时,把溢出合成线的段并入同网的现有组(WIRE 组=一个网,同网段共网→脚连通,
	//     不占新槽)。实测溢出 4 条全是电源/地(GND/+5V/VCC_3V3),都有同网组可并 → 达 floating 42。
	const netToGroup = new Map();
	for (let i = 0; i < cap; i++) { const n = synthWires[i].net; if (n && !netToGroup.has(n)) netToGroup.set(n, groupIds[i]); }
	let packed = 0; const droppedOverflow = []; const droppedWires = new Set();
	for (let i = cap; i < synthWires.length; i++) {
		const w = synthWires[i]; const gid = netToGroup.get(w.net);
		if (!gid) { droppedOverflow.push(w.net || '(无名)'); droppedWires.add(w); continue; }   // 无同网组可并 → 静默丢会断脚,显式记录
		const g = groups.get(gid);
		const pts = []; for (let k = 0; k + 1 < w.line.length; k += 2) pts.push([w.line[k], -w.line[k + 1]]);
		for (let s = 0; s < pts.length - 1; s++) {
			const [sx, sy] = pts[s], [ex, ey] = pts[s + 1];
			expectedLines.push([gid, sx, sy, ex, ey]);
			const nl = emit({ type: 'LINE', ticket: 900500 + hexCtr, id: hexId() },
				{ fillColor: null, fillStyle: null, strokeColor: null, strokeStyle: null, strokeWidth: null, startX: sx, startY: sy, endX: ex, endY: ey, lineGroup: gid });
			const anchor = g.lineRecs[g.lineRecs.length - 1] || g.wireRec;
			if (!addAfter.has(anchor.i)) addAfter.set(anchor.i, []);
			addAfter.get(anchor.i).push(nl);
		}
		packed++;
	}
	// 4b) 多余的 WIRE 组(synth 不足时)→ 删其 wire+line+name。
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
	// 投递态线集 = 合成线减去丢弃的(cap 内全投 + 溢出并组都投,只有无同网组的溢出被丢)→ 供「投递态」忠实/连通评估。
	const deliveredWires = synthWires.filter(w => !droppedWires.has(w));
	const droppedNamed = [...droppedWires].filter(w => w.net).map(w => w.net);
	return { newSrc: out.join('\n'), delivered: cap, synthWireCount: synthWires.length, groupCount: groupIds.length, packed, droppedOverflow, droppedNamed, deliveredWires, missingDes, expectedLines };
}

// 投递一次:取源 → 变换 → setDocumentSource → 自检。返回是否生效。
async function deliverOnce(r, idByDes) {
	const { result: src } = await executeCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 60000 });
	const { newSrc, delivered, synthWireCount, groupCount, packed, missingDes, expectedLines } = buildSource(src, r, idByDes);
	console.log(`源式投递:合成线=${synthWireCount} 现有组=${groupCount} 投递=${delivered}+并组${packed}（封顶 min,溢出同网并组）`);
	// 预检:live 文档器件 id 与 live_clean 项目不一致 → fail-loud,别投出半套垃圾。
	if (missingDes.length) {
		console.error(`✗ 预检失败:${missingDes.length} 个器件 id 在 live 文档中找不到(${missingDes.slice(0, 6).join(',')}…)`
			+ `——live 文档与被投快照(${APPLY_MODEL})不是同一项目?请确认已打开对应工程。中止本次投递。`);
		return false;
	}
	// (溢出丢线的分类警告由 applySource 在投递态质量门处统一报告,这里不重复。)
	await executeCode(`await eda.sys_FileManager.setDocumentSource(${JSON.stringify(newSrc)}); return { ok: true };`, { timeoutMs: 90000 });
	// 自检:回读源,深度验证(setDocumentSource 是非确定性的——ok 却静默回退,且可能**部分**生效)。
	// ① 所有被投器件都到合成位;② 所有写入的 LINE 段都在对应组——**线落地是直接核对、非靠器件推断**
	// (自洽=电气正确是北极星,getNetlist 又被平台封,故对电气内容做直接验证)。任一未达即判回退、触发重试。
	const { result: back } = await executeCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 60000 });
	const parsed = parseSource(back);
	const byId = new Map(parsed.filter(x => x.head?.type === 'COMPONENT').map(x => [x.head.id, x.data]));
	let landed = 0; const stray = [];
	for (const pl of r.placements) {
		const rec = byId.get(idByDes.get(pl.designator));
		if (rec && Math.abs(rec.x - pl.x) < 1 && Math.abs(rec.y - (-pl.y)) < 1) landed++;
		else stray.push(pl.designator);
	}
	// 线落地直接核对:把 live LINE 段按「组|坐标」入集(含反向段,EDA 可能反存端点),核对每条预期段都在。
	const liveLines = new Set();
	const key = (g, a, b, c, d) => `${g}|${Math.round(a)}|${Math.round(b)}|${Math.round(c)}|${Math.round(d)}`;
	for (const x of parsed) {
		if (x.head?.type !== 'LINE') continue;
		const d = x.data;
		liveLines.add(key(d.lineGroup, d.startX, d.startY, d.endX, d.endY));
		liveLines.add(key(d.lineGroup, d.endX, d.endY, d.startX, d.startY));
	}
	let wlanded = 0; const wstray = new Set();
	for (const [g, sx, sy, ex, ey] of expectedLines) {
		if (liveLines.has(key(g, sx, sy, ex, ey))) wlanded++; else wstray.add(g);
	}
	const compOk = landed === r.placements.length;
	const wireOk = wlanded === expectedLines.length;
	const applied = compOk && wireOk;
	if (applied) console.log(`✓ 投递生效(器件 ${landed}/${r.placements.length} + 线段 ${wlanded}/${expectedLines.length} 全落地)`);
	else console.warn(`✗ 投递部分回退:器件 ${landed}/${r.placements.length}(缺 ${stray.slice(0, 4).join(',')})`
		+ ` · 线段 ${wlanded}/${expectedLines.length}(缺组 ${[...wstray].slice(0, 4).join(',')})`);
	return { ok: applied, landed, total: r.placements.length, wlanded, wtotal: expectedLines.length };
}

export async function applySource({ robust = false, maxTries = 3 } = {}) {
	const { r, idByDes, logical, contract } = synth();
	// 投递前质量门报告:镜像 synthesize 全硬门。源式投递原子加载、不像 create 拒短路线 → 缺陷会被
	// 静默投到 live;故投递前显式报告全门 + fail-closed。**关键:忠实/连通在「投递态线集」上评估**
	// ——封顶取决于现有组数,溢出若丢命名线会断网;合成全集 connHard=0 会假绿。故先读一次源定投递态。
	let deliveredWires = r.model.wires, droppedNamed = [], dropN = 0;
	try {
		const { result: src0 } = await executeCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 60000 });
		const b = buildSource(src0, r, idByDes);
		deliveredWires = b.deliveredWires; droppedNamed = b.droppedNamed; dropN = b.droppedOverflow.length;
	} catch (e) {
		console.warn(`⚠ 投递态预读源失败(${e.message.slice(0, 40)})——回退用合成全集评估忠实/连通(可能偏乐观)。`);
	}
	const deliveredModel = { ...r.model, wires: deliveredWires };
	// 几何/标签:器件与标签全投,合成全集=投递态;忠实/连通:用投递态线集(反映封顶丢线)。
	const g = geomQC(r.model);
	const lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
	const faith = synthesisFaithfulness({ logical, contract, model: deliveredModel }).length;
	const conn = wireConnectivity({ model: deliveredModel, logical }).filter(f => f.severity === 'hard').length;
	const defects = g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.crossings + g.collinear + g.endpointShort + g.endpointOnWire + lh + faith + conn;
	const gate = { overlaps: g.overlaps.length, wireThruComp: g.wireThruComp.length, wireThruPin: g.wireThruPin.length, crossings: g.crossings, collinear: g.collinear, endpointShort: g.endpointShort, endpointOnWire: g.endpointOnWire, labelHard: lh, faithHard: faith, connHard: conn };
	// 持久投递证据(与项目证据驱动模式一致):落盘门状态 + 投递结果,供事后核验/会话交接。
	const REPORT = process.env.APPLY_SOURCE_REPORT || `${ROOT}/apply_source_report.json`;
	const writeReport = (extra) => { try { writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), model: APPLY_MODEL, gate, defects, droppedNamed, droppedOverflow: dropN, ...extra }, null, 2), 'utf8'); } catch { /* 报告落盘失败不阻断投递 */ } };
	console.log(`投递态质量门:overlaps=${g.overlaps.length} wireThruComp=${g.wireThruComp.length} wireThruPin=${g.wireThruPin.length} crossings=${g.crossings} collinear=${g.collinear} endpointShort=${g.endpointShort} endpointOnWire=${g.endpointOnWire} labelHard=${lh} faithHard=${faith} connHard=${conn}（忠实/连通基于投递态线集）`);
	if (dropN) {
		// 区分:命名线丢弃=真断网(该网脚会断);无名线丢弃=逃逸残段,连通门已证冗余(只是不渲染该几何)。
		if (droppedNamed.length) console.warn(`⚠ ${droppedNamed.length} 条**命名**溢出线无同网组可并、被丢弃(${[...new Set(droppedNamed)].slice(0, 6).join(',')})——该网这些脚会断!`);
		const unnamed = dropN - droppedNamed.length;
		if (unnamed) console.warn(`ℹ ${unnamed} 条无名溢出线(逃逸残段)未渲染——连通门已证冗余、不断网。`);
	}
	if (defects) {
		console.warn(`⚠ 被投布局含 ${defects} 处硬伤(几何短路 / 跨模块标签缺失 / 投递态连通断)——源式投递会原样投入,非干净布局。`
			+ (g.wireThruPin.length ? ` wireThruPin: ${g.wireThruPin.slice(0, 4).join(' ')}` : ''));
		// fail-closed:默认拒投有硬伤的布局(源式投递不像 create 拒短路线,会静默投入)。--force 沙盒强投。
		if (!process.argv.includes('--force')) {
			console.error(`✗ 拒绝投递 ${defects} 处硬伤的布局(与 synthesize 门一致 fail-closed)。先修合成,或加 --force 沙盒强投。`);
			writeReport({ success: false, refused: true });
			process.exitCode = 1;
			return;
		}
	}
	if (!robust) {
		const res = await deliverOnce(r, idByDes);
		if (!res.ok) {
			console.error('✗ 投递静默回退——源已被归一化,先 `node engine/plexus_apply_live.mjs --undo` 重建自然源再重试(或加 --robust 自愈)。');
			process.exitCode = 1;
		}
		writeReport({ success: res.ok, delivery: res, tries: 1 });
		return;
	}
	// 自愈:回退则 `--undo`(create 重建自然源)后重试,守 post-check、有界 maxTries(应对 setDocumentSource 非确定性)。
	const UNDO = `${ROOT}/engine/plexus_apply_live.mjs`;
	let last = null;
	for (let t = 1; t <= maxTries; t++) {
		last = await deliverOnce(r, idByDes);
		if (last.ok) { console.log(`✓ robust:第 ${t} 次成功`); writeReport({ success: true, delivery: last, tries: t }); return; }
		if (t < maxTries) {
			console.log(`  robust:第 ${t} 次回退,--undo 重建自然源后重试…`);
			try { execFileSync('node', [UNDO, '--undo'], { stdio: 'ignore' }); } catch (e) { console.error('  undo 失败:', e.message.slice(0, 60)); }
		}
	}
	console.error(`✗ robust:${maxTries} 次均回退——EDA setDocumentSource 持续拒绝,请人工检查 bridge/文档状态。`);
	writeReport({ success: false, delivery: last, tries: maxTries });
	process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log(`源式 live 投递(setDocumentSource 原子加载,绕开 create 合并)。把 EASYEDA_APPLY_MODEL
合成布局投到 EasyEDA 当前文档:移器件 + 复用 WIRE 组改线几何/网名。

用法: node engine/apply_source.mjs [--robust] [--force]

选项:
  --robust            回退则 --undo 重建自然源后重试(有界 3 次,应对 setDocumentSource 非确定性)。推荐。
  --force             即使投递态质量门有硬伤也强投(沙盒用;默认 fail-closed 拒投)。
  -h, --help          显示本帮助。

环境变量:
  EASYEDA_APPLY_MODEL 被投板的捕获快照(默认 <workdir>/live_clean.json)。换板:用 snapshot2.js 捕获后指此。
  APPLY_SOURCE_REPORT 投递报告输出路径(默认 <workdir>/apply_source_report.json)。
  EASYEDA_WORKDIR     工作目录(默认 cwd)。

需先启动 EasyEDA bridge 并打开对应工程。还原原图: node engine/plexus_apply_live.mjs --undo`);
		process.exit(0);
	}
	const robust = process.argv.includes('--robust');
	applySource({ robust }).catch(e => { console.error('源式投递失败:', e.message); process.exit(1); });
}
