import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { asArray, validateModuleContract } from '../contracts/module_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const REPORT = process.env.EASYEDA_PROJECT_CONTRACT_REPORT || DIR + 'project_contract_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-contract', msg, where });
}

let findings = [];
let contract = null;
if (!existsSync(CONTRACT)) {
	hard(findings, 'PC0-contract-file', 'project_contract.json is required before any agent can claim this harness applies to a project', { path: CONTRACT });
} else {
	try {
		contract = readJson(CONTRACT);
		findings = validateModuleContract(contract);
	} catch (e) {
		hard(findings, 'PC0-contract-parse', 'project contract must parse as JSON', { path: CONTRACT, error: e.message });
	}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	modules: asArray(contract?.modules).length,
	interfaces: asArray(contract?.interfaces).length,
	visualEvidenceRegions: asArray(contract?.visualEvidenceRegions).length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project contract ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
