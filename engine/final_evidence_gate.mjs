import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_FINAL_EVIDENCE_REPORT || DIR + 'final_evidence_report.json';
const REQUIRE_LIVE = process.argv.includes('--live') || process.env.EASYEDA_REQUIRE_LIVE_EVIDENCE === '1';
const MAX_AGE_MS = Number(process.env.EASYEDA_EVIDENCE_MAX_AGE_MS || 30 * 60 * 1000);

function readJson(rel) {
	const path = DIR + rel;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message };
	}
}

function fileInfo(rel) {
	const path = DIR + rel;
	if (!existsSync(path)) return { exists: false, ageMs: null, mtime: null };
	const stat = statSync(path);
	return { exists: true, ageMs: Date.now() - stat.mtimeMs, mtime: stat.mtime.toISOString(), size: stat.size };
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'final-evidence', msg, where });
}

function requireFresh(findings, rel, label) {
	const info = fileInfo(rel);
	if (!info.exists) {
		hard(findings, 'FE1-artifact-present', `${label} is required before final evidence can pass`, { file: rel });
		return info;
	}
	if (MAX_AGE_MS > 0 && info.ageMs > MAX_AGE_MS) {
		hard(findings, 'FE2-artifact-fresh', `${label} is stale; rerun the owning gate`, { file: rel, ageMs: info.ageMs, maxAgeMs: MAX_AGE_MS, mtime: info.mtime });
	}
	return info;
}

function requireReportPass(findings, rel, label, predicate = data => data?.pass === true) {
	const info = requireFresh(findings, rel, label);
	const data = readJson(rel);
	if (data?.parseError) {
		hard(findings, 'FE3-report-parse', `${label} must parse as JSON`, { file: rel, error: data.parseError });
		return { info, data };
	}
	if (info.exists && !predicate(data)) {
		hard(findings, 'FE4-report-pass', `${label} must pass`, { file: rel, pass: data?.pass, severity: data?.severity || null });
	}
	return { info, data };
}

const findings = [];
const local = {
	acceptance: requireReportPass(findings, 'acceptance_report.json', 'local acceptance report', data => data?.pass === true),
	gsdPlan: requireReportPass(findings, 'gsd_plan_report.json', 'GSD plan report'),
	gsdGenerate: requireReportPass(findings, 'gsd_generate_report.json', 'GSD generate report'),
	nextActions: requireReportPass(findings, 'next_actions.json', 'next actions report', data => data?.pass === true && (data?.actions || []).length === 0),
	repairActions: requireReportPass(findings, 'repair_actions.json', 'repair actions report', data => data?.pass === true && (data?.actions || []).length === 0),
	actionSchema: requireReportPass(findings, 'action_schema_report.json', 'action schema report'),
	projectContract: requireReportPass(findings, 'project_contract_report.json', 'project contract report'),
	projectNetlist: requireReportPass(findings, 'project_netlist_report.json', 'project netlist report'),
	projectLayout: requireReportPass(findings, 'project_layout_report.json', 'project layout report'),
	projectVisual: requireReportPass(findings, 'project_visual_report.json', 'project visual report'),
};

if (REQUIRE_LIVE) {
	const live = {
		acceptance: requireReportPass(findings, 'acceptance_report.json', 'live acceptance report', data => data?.pass === true && data?.mode === 'full-with-live'),
		liveModel: requireReportPass(findings, 'project_live_model_report.json', 'live model contract report'),
		drc: requireReportPass(findings, 'drc_report.json', 'EasyEDA DRC report', data => data?.pass === true && data?.drc?.strictPass === true && !(data?.drc?.errors || 0) && !(data?.drc?.warnings || 0) && !(data?.drc?.info || 0)),
		liveShots: requireReportPass(findings, 'live_shots_report.json', 'live shots report', data => data?.pass === true && (data?.screenshots || 0) >= 10),
		liveCanvas: requireFresh(findings, 'live_canvas.png', 'real EasyEDA canvas image'),
		liveJson: requireFresh(findings, 'live.json', 'real EasyEDA snapshot'),
	};
	if (live.liveShots.data?.fallbackDiagnosticOnly === true) {
		hard(findings, 'FE5-live-shots-diagnostic-only', 'live shots cannot be diagnostic-only for final evidence', { file: 'live_shots_report.json' });
	}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	mode: REQUIRE_LIVE ? 'full-with-live' : 'local-only',
	maxAgeMs: MAX_AGE_MS,
	severity: { hard: findings.length, soft: 0, info: 0 },
	local: Object.fromEntries(Object.entries(local).map(([key, value]) => [key, { file: value.info ? null : undefined, pass: value.data?.pass ?? null }])),
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`final evidence ${report.pass ? 'PASS' : 'FAIL'} mode=${report.mode} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
