import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { asArray } from '../contracts/module_contract.mjs';
import { validateLayoutContract } from '../contracts/layout_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const LAYOUT_REPORT = process.env.EASYEDA_LAYOUT_REPORT_OUT || DIR + 'layout_planner_report.json';
const STRUCTURE_REPORT = process.env.EASYEDA_LAYOUT_PLANNER_STRUCTURE || DIR + 'layout_planner_structure.json';
const REPORT = process.env.EASYEDA_PROJECT_LAYOUT_REPORT || DIR + 'project_layout_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-layout', msg, where });
}

const findings = [];
let assembly = null;
let contract = null;
let layout = null;
let structure = null;
if (!existsSync(CONTRACT)) hard(findings, 'PL0-contract-file', 'project_contract.json is required before layout contract audit', { path: CONTRACT });
if (!existsSync(ASSEMBLY)) hard(findings, 'PL0-assembly-file', 'project_assembly.json is required before layout contract audit', { path: ASSEMBLY });
if (!existsSync(LAYOUT_REPORT)) hard(findings, 'PL0-layout-report-file', 'layout_planner_report.json is required before layout contract audit; run npm run pipeline first', { path: LAYOUT_REPORT });
if (!existsSync(STRUCTURE_REPORT)) hard(findings, 'PL0-structure-report-file', 'layout_planner_structure.json is required before layout contract audit; run npm run pipeline first', { path: STRUCTURE_REPORT });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PL0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PL0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
	try { layout = readJson(LAYOUT_REPORT); } catch (e) { hard(findings, 'PL0-layout-report-parse', 'layout_planner_report.json must parse as JSON', { error: e.message }); }
	try { structure = readJson(STRUCTURE_REPORT); } catch (e) { hard(findings, 'PL0-structure-report-parse', 'layout_planner_structure.json must parse as JSON', { error: e.message }); }
}
if (contract && assembly && layout && structure) findings.push(...validateLayoutContract(assembly, layout, structure, { contract }));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: assembly?.projectId || null,
	candidateSource: layout?.candidateSource || null,
	totalCandidates: layout?.totalCandidates ?? null,
	availableCandidates: layout?.availableCandidates ?? null,
	policyStats: layout?.policyStats || null,
	minModuleGap: structure?.minModuleGap ?? null,
	moduleWireIntrusions: structure?.stats?.moduleWireIntrusions ?? null,
	laneInterlocks: asArray(structure?.laneInterlocks).length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project layout ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
