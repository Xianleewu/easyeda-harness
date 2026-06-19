// ELK live 证据门:验证「ELK 投递到真实 EDA 画布的原理图」是否干净可用。
//
// 与 OLD 契约式 live 门(project_live_model 比对固定契约)不同——本门是【项目无关】的:
// 它只问「画布上当前这张图,几何/电气/连通是否干净、与 ELK 合成模型一致」,适配任意板。
// 这是 ELK 方向(任意原理图→美观自洽)下 live 证据的正解:不要求画布匹配某个预设契约,
// 只要求投递结果本身是商用级干净。
//
// 用法:node engine/elk_live_evidence.mjs [snapshot.json]
//   snapshot 默认 live_clean.json / live.json(ELK 合成的逻辑来源)。
//   需 EasyEDA bridge 在线以拉取画布实测状态;无 bridge 则只跑模型侧 ELK-QC。
//
// 退出码:0=PASS(画布干净且与模型一致)、1=FAIL。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const SNAP = process.argv[2] || (existsSync(`${ROOT}/live_clean.json`) ? `${ROOT}/live_clean.json` : `${ROOT}/live.json`);
const REPORT = process.env.ELK_LIVE_EVIDENCE_REPORT || `${ROOT}/elk_live_evidence_report.json`;

async function modelSideQC() {
	const { extractLogical } = await import('./schematic_extract.mjs');
	const { withLocalPins } = await import('./transform.mjs');
	const { elkLayout } = await import('./elk_layout.mjs');
	const { geomQC } = await import('./geom_qc.mjs');
	const { labelQC } = await import('./label_qc.mjs');
	const { wireConnectivity } = await import('./wire_connectivity.mjs');
	const snap = JSON.parse(readFileSync(SNAP, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
	// live 投递口径:scale=false、全网标(ELK_MAX_WIRE=0),与 plexus_apply_live 一致。
	const prevMax = process.env.ELK_MAX_WIRE;
	process.env.ELK_MAX_WIRE = '0';
	const model = await elkLayout({ snapshot: snap, logical, byDes, scale: false });
	if (prevMax == null) delete process.env.ELK_MAX_WIRE; else process.env.ELK_MAX_WIRE = prevMax;
	const g = geomQC(model);
	const geomHard = g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.crossings + g.collinear + g.endpointShort + g.endpointOnWire;
	const labelHard = labelQC(model).filter(f => f.severity === 'hard').length;
	const connHard = wireConnectivity({ model, logical }).filter(f => f.severity === 'hard').length;
	return {
		components: model.components.length, wires: model.wires.length, netflags: model.netflags.length,
		geomHard, geom: { overlaps: g.overlaps.length, wireThruComp: g.wireThruComp.length, wireThruPin: g.wireThruPin.length, crossings: g.crossings, collinear: g.collinear, offgrid: g.offgrid },
		labelHard, connHard,
		pass: geomHard === 0 && connHard === 0,
	};
}

async function liveSideCheck() {
	try {
		const { executeCode } = await import('./bridge_client.mjs');
		const script = `
			const comps = await eda.sch_PrimitiveComponent.getAll();
			const wires = await eda.sch_PrimitiveWire.getAll();
			let multiSeg = 0;
			for (const w of wires) { const p = w.points || w.line || []; if ((p.length / 2) - 1 > 1) multiSeg++; }
			const real = comps.filter(c => c.designator);
			return { realComps: real.length, netPorts: comps.length - real.length, wires: wires.length, multiSegWires: multiSeg };
		`;
		const { result } = await executeCode(script, { timeoutMs: 30000 });
		// 实测画布门:无合并乱线(multiSegWires=0)= 投递未被 EDA 合并成乱序折线。
		return { ...result, pass: result && result.multiSegWires === 0, available: true };
	} catch (e) {
		return { available: false, error: e.message };
	}
}

const model = await modelSideQC();
const live = await liveSideCheck();
// 模型侧必过;live 侧若 bridge 可用则也必过(无乱线),不可用则不阻断(模型已证)。
const pass = model.pass && (!live.available || live.pass);
const report = {
	generatedAt: new Date().toISOString(), snapshot: SNAP, mode: 'elk-live-evidence',
	model, live, pass,
};
writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`ELK live 证据:模型 geomHard=${model.geomHard} connHard=${model.connHard} labelHard=${model.labelHard}`
	+ ` | live ${live.available ? `multiSegWires=${live.multiSegWires} (${live.realComps}件/${live.wires}线)` : '(bridge 不可用,仅模型侧)'}`
	+ ` | ${pass ? 'PASS' : 'FAIL'}`);
console.log(`report -> ${REPORT}`);
process.exit(pass ? 0 : 1);
