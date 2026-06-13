import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { INTERFACE_CONTRACTS } from './interface_contract.mjs';
import { HARNESS_RULES } from '../harness/rule_registry.mjs';
import { MODULES, REQUIRED_PARTS } from '../harness/module_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const REPORT = process.env.EASYEDA_PROJECT_RULE_REPORT || DIR + 'project_rule_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-rule', msg, where });
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function ifaceKey(x) {
	return `${x?.net || ''}:${x?.from || ''}:${x?.to || ''}`;
}

const MODULE_ALIASES = new Map([
	['reset', 'btn1'],
	['boot', 'btn2'],
]);

function registryModuleId(contractId) {
	return MODULE_ALIASES.get(contractId) || contractId;
}

function validateRuleCoverage(contract) {
	const findings = [];
	const registryModules = new Map(MODULES.map(mod => [mod.name, mod]));
	const requiredParts = new Set(REQUIRED_PARTS);
	const ifaceRegistry = new Set(INTERFACE_CONTRACTS.map(ifaceKey));
	const ruleIds = new Set(HARNESS_RULES.map(rule => rule.id));

	for (const mod of asArray(contract.modules)) {
		const registryId = registryModuleId(mod.id);
		const registry = registryModules.get(registryId);
		if (!registry) {
			hard(findings, 'PR1-module-registered', `${mod.id} contract module is not represented in harness/module_registry.mjs`, { module: mod.id, registryId });
			continue;
		}
		const registryRefs = new Set(asArray(registry.refs));
		const missingRefs = asArray(mod.requiredParts).filter(ref => !registryRefs.has(ref));
		if (missingRefs.length) hard(findings, 'PR2-module-parts-covered', `${mod.id} required parts are missing from module registry`, { module: mod.id, registryId, missingRefs });
	}

	const contractParts = new Set(asArray(contract.modules).flatMap(mod => asArray(mod.requiredParts)));
	const missingRequired = [...contractParts].filter(ref => !requiredParts.has(ref));
	if (missingRequired.length) hard(findings, 'PR3-required-parts-covered', 'contract required parts are missing from REQUIRED_PARTS', { missingRequired });
	const staleRequired = [...requiredParts].filter(ref => !contractParts.has(ref));
	if (staleRequired.length) hard(findings, 'PR4-required-parts-no-stale', 'REQUIRED_PARTS contains parts not present in project_contract.json', { staleRequired });

	for (const iface of asArray(contract.interfaces)) {
		const normalized = {
			...iface,
			from: registryModuleId(iface.from),
			to: registryModuleId(iface.to),
		};
		const key = ifaceKey(normalized);
		if (!ifaceRegistry.has(key)) {
			hard(findings, 'PR5-interface-registered', `${iface.net} contract interface is missing from engine/interface_contract.mjs`, { interface: iface, expectedRegistryKey: key });
		}
	}

	for (const expected of ['C8', 'C10', 'C20', 'C21']) {
		if (!ruleIds.has(expected)) hard(findings, 'PR6-core-rule-present', `core harness rule ${expected} must be registered`, { expected });
	}
	return findings;
}

const findings = [];
let contract = null;
if (!existsSync(CONTRACT)) {
	hard(findings, 'PR0-contract-file', 'project_contract.json is required before rule coverage audit', { path: CONTRACT });
} else {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PR0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
}
if (contract) findings.push(...validateRuleCoverage(contract));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	moduleAliases: Object.fromEntries(MODULE_ALIASES),
	registeredRules: HARNESS_RULES.length,
	registeredModules: MODULES.length,
	registeredInterfaces: INTERFACE_CONTRACTS.length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project rules ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
