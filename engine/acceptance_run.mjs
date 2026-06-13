import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_ACCEPT_REPORT || DIR + 'acceptance_report.json';
const RUN_LIVE = process.argv.includes('--live') || process.env.EASYEDA_ACCEPT_LIVE === '1';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function runStep(name, command, args, { required = true } = {}) {
	const started = Date.now();
	console.log(`acceptance step: ${name}`);
	const child = spawnSync(command, args, { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
	return {
		name,
		command: [command, ...args].join(' '),
		required,
		status: child.status,
		pass: child.status === 0,
		durationMs: Date.now() - started,
		error: child.error ? child.error.message : '',
	};
}

const steps = [];
steps.push(runStep('entrypoints', 'node', ['engine/entrypoint_audit.mjs']));
steps.push(runStep('contract', 'node', ['engine/project_contract_gate.mjs']));
steps.push(runStep('fast', 'node', ['engine/pipeline_fast.mjs']));
steps.push(runStep('pipeline', 'node', ['engine/pipeline.mjs']));
steps.push(runStep('preview', 'node', ['engine/visual_crops.mjs']));

if (RUN_LIVE) {
	steps.push(runStep('live:save', 'node', ['engine/bridge_exec.mjs', '--js', 'snapshot2.js', '--out', 'live.json']));
	steps.push(runStep('live:image', 'node', ['engine/bridge_exec.mjs', '--js', 'snapshot-image.js', '--out', 'live_canvas.png', '--mode', 'image']));
	steps.push(runStep('drc', 'node', ['engine/drc_check.mjs']));
	const liveShots = runStep('live:shots', 'node', ['engine/live_shots.mjs']);
	steps.push(liveShots);
	if (!liveShots.pass) steps.push(runStep('live:diagnose', 'node', ['engine/live_diagnose.mjs'], { required: false }));
}

const artifacts = {};
for (const [key, path] of Object.entries({
	report: DIR + 'report.json',
	visualReview: DIR + 'visual_review_report.json',
	drc: DIR + 'drc_report.json',
	liveShots: DIR + 'live_shots_report.json',
	liveDiagnose: DIR + 'live_diagnose_report.json',
})) {
	if (existsSync(path)) {
		try { artifacts[key] = readJson(path); }
		catch (e) { artifacts[key] = { parseError: e.message }; }
	}
}

const requiredFailed = steps.filter(s => s.required && !s.pass);
const acceptance = {
	generatedAt: new Date().toISOString(),
	mode: RUN_LIVE ? 'full-with-live' : 'local-only',
	pass: requiredFailed.length === 0,
	severity: { hard: requiredFailed.length, soft: 0, info: 0 },
	steps,
	summary: {
		local: {
			fast: steps.find(s => s.name === 'fast')?.pass === true,
			pipeline: steps.find(s => s.name === 'pipeline')?.pass === true,
			preview: steps.find(s => s.name === 'preview')?.pass === true,
		},
		live: RUN_LIVE ? {
			save: steps.find(s => s.name === 'live:save')?.pass === true,
			image: steps.find(s => s.name === 'live:image')?.pass === true,
			drc: steps.find(s => s.name === 'drc')?.pass === true,
			shots: steps.find(s => s.name === 'live:shots')?.pass === true,
			diagnose: steps.find(s => s.name === 'live:diagnose')?.pass === true,
		} : null,
	},
	artifacts: {
		report: artifacts.report ? { pass: artifacts.report.pass, severity: artifacts.report.severity, score: artifacts.report.score } : null,
		visualReview: artifacts.visualReview ? { pass: artifacts.visualReview.pass, severity: artifacts.visualReview.severity, screenshots: artifacts.visualReview.screenshots, mode: artifacts.visualReview.mode } : null,
		drc: artifacts.drc ? { pass: artifacts.drc.pass, severity: artifacts.drc.severity, drc: artifacts.drc.drc } : null,
		liveShots: artifacts.liveShots ? {
			pass: artifacts.liveShots.pass,
			severity: artifacts.liveShots.severity,
			screenshots: artifacts.liveShots.screenshots,
			captureMode: artifacts.liveShots.captureMode,
			fallbackDiagnosticOnly: artifacts.liveShots.fallbackDiagnosticOnly,
			zoomEvidence: artifacts.liveShots.zoomEvidence ? {
				requestedRegions: artifacts.liveShots.zoomEvidence.requestedRegions,
				uniqueRequestedCaptures: artifacts.liveShots.zoomEvidence.uniqueRequestedCaptures,
			} : null,
			firstFinding: artifacts.liveShots.findings?.[0] || null,
		} : null,
		liveDiagnose: artifacts.liveDiagnose ? {
			zoomChecks: (artifacts.liveDiagnose.zoomChecks || []).map(z => ({
				name: z.name,
				ret: z.ret,
				err: z.err,
				canvasDataUrlLength: z.canvasDataUrlLength,
				canvasDataUrlSha256: z.canvasDataUrlSha256,
			})),
		} : null,
	},
};

writeFileSync(REPORT, JSON.stringify(acceptance, null, 2), 'utf8');
const next = spawnSync('node', ['engine/next_actions.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
if (next.error) console.warn(`next actions failed: ${next.error.message}`);
console.log(`acceptance ${acceptance.pass ? 'PASS' : 'FAIL'} mode=${acceptance.mode} hard=${acceptance.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(acceptance.pass ? 0 : 1);
