import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateContext } from '../workflows/gsd_generate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_DELIVERY_REPORT || DIR + 'delivery_report.json';
const MAX_AGE_MS = Number(process.env.EASYEDA_DELIVERY_MAX_AGE_MS || 30 * 60 * 1000);
const SPEC_PATH = process.argv.slice(2).find(arg => !arg.startsWith('-')) || process.env.EASYEDA_PROJECT_SPEC || 'project_spec.json';
const CONTEXT = generateContext(DIR.replace(/\/$/, ''), SPEC_PATH);

function normalizePath(path) {
	return path ? resolve(path).replace(/\\/g, '/') : '';
}

function readJson(rel) {
	const normalized = String(rel || '').replace(/\\/g, '/');
	const path = /^[A-Za-z]:[\\/]/.test(rel) || normalized.startsWith('/') ? normalized : DIR + rel;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message };
	}
}

function fileInfo(rel) {
	const normalized = String(rel || '').replace(/\\/g, '/');
	const path = /^[A-Za-z]:[\\/]/.test(rel) || normalized.startsWith('/') ? normalized : DIR + rel;
	if (!existsSync(path)) return { exists: false, ageMs: null, mtime: null, size: null };
	const stat = statSync(path);
	return { exists: true, ageMs: Date.now() - stat.mtimeMs, mtime: stat.mtime.toISOString(), size: stat.size };
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'delivery', msg, where });
}

function requireFresh(findings, rel, label) {
	const info = fileInfo(rel);
	if (!info.exists) {
		hard(findings, 'DL1-live-artifact-present', `${label} is required for delivery`, { file: rel });
		return info;
	}
	if (MAX_AGE_MS > 0 && info.ageMs > MAX_AGE_MS) {
		hard(findings, 'DL2-live-artifact-fresh', `${label} is stale; rerun live-check before delivery`, {
			file: rel,
			ageMs: info.ageMs,
			maxAgeMs: MAX_AGE_MS,
			mtime: info.mtime,
		});
	}
	return info;
}

function requireReport(findings, rel, label, predicate = data => data?.pass === true) {
	const info = requireFresh(findings, rel, label);
	const data = readJson(rel);
	if (data?.parseError) {
		hard(findings, 'DL3-report-parse', `${label} must parse as JSON`, { file: rel, error: data.parseError });
		return { info, data };
	}
	if (info.exists && !predicate(data)) {
		hard(findings, 'DL4-report-pass', `${label} must pass for delivery`, {
			file: rel,
			pass: data?.pass ?? null,
			severity: data?.severity || null,
			mode: data?.mode || null,
			firstFinding: data?.findings?.[0] || null,
		});
	}
	return { info, data };
}

function assertContext(findings, report, rel, label) {
	const ctx = report?.data?.context || null;
	if (!ctx) {
		hard(findings, 'DL5-context-present', `${label} must include the active project context`, { file: rel });
		return;
	}
	for (const [key, expected] of [
		['specAbs', CONTEXT.specAbs],
		['contractPath', CONTEXT.contractPath],
		['netlistPath', CONTEXT.netlistPath],
		['assemblyPath', CONTEXT.assemblyPath],
		['libraryManifestPath', CONTEXT.libraryManifestPath],
		['partLibPath', CONTEXT.partLibPath],
	]) {
		if (ctx[key] !== undefined && normalizePath(ctx[key]) !== normalizePath(expected)) {
			hard(findings, 'DL6-context-match', `${label} context must match the selected project spec`, {
				file: rel,
				key,
				expected: normalizePath(expected),
				actual: normalizePath(ctx[key]),
			});
		}
	}
}

const findings = [];
const reports = {
	acceptance: requireReport(findings, 'acceptance_report.json', 'live acceptance report', data => data?.pass === true && data?.mode === 'full-with-live'),
	finalEvidence: requireReport(findings, 'final_evidence_report.json', 'live final evidence report', data => data?.pass === true && data?.mode === 'full-with-live'),
	projectLiveModel: requireReport(findings, 'project_live_model_report.json', 'live model contract report'),
	projectGeometry: requireReport(findings, 'project_geometry_report.json', 'live geometry report', data => data?.pass === true && data?.source === 'live.json'),
	projectLabelLayout: requireReport(findings, 'project_label_layout_report.json', 'live label layout report', data => data?.pass === true && data?.source === 'live.json'),
	drc: requireReport(findings, 'drc_report.json', 'EasyEDA DRC report', data => data?.pass === true && data?.drc?.strictPass === true && !(data?.drc?.errors || 0) && !(data?.drc?.warnings || 0) && !(data?.drc?.info || 0)),
	liveShots: requireReport(findings, 'live_shots_report.json', 'live shots report', data => data?.pass === true && (data?.screenshots || 0) >= 1 && data?.fallbackDiagnosticOnly !== true),
};

