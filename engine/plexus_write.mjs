// Plexus 写回器(非破坏):把合成模型画到原图之外的偏移空白区,分批写入避开 30s
// 桥超时,每批后增量持久化 created primitiveId 以便完全撤销。绝不覆盖/删除用户既有几何。
//   node engine/plexus_write.mjs            写入(偏移区,分批)
//   node engine/plexus_write.mjs --undo     删除上次写入的全部 primitive
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { executeCode } from './bridge_client.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const IDS = `${ROOT}/plexus_write_ids.json`;
const BATCH = 40;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 断连/超时容忍:重试同批(桥会自动重新发现重连后的窗口)。
async function execRetry(script, tries = 4) {
	let last;
	for (let t = 0; t < tries; t++) {
		try { return await executeCode(script, {}); }
		catch (e) { last = e; if (!/disconnect|timed out/i.test(e.message)) throw e; await sleep(1500); }
	}
	throw last;
}

function bboxMaxX(snap) {
	let maxX = -Infinity;
	for (const c of snap.components || []) if (c.bbox) maxX = Math.max(maxX, c.bbox.maxX);
	return maxX;
}

// 合成模型 → 扁平 create 操作表(线 / 信号网标 / 电源 / 地),坐标已加偏移。
function buildOps(model, ox, oy) {
	const ops = [];
	for (const w of model.wires) ops.push({ k: 'w', line: (w.line || []).map((v, i) => i % 2 === 0 ? v + ox : v + oy), net: w.net || '' });
	for (const f of model.netflags) {
		const x = f.x + ox, y = f.y + oy, rot = f.rot || 0;
		if (f.kind === 'sig') ops.push({ k: 'p', net: f.net, x, y, rot });
		else if (f.kind === 'power') ops.push({ k: 'P', net: f.net, x, y, rot });
		else if (f.kind === 'gnd') ops.push({ k: 'G', net: f.net, x, y, rot });
	}
	return ops;
}

function batchScript(ops) {
	return `
const ops = ${JSON.stringify(ops)};
const ids = [];
for (const o of ops) {
  let r = null;
  if (o.k === 'w') r = await eda.sch_PrimitiveWire.create(o.line, o.net);
  else if (o.k === 'p') r = await eda.sch_PrimitiveComponent.createNetPort('BI', o.net, o.x, o.y, o.rot);
  else if (o.k === 'P') r = await eda.sch_PrimitiveComponent.createNetFlag('Power', o.net, o.x, o.y, o.rot);
  else if (o.k === 'G') r = await eda.sch_PrimitiveComponent.createNetFlag('Ground', o.net, o.x, o.y, o.rot);
  if (r && r.primitiveId) ids.push(r.primitiveId);
}
return { created: ids.length, ids };
`;
}

// 撤销:坐标清扫偏移区(x>sweepX)所有线+网标/电源符号——比按 id 删更稳健,
// 能连带清掉 EDA 自动衍生、不在追踪 id 内的标签。sweepX 取记录值,缺省 1500。
async function undo() {
	const store = existsSync(IDS) ? JSON.parse(readFileSync(IDS, 'utf8')) : {};
	const sweepX = Number.isFinite(store.sweepX) ? store.sweepX : 1500;
	const script = `
const TH = ${sweepX};
let dw = 0, dc = 0;
for (let pass = 0; pass < 8; pass++) {
  const wires = (await eda.sch_PrimitiveWire.getAll()) || [];
  const fw = wires.filter(w => (w.line || []).some((v, i) => i % 2 === 0 && v > TH)).map(w => w.primitiveId);
  if (fw.length) { try { await eda.sch_PrimitiveWire.delete(fw); dw += fw.length; } catch (e) {} }
  const ids = (await eda.sch_PrimitiveComponent.getAllPrimitiveId()) || [];
  const fc = [];
  for (const id of ids) { const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if (c && (c.componentType === 'netflag' || c.componentType === 'netport') && c.x > TH) fc.push(id); }
  if (fc.length) { try { await eda.sch_PrimitiveComponent.delete(fc); dc += fc.length; } catch (e) {} }
  if (!fw.length && !fc.length) break;
}
return { dw, dc };`;
	const { result } = await execRetry(script);
	console.log(`撤销(坐标清扫 x>${sweepX}):删线 ${result.dw}、删标 ${result.dc}`);
	writeFileSync(IDS, JSON.stringify({ ids: [], undoneAt: new Date().toISOString() }, null, 2));
}

async function write() {
	if (!existsSync(LIVE)) { console.error(`快照缺失：${LIVE}`); process.exit(2); }
	const snap = JSON.parse(readFileSync(LIVE, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });

	const g = geomQC(r.model);
	const labelHard = labelQC(r.model).filter(f => f.severity === 'hard').length;
	const faithHard = synthesisFaithfulness({ logical, contract, model: r.model }).length;
	const hard = g.overlaps.length + g.wireThruComp.length + g.crossings + labelHard + faithHard;
	if (hard) { console.error(`fail-closed:合成产物有 ${hard} 处硬伤,拒绝写入`); process.exit(1); }

	const maxX = bboxMaxX(snap);
	const ox = Number.isFinite(maxX) ? Math.round((maxX + 600 - 1000) / 10) * 10 : 3000;
	const sweepX = Number.isFinite(maxX) ? Math.round(maxX + 200) : 1500;   // 撤销坐标清扫阈值(原图与合成区之间)
	const ops = buildOps(r.model, ox, 0);

	// resume:同一合成确定性 → ops 一致。已写 cursor 个则从 cursor 续(--fresh 重头)。
	const fresh = process.argv.includes('--fresh');
	const prev = (!fresh && existsSync(IDS)) ? JSON.parse(readFileSync(IDS, 'utf8')) : {};
	let cursor = (prev.total === ops.length && Number.isInteger(prev.cursor)) ? prev.cursor : 0;
	const allIds = cursor > 0 ? (prev.ids || []) : [];
	if (cursor > 0) console.log(`resume:从 op ${cursor}/${ops.length} 续写(已有 ${allIds.length} id)`);

	for (let i = cursor; i < ops.length; i += BATCH) {
		const { result } = await execRetry(batchScript(ops.slice(i, i + BATCH)));
		allIds.push(...result.ids);
		cursor = Math.min(i + BATCH, ops.length);
		writeFileSync(IDS, JSON.stringify({ ids: allIds, cursor, total: ops.length, offset: { ox, oy: 0 }, sweepX, writtenAt: new Date().toISOString() }, null, 2));
		console.log(`  批 ${Math.floor(i / BATCH) + 1}/${Math.ceil(ops.length / BATCH)}:+${result.created}(累计 ${allIds.length}/${ops.length})`);
		await sleep(250);
	}
	console.log(`写入完成(偏移 ox=${ox}):${allIds.length} 个 primitive(wires=${r.model.wires.length} flags=${r.model.netflags.length})`);
	console.log(`id 已记录 → ${IDS}(撤销:node engine/plexus_write.mjs --undo)`);
}

if (process.argv.includes('--undo')) await undo();
else await write();
