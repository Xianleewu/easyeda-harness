import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeLiveWires } from './validate.mjs';
import { asArray, projectModelReport, validateModelAgainstContract } from './project_model_gate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const LIVE = process.env.EASYEDA_LIVE_MODEL || DIR + 'live.json';
const REPORT = process.env.EASYEDA_PROJECT_LIVE_MODEL_REPORT || DIR + 'project_live_model_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function liveHard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-live-model', msg, where });
}

function normalizeLiveContractModel(liveSnap) {
	return {
		project: liveSnap.project,
		components: asArray(liveSnap.components),
		netflags: asArray(liveSnap.netflags).map(f => ({ ...f, kind: f.type === 'netport' ? 'sig' : (f.net === 'GND' ? 'gnd' : 'power') })),
		wires: normalizeLiveWires(liveSnap),
		texts: asArray(liveSnap.texts),
		rectangles: asArray(liveSnap.rectangles),
		sheetBBox: liveSnap.sheetBBox || null,
	};
}

const findings = [];
let contract = null;
let live = null;
let model = null;
if (!existsSync(CONTRACT)) liveHard(findings, 'PLM0-contract-file', 'project_contract.json is required before live model contract audit', { path: CONTRACT });
if (!existsSync(LIVE)) liveHard(findings, 'PLM0-live-file', 'live.json is required before final live model contract audit; run npm run accept:live after connecting EasyEDA', { path: LIVE });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { liveHard(findings, 'PLM0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { live = readJson(LIVE); } catch (e) { liveHard(findings, 'PLM0-live-parse', 'live.json must parse as JSON', { error: e.message }); }
}
if (live) {
	model = normalizeLiveContractModel(live);
	if (!asArray(model.components).length) liveHard(findings, 'PLM1-live-components', 'live.json must contain schematic components from the EasyEDA canvas', { components: 0 });
	if (!asArray(model.wires).length) liveHard(findings, 'PLM2-live-wires', 'live.json must contain normalized schematic wires from the EasyEDA canvas', { wires: 0 });
}
if (contract && model) {
	for (const f of validateModelAgainstContract(contract, model)) {
		findings.push({ ...f, rule: `PLM-${f.rule}`, category: 'project-live-model' });
	}
}

const report = {
	...projectModelReport(contract, model, findings),
	source: 'live.json',
	liveStats: live ? {
		components: asArray(live.components).length,
		rawWires: asArray(live.wires).length,
		normalizedWires: asArray(model?.wires).length,
		netflags: asArray(live.netflags).length,
		texts: asArray(live.texts).length,
		rectangles: asArray(live.rectangles).length,
	} : null,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project live model ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
