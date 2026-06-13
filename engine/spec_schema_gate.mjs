import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateSpecSchema, asArray } from '../contracts/spec_schema.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const SPEC = process.env.EASYEDA_PROJECT_SPEC || DIR + 'project_spec.json';
const REPORT = process.env.EASYEDA_SPEC_SCHEMA_REPORT || DIR + 'spec_schema_report.json';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'spec-schema', msg, where });
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

const findings = [];
let spec = null;
if (!existsSync(SPEC)) {
	hard(findings, 'SS0-spec-file', 'project_spec.json is required as the first user-intent input', { path: SPEC });
} else {
	try { spec = readJson(SPEC); } catch (e) { hard(findings, 'SS0-spec-parse', 'project_spec.json must parse as JSON', { error: e.message }); }
}
if (spec) findings.push(...validateSpecSchema(spec));

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
console.log(`spec schema ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
