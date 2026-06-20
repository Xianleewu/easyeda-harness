import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const MODEL = process.env.EASYEDA_PROJECT_MODEL || DIR + 'full_model.json';
const REPORT = process.env.EASYEDA_PROJECT_MODEL_REPORT || DIR + 'project_model_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-model', msg, where });
}

export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function segmentTouchesBox(line, box, margin = 1) {
	if (!box || !Array.isArray(line) || line.length < 4) return false;
	for (let i = 0; i + 3 < line.length; i += 2) {
		const x1 = line[i], y1 = line[i + 1], x2 = line[i + 2], y2 = line[i + 3];
		const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
		const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
		if (maxX < box.minX - margin || minX > box.maxX + margin || maxY < box.minY - margin || minY > box.maxY + margin) continue;
		if (Math.abs(y1 - y2) < 1e-6 && y1 >= box.minY - margin && y1 <= box.maxY + margin) return true;
		if (Math.abs(x1 - x2) < 1e-6 && x1 >= box.minX - margin && x1 <= box.maxX + margin) return true;
		return true;
	}
	return false;
}

function moduleBox(model, refs) {
	const boxes = asArray(model.components)
		.filter(c => refs.includes(c.designator))
		.flatMap(c => {
			const out = [];
			if (c.bbox) out.push(c.bbox);
			for (const p of asArray(c.pins)) {
				if (typeof p.x === 'number' && typeof p.y === 'number') {
					out.push({ minX: p.x, maxX: p.x, minY: p.y, maxY: p.y });
				}
			}
			return out;
		});
	if (!boxes.length) return null;
	return {
		minX: Math.min(...boxes.map(b => b.minX)),
		minY: Math.min(...boxes.map(b => b.minY)),
		maxX: Math.max(...boxes.map(b => b.maxX)),
		maxY: Math.max(...boxes.map(b => b.maxY)),
	};
}

function modelNetNames(model) {
	const names = new Set();
	for (const w of asArray(model.wires)) if (w.net) names.add(w.net);
	for (const f of asArray(model.netflags)) if (f.net) names.add(f.net);
	return names;
}

function netTouchesModule(model, net, box) {
	if (!box) return false;
	const wires = asArray(model.wires).filter(w => w.net === net);
	if (wires.some(w => segmentTouchesBox(w.line, box, 90))) return true;
	const flags = asArray(model.netflags).filter(f => f.net === net);
	return flags.some(f => f.x >= box.minX - 80 && f.x <= box.maxX + 80 && f.y >= box.minY - 80 && f.y <= box.maxY + 80);
}

export function validateModelAgainstContract(contract, model) {
	const findings = [];
	const components = new Set(asArray(model.components).map(c => c.designator).filter(Boolean));
	const nets = modelNetNames(model);
	const modules = asArray(contract.modules);
	const moduleById = new Map(modules.map(mod => [mod.id, mod]));
	const boxes = new Map();

	for (const mod of modules) {
		const missingParts = asArray(mod.requiredParts).filter(ref => !components.has(ref));
		if (missingParts.length) hard(findings, 'PM1-module-parts-present', `${mod.id} required parts are missing from model`, { module: mod.id, missingParts });
		const missingNets = asArray(mod.requiredNets).filter(net => !nets.has(net));
		if (missingNets.length) hard(findings, 'PM2-module-nets-expressed', `${mod.id} required nets are not expressed by model wires/netflags`, { module: mod.id, missingNets });
		const box = moduleBox(model, asArray(mod.requiredParts));
		if (!box) hard(findings, 'PM3-module-box-derivable', `${mod.id} module box cannot be derived from required parts`, { module: mod.id });
		else boxes.set(mod.id, box);
	}

	for (const iface of asArray(contract.interfaces)) {
		if (!nets.has(iface.net)) {
			hard(findings, 'PM4-interface-net-expressed', `${iface.net} interface net is not expressed by model wires/netflags`, { interface: iface });
			continue;
		}
		const from = moduleById.get(iface.from);
		const to = moduleById.get(iface.to);
		if (!from || !to) continue;
		const fromBox = boxes.get(from.id);
		const toBox = boxes.get(to.id);
		if (!netTouchesModule(model, iface.net, fromBox)) hard(findings, 'PM5-interface-from-touch', `${iface.net} is not expressed near from module ${from.id}`, { interface: iface, moduleBox: fromBox });
		if (!netTouchesModule(model, iface.net, toBox)) hard(findings, 'PM6-interface-to-touch', `${iface.net} is not expressed near to module ${to.id}`, { interface: iface, moduleBox: toBox });
	}

	return findings;
}

export function projectModelReport(contract, model, findings = []) {
	return {
		generatedAt: new Date().toISOString(),
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		projectId: contract?.projectId || null,
		modelStats: model ? {
			components: asArray(model.components).length,
			wires: asArray(model.wires).length,
			netflags: asArray(model.netflags).length,
			nets: modelNetNames(model).size,
		} : null,
		findings,
	};
}

export function runProjectModelGate({ contractPath = CONTRACT, modelPath = MODEL, reportPath = REPORT, modelLabel = 'full_model.json' } = {}) {
	const findings = [];
	let contract = null;
	let model = null;
	if (!existsSync(contractPath)) hard(findings, 'PM0-contract-file', 'project_contract.json is required before model contract audit', { path: contractPath });
	if (!existsSync(modelPath)) hard(findings, 'PM0-model-file', `${modelLabel} is required before model contract audit`, { path: modelPath });
	if (!findings.length) {
		try { contract = readJson(contractPath); } catch (e) { hard(findings, 'PM0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
		try { model = readJson(modelPath); } catch (e) { hard(findings, 'PM0-model-parse', `${modelLabel} must parse as JSON`, { error: e.message }); }
	}
	if (contract && model) findings.push(...validateModelAgainstContract(contract, model));
	const report = projectModelReport(contract, model, findings);
	writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
	return report;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('engine/project_model_gate.mjs')) {
	const report = runProjectModelGate();
	console.log(`project model ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
	console.log(`report -> ${REPORT}`);
	process.exit(report.pass ? 0 : 1);
}
