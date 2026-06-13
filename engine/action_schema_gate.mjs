import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateNextActions } from '../workflows/action_schema.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const NEXT = process.env.EASYEDA_NEXT_ACTIONS || DIR + 'next_actions.json';
const REPORT = process.env.EASYEDA_ACTION_SCHEMA_REPORT || DIR + 'action_schema_report.json';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'action-schema', msg, where });
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

const findings = [];
let next = null;
if (!existsSync(NEXT)) {
	hard(findings, 'AS0-next-actions-file', 'next_actions.json is required before action schema audit', { path: NEXT });
} else {
	try { next = readJson(NEXT); } catch (e) { hard(findings, 'AS0-next-actions-parse', 'next_actions.json must parse as JSON', { error: e.message }); }
}
if (next) findings.push(...validateNextActions(next));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	actionCount: Array.isArray(next?.actions) ? next.actions.length : null,
	schemaVersion: next?.schemaVersion ?? null,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`action schema ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
