import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { HARNESS_RULES } from '../harness/rule_registry.mjs';
import { asArray } from '../contracts/module_contract.mjs';
import { DRAWING_RULE_BINDINGS, validateDrawingRuleBindings } from '../contracts/drawing_rule_registry.mjs';
import { cellContractMap, loadCellManifest, resolveCellManifestPath } from './cell_manifest.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const REPORT = process.env.EASYEDA_PROJECT_RULE_REPORT || DIR + 'project_rule_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-rule', msg, where });
}

function ifaceKey(x) {
	return `${x?.net || ''}:${x?.from || ''}:${x?.to || ''}`;
}

function values(obj) {
	return Object.values(obj || {}).filter(Boolean);
}

function validateProjectRuleCoverage(contract, assembly, manifest) {
	const findings = [];
	const contractModules = new Map(asArray(contract.modules).map(mod => [mod.id, mod]));
	const assemblyModules = new Map(asArray(assembly.modules).map(mod => [mod.id, mod]));
	const cellContracts = cellContractMap(manifest);
	const ruleIds = new Set(HARNESS_RULES.map(rule => rule.id));

	for (const [id, mod] of contractModules) {
		const mapping = assemblyModules.get(id);
		if (!mapping) {
			hard(findings, 'PR1-module-mapped', `${id} contract module must be represented in project_assembly.json`, { module: id });
			continue;
		}
		const mappedRefs = new Set(values(mapping.refs));
		const missingRefs = asArray(mod.requiredParts).filter(ref => !mappedRefs.has(ref));
		if (missingRefs.length) hard(findings, 'PR2-module-parts-covered', `${id} required parts are missing from project assembly refs`, { module: id, missingRefs });

		const mappedNets = new Set(asArray(mapping.nets));
		const missingNets = asArray(mod.requiredNets).filter(net => !mappedNets.has(net));
		if (missingNets.length) hard(findings, 'PR3-module-nets-covered', `${id} required nets are missing from project assembly nets`, { module: id, missingNets });

		const cell = cellContracts.get(mapping.cell);
		if (!cell) {
			hard(findings, 'PR4-cell-rule-contract', `${id} deterministic cell must be declared in the selected cell manifest`, { module: id, cell: mapping.cell });
			continue;
		}
		const manifestCell = asArray(manifest.cells).find(c => c.id === mapping.cell) || {};
		const qualityRules = new Set(asArray(manifestCell.qualityRules));
		const drawingRuleBindings = validateDrawingRuleBindings({
			drawingRules: mod.drawingRules,
			registeredRuleIds: [...ruleIds],
		});
		for (const finding of drawingRuleBindings) {
			hard(findings, `PR-${finding.rule}`, finding.msg, { module: id, cell: mapping.cell, ...finding.where });
		}
		const missingQualityRules = asArray(mod.drawingRules).filter(rule => !qualityRules.has(rule));
		if (missingQualityRules.length) {
			hard(findings, 'PR5-cell-quality-rules-cover-module', `${id} cell qualityRules must cover module drawingRules`, {
				module: id,
				cell: mapping.cell,
				missingQualityRules,
			});
		}
	}

	for (const id of assemblyModules.keys()) {
		if (!contractModules.has(id)) hard(findings, 'PR6-no-stale-assembly-modules', `${id} assembly module is not present in project_contract.json`, { module: id });
	}

	const assemblyInterfaceNets = new Set();
	for (const iface of asArray(contract.interfaces)) {
		const from = assemblyModules.get(iface.from);
		const to = assemblyModules.get(iface.to);
		const key = ifaceKey(iface);
		if (!from || !to) continue;
		if (asArray(from.nets).includes(iface.net) && asArray(to.nets).includes(iface.net)) assemblyInterfaceNets.add(key);
	}
	for (const iface of asArray(contract.interfaces)) {
		if (!assemblyInterfaceNets.has(ifaceKey(iface))) {
			hard(findings, 'PR7-interface-covered-by-assembly', `${iface.net} interface must be represented in source and target assembly nets`, { interface: iface });
		}
	}

	for (const expected of ['C8', 'C10', 'C20', 'C21']) {
		if (!ruleIds.has(expected)) hard(findings, 'PR8-core-rule-present', `core harness rule ${expected} must be registered`, { expected });
	}
	for (const finding of validateDrawingRuleBindings({
		drawingRules: asArray(manifest.requiredQualityRules),
		registeredRuleIds: [...ruleIds],
	})) {
		hard(findings, `PR-${finding.rule}`, finding.msg, { scope: 'manifest.requiredQualityRules', ...finding.where });
	}
	return findings;
}

const findings = [];
let contract = null;
let assembly = null;
let manifest = null;
let manifestPath = null;

if (!existsSync(CONTRACT)) hard(findings, 'PR0-contract-file', 'project_contract.json is required before rule coverage audit', { path: CONTRACT });
if (!existsSync(ASSEMBLY)) hard(findings, 'PR0-assembly-file', 'project_assembly.json is required before project rule coverage audit', { path: ASSEMBLY });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PR0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PR0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}
if (assembly) {
	manifestPath = resolveCellManifestPath(assembly, ASSEMBLY);
	if (!existsSync(manifestPath)) hard(findings, 'PR0-cell-manifest-file', 'project_assembly.json must point to an existing cell manifest', { manifestPath });
	else {
		try { manifest = loadCellManifest(manifestPath); } catch (e) { hard(findings, 'PR0-cell-manifest-parse', 'cell manifest must parse as JSON', { manifestPath, error: e.message }); }
	}
}
if (contract && assembly && manifest) findings.push(...validateProjectRuleCoverage(contract, assembly, manifest));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	circuitPack: assembly?.circuitPack || null,
	cellManifest: manifestPath,
	registeredRules: HARNESS_RULES.length,
	contractModules: asArray(contract?.modules).length,
	assemblyModules: asArray(assembly?.modules).length,
	cellManifestCells: asArray(manifest?.cells).length,
	drawingRuleBindings: DRAWING_RULE_BINDINGS,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project rules ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
