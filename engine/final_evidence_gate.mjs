import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateContext } from '../workflows/gsd_generate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_FINAL_EVIDENCE_REPORT || DIR + 'final_evidence_report.json';
const REQUIRE_LIVE = process.argv.includes('--live') || process.env.EASYEDA_REQUIRE_LIVE_EVIDENCE === '1';
const MAX_AGE_MS = Number(process.env.EASYEDA_EVIDENCE_MAX_AGE_MS || 30 * 60 * 1000);
const SPEC_PATH = process.argv.slice(2).find(arg => !arg.startsWith('-')) || process.env.EASYEDA_PROJECT_SPEC || 'project_spec.json';
const CONTEXT = generateContext(DIR.replace(/\/$/, ''), SPEC_PATH);

function normalizePath(path) {
	return path ? resolve(path).replace(/\\/g, '/') : '';
}

function relPath(path) {
	const normalized = normalizePath(path);
	const root = DIR.replace(/\/$/, '');
	return normalized.startsWith(root) ? normalized.slice(root.length + 1) : normalized;
}

function readJson(rel) {
	const path = /^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/') ? rel : DIR + rel;
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

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeId(value) {
	return String(value || '').replace(/^\d+_/, '').replace(/_/g, '-');
}

function requiredVisualEvidence(contract) {
	const required = [
		'global-sheet',
		...asArray(contract?.visualEvidenceRegions),
		...asArray(contract?.modules).map(mod => mod.visualEvidence).filter(Boolean),
		'title-template',
	].map(normalizeId).filter(Boolean);
	return [...new Set(required)];
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
let spec = null;
if (!existsSync(CONTEXT.specAbs)) {
	hard(findings, 'FE0-spec-file', 'current project spec is required before final evidence can pass', { spec: SPEC_PATH, specAbs: CONTEXT.specAbs });
} else {
	try { spec = JSON.parse(readFileSync(CONTEXT.specAbs, 'utf8').replace(/^\uFEFF/, '')); }
	catch (e) { hard(findings, 'FE0-spec-parse', 'current project spec must parse as JSON', { spec: SPEC_PATH, error: e.message }); }
}
const expectedProjectId = spec?.projectId || null;
const expectedSpecRel = relPath(CONTEXT.specAbs);

const local = {
	workflowSmoke: requireReportPass(findings, 'workflow_smoke_report.json', 'workflow smoke report'),
	gsdPlan: requireReportPass(findings, 'gsd_plan_report.json', 'GSD plan report'),
	gsdGenerate: requireReportPass(findings, 'gsd_generate_report.json', 'GSD generate report'),
	nextActions: requireReportPass(findings, 'next_actions.json', 'next actions report', data => data?.pass === true && (data?.actions || []).length === 0),
	repairActions: requireReportPass(findings, 'repair_actions.json', 'repair actions report', data => data?.pass === true && (data?.actions || []).length === 0),
	actionSchema: requireReportPass(findings, 'action_schema_report.json', 'action schema report'),
	projectContract: requireReportPass(findings, 'project_contract_report.json', 'project contract report'),
	projectLibrary: requireReportPass(findings, 'project_library_report.json', 'project library report'),
	projectNetlist: requireReportPass(findings, 'project_netlist_report.json', 'project netlist report'),
	projectLayout: requireReportPass(findings, 'project_layout_report.json', 'project layout report'),
	projectLabelLayout: requireReportPass(findings, 'project_label_layout_report.json', 'project label layout report'),
	projectVisual: requireReportPass(findings, 'project_visual_report.json', 'project visual report'),
	template: requireReportPass(findings, 'report.json', 'template/layout report', data => data?.pass === true && data?.coverage?.layoutPlanner === true),
};

function requireProjectId(report, rel, label) {
	if (!expectedProjectId || !report?.data || report.data.parseError) return;
	if (report.data.projectId !== undefined && report.data.projectId !== expectedProjectId) {
		hard(findings, 'FE6-project-context-match', `${label} projectId must match the current spec`, {
			file: rel,
			expectedProjectId,
			actualProjectId: report.data.projectId,
		});
	}
}

for (const [rel, label, report] of [
	['gsd_plan_report.json', 'GSD plan report', local.gsdPlan],
	['gsd_generate_report.json', 'GSD generate report', local.gsdGenerate],
	['project_contract_report.json', 'project contract report', local.projectContract],
	['project_library_report.json', 'project library report', local.projectLibrary],
	['project_netlist_report.json', 'project netlist report', local.projectNetlist],
	['project_layout_report.json', 'project layout report', local.projectLayout],
	['project_label_layout_report.json', 'project label layout report', local.projectLabelLayout],
	['project_visual_report.json', 'project visual report', local.projectVisual],
]) {
	requireProjectId(report, rel, label);
}

if (local.gsdPlan.data?.spec !== undefined && relPath(local.gsdPlan.data.spec) !== expectedSpecRel) {
	hard(findings, 'FE7-plan-spec-context-match', 'GSD plan report must be for the current spec path', {
		expectedSpec: expectedSpecRel,
		actualSpec: local.gsdPlan.data.spec,
	});
}
if (local.gsdGenerate.data?.spec !== undefined && relPath(local.gsdGenerate.data.spec) !== expectedSpecRel) {
	hard(findings, 'FE8-generate-spec-context-match', 'GSD generate report must be for the current spec path', {
		expectedSpec: expectedSpecRel,
		actualSpec: local.gsdGenerate.data.spec,
	});
}
const acceptanceContext = readJson('acceptance_report.json')?.context || null;
if (acceptanceContext) {
	for (const [key, expected] of [
		['specAbs', CONTEXT.specAbs],
		['contractPath', CONTEXT.contractPath],
		['netlistPath', CONTEXT.netlistPath],
		['assemblyPath', CONTEXT.assemblyPath],
		['libraryManifestPath', CONTEXT.libraryManifestPath],
		['partLibPath', CONTEXT.partLibPath],
	]) {
		if (normalizePath(acceptanceContext[key]) !== normalizePath(expected)) {
			hard(findings, 'FE9-acceptance-context-match', 'acceptance_report.json context must match the current project spec context', {
				key,
				expected: normalizePath(expected),
				actual: normalizePath(acceptanceContext[key]),
			});
		}
	}
} else {
	hard(findings, 'FE9-acceptance-context-match', 'acceptance_report.json must include the current project spec context', { file: 'acceptance_report.json' });
}

if (REQUIRE_LIVE) {
	const contract = readJson(CONTEXT.contractPath);
	const live = {
		liveModel: requireReportPass(findings, 'project_live_model_report.json', 'live model contract report'),
		drc: requireReportPass(findings, 'drc_report.json', 'EasyEDA DRC report', data => data?.pass === true && data?.drc?.strictPass === true && !(data?.drc?.errors || 0) && !(data?.drc?.warnings || 0) && !(data?.drc?.info || 0)),
		liveShots: requireReportPass(findings, 'live_shots_report.json', 'live shots report', data => data?.pass === true && (data?.screenshots || 0) >= 1),
		liveCanvas: requireFresh(findings, 'live_canvas.png', 'real EasyEDA canvas image'),
		liveJson: requireFresh(findings, 'live.json', 'real EasyEDA snapshot'),
	};
	if (live.liveShots.data?.fallbackDiagnosticOnly === true) {
		hard(findings, 'FE5-live-shots-diagnostic-only', 'live shots cannot be diagnostic-only for final evidence', { file: 'live_shots_report.json' });
	}
	const expectedEvidence = requiredVisualEvidence(contract);
	const liveEvidence = new Set(asArray(live.liveShots.data?.regions).map(region => normalizeId(region.evidenceId || region.region)).filter(Boolean));
	const missingLiveEvidence = expectedEvidence.filter(id => !liveEvidence.has(id));
	if (missingLiveEvidence.length) {
		hard(findings, 'FE10-live-shot-contract-evidence', 'live_shots_report.json must contain every visual evidence region required by the active project contract', {
			missingEvidence: missingLiveEvidence,
			availableEvidence: [...liveEvidence].sort(),
			contractPath: CONTEXT.contractPath,
		});
	}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	mode: REQUIRE_LIVE ? 'full-with-live' : 'local-only',
	context: {
		spec: SPEC_PATH,
		specAbs: CONTEXT.specAbs,
		specDir: CONTEXT.specDir,
		projectId: expectedProjectId,
		contractPath: CONTEXT.contractPath,
		netlistPath: CONTEXT.netlistPath,
		assemblyPath: CONTEXT.assemblyPath,
		libraryManifestPath: CONTEXT.libraryManifestPath,
		partLibPath: CONTEXT.partLibPath,
	},
	maxAgeMs: MAX_AGE_MS,
	severity: { hard: findings.length, soft: 0, info: 0 },
	local: Object.fromEntries(Object.entries(local).map(([key, value]) => [key, { file: value.info ? null : undefined, pass: value.data?.pass ?? null }])),
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`final evidence ${report.pass ? 'PASS' : 'FAIL'} mode=${report.mode} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
