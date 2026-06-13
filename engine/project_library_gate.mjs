import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const MANIFEST = process.env.EASYEDA_APPROVED_LIBRARY_MANIFEST || DIR + 'approved_library_manifest.json';
const REPORT = process.env.EASYEDA_PROJECT_LIBRARY_REPORT || DIR + 'project_library_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'library-contract', msg, where });
}

const findings = [];
let contract = null;
let manifest = null;
if (!existsSync(CONTRACT)) hard(findings, 'LC0-contract-file', 'project_contract.json is required before library contract audit', { path: CONTRACT });
if (!existsSync(MANIFEST)) hard(findings, 'LC0-library-manifest-file', 'approved_library_manifest.json is required before generation/write-back can be trusted', { path: MANIFEST });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'LC0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { manifest = readJson(MANIFEST); } catch (e) { hard(findings, 'LC0-library-manifest-parse', 'approved_library_manifest.json must parse as JSON', { error: e.message }); }
}

let stats = null;
if (contract && manifest) {
	const result = validateLibraryContract(contract, manifest);
	findings.push(...result.findings);
	stats = result.stats;
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	manifest: MANIFEST,
	stats,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project library ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);

