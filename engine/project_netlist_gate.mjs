import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { asArray } from '../contracts/module_contract.mjs';
import { validateNetContract } from '../contracts/net_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const PROJECT_NETLIST = process.env.EASYEDA_PROJECT_NETLIST || DIR + 'project_netlist.json';
const MODEL = process.env.EASYEDA_PROJECT_MODEL || DIR + 'full_model.json';
const REPORT = process.env.EASYEDA_PROJECT_NETLIST_REPORT || DIR + 'project_netlist_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-netlist', msg, where });
}

const findings = [];
let contract = null;
let projectNetlist = null;
let model = null;
if (!existsSync(CONTRACT)) hard(findings, 'PN0-contract-file', 'project_contract.json is required before project netlist audit', { path: CONTRACT });
if (!existsSync(PROJECT_NETLIST)) hard(findings, 'PN0-netlist-file', 'project_netlist.json is required to make electrical intent machine-checkable', { path: PROJECT_NETLIST });
if (!existsSync(MODEL)) hard(findings, 'PN0-model-file', 'full_model.json is required before project netlist audit', { path: MODEL });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PN0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { projectNetlist = readJson(PROJECT_NETLIST); } catch (e) { hard(findings, 'PN0-netlist-parse', 'project_netlist.json must parse as JSON', { error: e.message }); }
	try { model = readJson(MODEL); } catch (e) { hard(findings, 'PN0-model-parse', 'full_model.json must parse as JSON', { error: e.message }); }
}

let stats = null;
if (contract && projectNetlist && model) {
	const result = validateNetContract(contract, projectNetlist, model);
	findings.push(...result.findings);
	stats = {
		modelNets: result.modelNetCount,
		modelPins: result.modelPins,
		contractNets: result.contractNets,
		projectNets: result.projectNets,
	};
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	stats,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project netlist ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
