// 官方门控 writer 的 run 适配器:把官方 generate 阶段产出并经全门验证的 full_model.json,
// 用「源式投递」(setDocumentSource 原子加载,apply_source.mjs 的突破)写回 EasyEDA——替代旧
// create 式 apply_run.mjs(逐条 create 受 EDA 非确定性合并、丢 30-50 线)。满足 writer run 接口:
// EASYEDA_APPLY_RUN_AUTHORIZED 授权门 + 复用 apply_source 的 deliverRobust(深度双直接验证 + --undo 自愈)。
//
// 关键:投递的是官方 full_model.json(同一门控/验证过的模型),非重合成——保证门验证的与实际写回的一致。
import { readFileSync, writeFileSync } from 'node:fs';
import { deliverRobust } from './apply_source.mjs';
import { geomQC } from './geom_qc.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const MODEL = process.env.EASYEDA_APPLY_MODEL || `${DIR}full_model.json`;
const REPORT = process.env.APPLY_SOURCE_RUN_REPORT || `${DIR}apply_source_run_report.json`;
const MAX_TRIES = Number(process.env.EASYEDA_APPLY_MAX_ATTEMPTS || 3);

// 授权门:与 apply_run.mjs 一致——只能经 apply_gated.mjs 全门后被调,直接运行拒绝。
if (process.env.EASYEDA_APPLY_RUN_AUTHORIZED !== '1') {
	console.error('ABORT: apply_source_run.mjs is the gated source-writer run entrypoint. Use node engine/apply_gated.mjs so the full acceptance gate is enforced.');
	process.exit(1);
}

// 多窗口:apply_gated 经 --window-id 传目标窗口(与 apply_run 一致)。设入 EASYEDA_WINDOW_ID,
// 这样 deliverRobust→executeCode(默认读该 env)投到正确窗口,不回退到活动窗口。
const winI = process.argv.indexOf('--window-id');
if (winI >= 0 && process.argv[winI + 1]) process.env.EASYEDA_WINDOW_ID = process.argv[winI + 1];

async function main() {
	const m = JSON.parse(readFileSync(MODEL, 'utf8').replace(/^﻿/, ''));
	const comps = m.components || [];
	if (!comps.length) { console.error(`✗ ${MODEL} 无 components,无法投递`); process.exit(1); }
	// 从官方模型构造 buildSource 所需的 r/idByDes:placements(器件位)+ model.wires + designator→id。
	const r = {
		placements: comps.map(c => ({ designator: c.designator, x: c.x, y: c.y, rot: c.rotation || 0, mirror: !!c.mirror })),
		model: { components: comps, wires: m.wires || [], netflags: m.netflags || [] },
	};
	const idByDes = new Map(comps.map(c => [c.designator, c.id]).filter(([, id]) => id));

	// 安全网:投递前 geomQC 几何短路 fail-closed。官方 generate 全门已验干净 → 此处应 0;非 0 即模型有短路,拒投。
	const g = geomQC(r.model);
	const shorts = g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.crossings + g.collinear + g.endpointShort + g.endpointOnWire;
	console.log(`apply_source_run 几何门:overlaps=${g.overlaps.length} wireThruComp=${g.wireThruComp.length} wireThruPin=${g.wireThruPin.length} crossings=${g.crossings} collinear=${g.collinear} endpointShort=${g.endpointShort} endpointOnWire=${g.endpointOnWire}`);
	if (shorts) {
		console.error(`✗ 拒绝投递 ${shorts} 处几何短路(官方模型应已门控干净,fail-closed)。`);
		writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, success: false, refused: true, geom: { shorts } }, null, 2), 'utf8');
		process.exit(1);
	}

	const res = await deliverRobust(r, idByDes, MAX_TRIES);
	writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, success: res.ok, delivery: res, geom: { shorts } }, null, 2), 'utf8');
	if (!res.ok) { console.error('✗ 源式投递回退,写回失败'); process.exit(1); }
	console.log(`✓ 官方门控源式投递成功(器件 ${res.landed}/${res.total} + 线段 ${res.wlanded}/${res.wtotal} 全落地)`);
}

main().catch(e => { console.error('apply_source_run 失败:', e.message); process.exit(1); });