requireFresh(findings, 'live.json', 'real EasyEDA snapshot');
requireFresh(findings, 'live_canvas.png', 'real EasyEDA canvas image');

if (reports.acceptance.data?.mode && reports.acceptance.data.mode !== 'full-with-live') {
	hard(findings, 'DL7-live-acceptance-required', 'delivery requires node bin/easyeda-gsd.mjs live-check output; local-only acceptance is not final evidence', {
		file: 'acceptance_report.json',
		mode: reports.acceptance.data.mode,
	});
}
if (reports.finalEvidence.data?.mode && reports.finalEvidence.data.mode !== 'full-with-live') {
	hard(findings, 'DL8-live-final-evidence-required', 'delivery requires final_evidence_report.json from live mode', {
		file: 'final_evidence_report.json',
		mode: reports.finalEvidence.data.mode,
	});
}
if (reports.liveShots.data?.fallbackDiagnosticOnly === true) {
	hard(findings, 'DL9-live-shots-not-diagnostic', 'delivery cannot use diagnostic-only live shots', { file: 'live_shots_report.json' });
}

assertContext(findings, reports.acceptance, 'acceptance_report.json', 'acceptance report');
assertContext(findings, reports.finalEvidence, 'final_evidence_report.json', 'final evidence report');

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	mode: 'delivery',
	context: {
		spec: SPEC_PATH,
		specAbs: CONTEXT.specAbs,
		specDir: CONTEXT.specDir,
		contractPath: CONTEXT.contractPath,
		netlistPath: CONTEXT.netlistPath,
		assemblyPath: CONTEXT.assemblyPath,
		libraryManifestPath: CONTEXT.libraryManifestPath,
		partLibPath: CONTEXT.partLibPath,
	},
	maxAgeMs: MAX_AGE_MS,
	severity: { hard: findings.length, soft: 0, info: 0 },
	evidence: {
		acceptance: { pass: reports.acceptance.data?.pass ?? null, mode: reports.acceptance.data?.mode || null },
		finalEvidence: { pass: reports.finalEvidence.data?.pass ?? null, mode: reports.finalEvidence.data?.mode || null },
		projectLiveModel: { pass: reports.projectLiveModel.data?.pass ?? null },
		projectGeometry: { pass: reports.projectGeometry.data?.pass ?? null, source: reports.projectGeometry.data?.source || null, stats: reports.projectGeometry.data?.stats || null },
		projectLabelLayout: { pass: reports.projectLabelLayout.data?.pass ?? null, source: reports.projectLabelLayout.data?.source || null, stats: reports.projectLabelLayout.data?.stats || null },
		drc: { pass: reports.drc.data?.pass ?? null, counts: reports.drc.data?.drc || null },
		liveShots: {
			pass: reports.liveShots.data?.pass ?? null,
			screenshots: reports.liveShots.data?.screenshots ?? null,
			fallbackDiagnosticOnly: reports.liveShots.data?.fallbackDiagnosticOnly === true,
		},
		liveJson: fileInfo('live.json'),
		liveCanvas: fileInfo('live_canvas.png'),
	},
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
if (process.env.EASYEDA_DELIVERY_SKIP_ACTIONS !== '1') {
	const actionEnv = { ...process.env, EASYEDA_INCLUDE_DELIVERY_REPORT: '1' };
	const repair = spawnSync(process.execPath, ['engine/repair_actions.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: actionEnv });
	if (repair.error) console.warn(`repair actions failed: ${repair.error.message}`);
	const next = spawnSync(process.execPath, ['engine/next_actions.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: actionEnv });
	if (next.error) console.warn(`next actions failed: ${next.error.message}`);
	const actionSchema = spawnSync(process.execPath, ['engine/action_schema_gate.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: actionEnv });
	if (actionSchema.error) console.warn(`action schema failed: ${actionSchema.error.message}`);
}
console.log(`delivery ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
