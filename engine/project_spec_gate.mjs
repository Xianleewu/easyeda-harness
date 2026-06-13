import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateSpecSchema, asArray } from '../contracts/spec_schema.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const SPEC = process.env.EASYEDA_PROJECT_SPEC || DIR + 'project_spec.json';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const REPORT = process.env.EASYEDA_PROJECT_SPEC_REPORT || DIR + 'project_spec_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-spec', msg, where });
}

function keyOfInterface(x) {
	return `${x?.net || ''}:${x?.from || ''}:${x?.to || ''}`;
}

function validateSpec(spec, contract) {
	const findings = [];
	findings.push(...validateSpecSchema(spec).map(f => ({ ...f, category: 'project-spec' })));
	if (contract.projectId && spec.projectId && contract.projectId !== spec.projectId) hard(findings, 'PS4-project-id-match', 'project spec and contract projectId must match', { spec: spec.projectId, contract: contract.projectId });

	const specModules = asArray(spec.modules);
	if (!specModules.length) hard(findings, 'PS5-modules-present', 'project spec must define functional modules');
	const contractModules = new Map(asArray(contract.modules).map(mod => [mod.id, mod]));
	for (const mod of specModules) {
		const contractMod = contractModules.get(mod.id);
		if (!contractMod) {
			hard(findings, 'PS6-module-covered', `${mod.id} spec module is missing from project_contract.json`, { module: mod.id });
			continue;
		}
		const contractNets = new Set(asArray(contractMod.requiredNets));
		const missingNets = asArray(mod.requiredNets).filter(net => !contractNets.has(net));
		if (missingNets.length) hard(findings, 'PS7-module-net-covered', `${mod.id} spec nets are missing from contract module`, { module: mod.id, missingNets });
		if (mod.title && contractMod.title && String(mod.title).toLowerCase() !== String(contractMod.title).toLowerCase()) {
			hard(findings, 'PS8-module-title-match', `${mod.id} spec title differs from contract title`, { module: mod.id, specTitle: mod.title, contractTitle: contractMod.title });
		}
	}

	const contractInterfaces = new Set(asArray(contract.interfaces).map(keyOfInterface));
	for (const iface of asArray(spec.interfaces)) {
		const key = keyOfInterface(iface);
		if (!contractInterfaces.has(key)) hard(findings, 'PS9-interface-covered', `spec interface is missing from project_contract.json: ${key}`, { interface: iface });
	}

	const specQuality = spec.qualityPolicy || {};
	const contractQuality = contract.qualityPolicy || {};
	for (const key of ['severityMustBeZero', 'singleSheetNoNetPortsByDefault', 'fakeTextNetLabelsAllowed']) {
		if (specQuality[key] !== undefined && contractQuality[key] !== specQuality[key]) {
			hard(findings, 'PS10-quality-policy-covered', `contract qualityPolicy.${key} does not match spec`, { key, spec: specQuality[key], contract: contractQuality[key] });
		}
	}
	for (const key of ['drcErrors', 'drcWarnings', 'drcInfo']) {
		if (specQuality[key] !== undefined && contractQuality[key] !== specQuality[key]) {
			hard(findings, 'PS11-drc-policy-covered', `contract qualityPolicy.${key} does not match spec`, { key, spec: specQuality[key], contract: contractQuality[key] });
		}
	}
	return findings;
}

const findings = [];
let spec = null;
let contract = null;
if (!existsSync(SPEC)) hard(findings, 'PS0-spec-file', 'project_spec.json is required as the user-intent input for this harness workflow', { path: SPEC });
if (!existsSync(CONTRACT)) hard(findings, 'PS0-contract-file', 'project_contract.json is required to prove spec coverage', { path: CONTRACT });
if (!findings.length) {
	try { spec = readJson(SPEC); } catch (e) { hard(findings, 'PS0-spec-parse', 'project_spec.json must parse as JSON', { error: e.message }); }
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PS0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
}
if (spec && contract) findings.push(...validateSpec(spec, contract));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: spec?.projectId || null,
	modules: asArray(spec?.modules).length,
	interfaces: asArray(spec?.interfaces).length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project spec ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
