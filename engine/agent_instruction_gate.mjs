import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_AGENT_INSTRUCTION_REPORT || DIR + 'agent_instruction_report.json';

function readText(rel) {
	return readFileSync(join(DIR, rel), 'utf8').replace(/^\uFEFF/, '');
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'agent-instructions', msg, where });
}

function normalize(text) {
	return String(text || '').toLowerCase();
}

function includesAny(text, tokens) {
	const haystack = normalize(text);
	return tokens.some(token => haystack.includes(normalize(token)));
}

function requireToken(findings, file, text, rule, tokens, reason) {
	if (!includesAny(text, tokens)) {
		hard(findings, rule, `${file} must tell agents ${reason}`, { file, requiredAny: tokens });
	}
}

function requireAll(findings, file, text, rulePrefix, tokens, reason) {
	for (const token of tokens) {
		if (!includesAny(text, [token])) {
			hard(findings, `${rulePrefix}-${token.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40)}`, `${file} must mention ${token}: ${reason}`, { file, token });
		}
	}
}

const findings = [];
const docs = {};
for (const file of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.en.md']) {
	const path = join(DIR, file);
	if (!existsSync(path)) {
		hard(findings, 'AI0-doc-file', `${file} is required so coding agents have a stable entry instruction`, { file });
		continue;
	}
	docs[file] = readText(file);
}

if (docs['AGENTS.md']) {
	requireAll(findings, 'AGENTS.md', docs['AGENTS.md'], 'AI1-agent-source-of-truth', [
		'easyeda-api-skill',
		'project_spec.json',
		'spec:schema',
		'project_contract.json',
		'project_netlist.json',
		'project_assembly.json',
		'layoutPolicy.flow',
		'layoutPolicy.columns',
		'anchorVariants',
		'cell_manifest.json',
		'qualityRules',
		'contract:pack',
		'circuit_packs/<pack>',
		'contract:library',
		'easyeda-gsd',
		'workflow:smoke',
		'workflow_smoke_report.json',
		'gsd_plan_report.json',
		'gsd_generate_report.json',
		'docs/agent-runner-guide.md',
		'workflows/repair_loop.mjs',
		'next_actions.json',
		'action:schema',
		'contract:netlist',
		'contract:cells',
		'contract:assembly',
		'contract:layout',
		'contract:live:model',
		'final_evidence_report.json',
		'final:evidence',
		'apply:gated',
		'accept:live',
		'repair_actions.json',
		'next_actions.json',
		'0 error / 0 warning / 0 info',
	], 'AGENTS.md is the detailed operating contract for Codex/Claude-style agents');
	requireToken(findings, 'AGENTS.md', docs['AGENTS.md'], 'AI2-no-free-draw', ['do not draw directly', 'do not free-draw', 'never free-draw'], 'not to free-draw in EasyEDA for delivery');
	requireToken(findings, 'AGENTS.md', docs['AGENTS.md'], 'AI3-preview-not-final', ['not final visual proof', 'not final acceptance', 'not real EasyEDA canvas screenshots'], 'offline previews are not final live EasyEDA evidence');
}

if (docs['CLAUDE.md']) {
	requireAll(findings, 'CLAUDE.md', docs['CLAUDE.md'], 'AI4-claude-short-path', [
		'AGENTS.md',
		'easyeda-api-skill',
		'project_spec.json',
		'spec:schema',
		'project_contract.json',
		'project_netlist.json',
		'project_assembly.json',
		'layoutPolicy.flow',
		'layoutPolicy.columns',
		'anchorVariants',
		'cell_manifest.json',
		'qualityRules',
		'contract:pack',
		'circuit_packs/<pack>',
		'contract:library',
		'easyeda-gsd',
		'workflow:smoke',
		'workflow_smoke_report.json',
		'gsd_plan_report.json',
		'gsd_generate_report.json',
		'workflows/repair_loop.mjs',
		'action:schema',
		'contract:netlist',
		'contract:cells',
		'contract:assembly',
		'contract:layout',
		'final_evidence_report.json',
		'accept:live',
		'apply:gated',
	], 'Claude Code needs a complete short path, not only a pointer');
	requireToken(findings, 'CLAUDE.md', docs['CLAUDE.md'], 'AI5-claude-no-free-draw', ['never free-draw', 'do not free-draw', 'do not draw directly'], 'not to free-draw in EasyEDA for delivery');
	requireToken(findings, 'CLAUDE.md', docs['CLAUDE.md'], 'AI6-claude-fail-closed', ['never bypass', 'fail-closed', 'only after all gates pass'], 'that write-back is fail-closed');
}

for (const file of ['README.md', 'README.en.md']) {
	if (!docs[file]) continue;
	requireAll(findings, file, docs[file], file === 'README.md' ? 'AI7-readme-zh' : 'AI8-readme-en', [
		'easyeda-api-skill',
		'AGENTS.md',
		'project_spec.json',
		'spec:schema',
		'project_contract.json',
		'project_netlist.json',
		'project_assembly.json',
		'layoutPolicy.flow',
		'layoutPolicy.columns',
		'anchorVariants',
		'cell_manifest.json',
		'qualityRules',
		'contract:pack',
		'circuit_packs/<pack>',
		'contract:library',
		'easyeda-gsd',
		'workflow:smoke',
		'workflow_smoke_report.json',
		'gsd_plan_report.json',
		'gsd_generate_report.json',
		'docs/agent-runner-guide.md',
		'action:schema',
		'apply:gated',
		'repair_actions.json',
	], 'the public README must tell users what the harness does and how an agent should use it');
	requireToken(findings, file, docs[file], file === 'README.md' ? 'AI9-readme-agent-oriented-zh' : 'AI10-readme-agent-oriented-en', ['Codex', 'Claude Code'], 'this is agent-oriented rather than a manual command checklist');
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	filesChecked: Object.keys(docs),
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`agent instructions ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
