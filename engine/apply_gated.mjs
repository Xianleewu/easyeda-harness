// 写回硬闸门：pipeline 全 PASS 后才生成/执行写回脚本
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { normalizeLiveWires, validateLive } from './validate.mjs';
import { pullStableDrc } from './drc_pull.mjs';
import { runBridgeSave } from './bridge_run.mjs';
import { validateTargetContext } from './target_context_gate.mjs';
import { netContractReport } from './net_contract.mjs';
import { auditLibraryManifest } from './library_manifest.mjs';
import { auditSeverityPolicy, auditReportSeverityZero } from './severity_policy.mjs';
import { auditDocumentStyleFromSnapshot } from './document_style_gate.mjs';
import { auditPageComposition } from './page_composition.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
let TARGET_WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';
const LIVE_SNAP = process.env.EASYEDA_LIVE_SNAP || DIR + 'live.json';
const APPLY_REPORT = process.env.EASYEDA_APPLY_REPORT || DIR + 'apply_report.json';
const LIVE_HARNESS_REPORT = process.env.EASYEDA_LIVE_HARNESS_REPORT || DIR + 'harness_live_report.json';
const TARGET_CONTEXT_FILE = process.env.EASYEDA_TARGET_CONTEXT || DIR + 'target_context_apply_gate.json';
const APPROVED_LIBRARY_MANIFEST = process.env.EASYEDA_APPROVED_LIBRARY_MANIFEST || DIR + 'approved_library_manifest.json';

async function findBridge() {
	for (let port = 49620; port <= 49629; port++) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/health`);
			const h = await r.json();
			if (h.service === 'easyeda-bridge') return { port, base: `http://127.0.0.1:${port}`, health: h };
		} catch {}
	}
	throw new Error('EasyEDA bridge service not found on ports 49620-49629');
}

async function requireEdaWindow() {
	const bridge = await findBridge();
	const health = bridge.health;
	if (health.service !== 'easyeda-bridge') {
		throw new Error('unexpected bridge service response');
	}
	let windows;
	try {
		const r = await fetch(`${bridge.base}/eda-windows`);
		windows = await r.json();
	} catch (e) {
		throw new Error(`failed to query EDA windows: ${e.message}`);
	}
	if (!health.edaConnected || !windows.count) {
		throw new Error('no EasyEDA window connected, write-back blocked');
	}
	if (TARGET_WINDOW_ID) {
		if (!(windows.windows || []).some(w => w.windowId === TARGET_WINDOW_ID && w.connected)) {
			throw new Error(`target EasyEDA window is not connected: ${TARGET_WINDOW_ID}`);
		}
	} else {
		TARGET_WINDOW_ID = windows.activeWindowId || health.activeWindowId || (windows.windows || []).find(w => w.connected)?.windowId || '';
		if (!TARGET_WINDOW_ID) throw new Error('connected EasyEDA window has no active window id');
	}
	return bridge;
}

function pullLive() {
	const args = [
		'-ExecutionPolicy', 'Bypass', '-File', `${DIR}run-save.ps1`,
		'-JsFile', `${DIR}snapshot2.js`, '-OutFile', LIVE_SNAP,
	];
	if (TARGET_WINDOW_ID) args.push('-WindowId', TARGET_WINDOW_ID);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: DIR });
	if (ps.status !== 0)
		throw new Error(`live snapshot pull failed: ${ps.stdout || ps.stderr}`);
	console.log(ps.stdout.trim());
	return JSON.parse(readFileSync(LIVE_SNAP, 'utf8').replace(/^\uFEFF/, ''));
}

function normalizeLiveContractModel(liveSnap) {
	return {
		components: liveSnap.components || [],
		netflags: liveSnap.netflags || [],
		wires: normalizeLiveWires(liveSnap),
	};
}

function runBridge(jsFile) {
	const args = [
		'-ExecutionPolicy', 'Bypass', '-File', `${DIR}run.ps1`,
		'-JsFile', jsFile,
	];
	if (TARGET_WINDOW_ID) args.push('-WindowId', TARGET_WINDOW_ID);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: DIR, stdio: 'inherit' });
	if (ps.status !== 0) throw new Error(`${jsFile} failed`);
}

function runBridgeBestEffort(jsFile) {
	try {
		runBridge(jsFile);
		return true;
	} catch (e) {
		console.warn(`post-process helper failed, live gate will decide: ${jsFile} ${e && e.message ? e.message : String(e)}`);
		return false;
	}
}

function saveApplyReport(report) {
	writeFileSync(APPLY_REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
	console.log(`apply_report -> ${APPLY_REPORT}`);
}

function runHarness(snapPath, reportPath, label) {
	const reportFile = isAbsolute(reportPath) ? reportPath : join(DIR, reportPath);
	try {
		execSync(`node harness/harness.mjs ${snapPath} ${reportPath}`, { cwd: DIR, stdio: 'inherit' });
		return JSON.parse(readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));
	} catch {
		console.error(`ABORT: ${label} schematic harness failed`);
		try {
			return JSON.parse(readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));
		} catch {
			return { pass: false, score: 0, severity: { hard: 1, soft: 0, info: 0 }, byRule: { harness: 1 } };
		}
	}
}

try {
	const pipeline = process.env.EASYEDA_LAYOUT_SEARCH === '1' ? 'node engine/pipeline.mjs' : 'node engine/pipeline_fast.mjs';
	execSync(pipeline, { cwd: DIR, stdio: 'inherit' });
	execSync('node engine/commercial_gate.mjs --offline', { cwd: DIR, stdio: 'inherit' });
} catch {
	console.error('ABORT: offline commercial gate failed, write-back blocked');
	process.exit(1);
}
const rep = JSON.parse(readFileSync(DIR + 'report.json', 'utf8').replace(/^\uFEFF/, ''));
if (!rep.pass) {
	console.error('ABORT: report.pass=false, write-back blocked');
	process.exit(1);
}
try {
	const modelHarness = runHarness('full_model.json', 'harness_model_report.json', 'model');
	if (!modelHarness.pass) process.exit(1);
} catch {
	console.error('ABORT: schematic harness failed, write-back blocked');
	process.exit(1);
}
try {
	await requireEdaWindow();
} catch (e) {
	console.error(`ABORT: ${e.message}`);
	process.exitCode = 1;
} 
if (!process.exitCode) {
	const targetContext = runBridgeSave({ dir: DIR, jsFile: DIR + 'target_context.js', outFile: TARGET_CONTEXT_FILE, windowId: TARGET_WINDOW_ID });
	const targetGate = validateTargetContext(targetContext);
	if (!targetGate.pass) {
		saveApplyReport({
			template: { pass: rep.pass, score: rep.score, severity: rep.severity },
			target: targetGate,
		});
		console.error('ABORT: target context gate failed, write-back blocked');
		process.exit(1);
	}
	const expectedModel = JSON.parse(readFileSync(DIR + 'full_model.json', 'utf8').replace(/^\uFEFF/, ''));
	const approvedLibraryManifest = JSON.parse(readFileSync(APPROVED_LIBRARY_MANIFEST, 'utf8').replace(/^\uFEFF/, ''));
	const modelNetContract = netContractReport(expectedModel);
	if (!modelNetContract.pass) {
		saveApplyReport({
			template: { pass: rep.pass, score: rep.score, severity: rep.severity },
			target: targetGate,
			modelNetContract,
		});
		console.error('ABORT: model net contract failed, write-back blocked');
		process.exit(1);
	}
	execSync('node engine/apply_full.mjs', {
		cwd: DIR,
		stdio: 'inherit',
		env: { ...process.env, EASYEDA_APPLY_FULL_AUTHORIZED: '1' },
	});
	const applyArgs = ['-ExecutionPolicy', 'Bypass', '-File', 'apply_run.ps1', '-Force'];
	if (TARGET_WINDOW_ID) applyArgs.push('-WindowId', TARGET_WINDOW_ID);
	const applyPs = spawnSync('powershell', applyArgs, {
		cwd: DIR,
		stdio: 'inherit',
		env: { ...process.env, EASYEDA_APPLY_RUN_AUTHORIZED: '1' },
	});
	if (applyPs.status !== 0) throw new Error('apply_run.ps1 failed');
	const postProcess = {
		clearStandardizationState: runBridgeBestEffort(DIR + 'clear_standardization_state.js'),
		hidePartNameAttrs: runBridgeBestEffort(DIR + 'hide_part_name_attrs.js'),
		normalizeVisibleAttrPlacement: runBridgeBestEffort(DIR + 'normalize_visible_attr_placement.js'),
		normalizeRepeatedPartAttrs: runBridgeBestEffort(DIR + 'normalize_repeated_part_attrs.js'),
		repairRepeatedLibraryBindings: runBridgeBestEffort(DIR + 'repair_repeated_library_bindings_live.js'),
	};
	const liveSnap = pullLive();
	const liveHarness = runHarness(LIVE_SNAP, LIVE_HARNESS_REPORT, 'live');
	const documentStyle = auditDocumentStyleFromSnapshot(liveSnap);
	const pageComposition = auditPageComposition(liveSnap);
	const drcResult = await pullStableDrc();
	const liveResult = validateLive(liveSnap, { drc: true, drcResult, expectedModel });
	const liveNetContract = netContractReport(normalizeLiveContractModel(liveSnap));
	const liveLibraryManifest = auditLibraryManifest(liveSnap, approvedLibraryManifest);
	let severityPolicy = auditSeverityPolicy();
	const hard = liveResult.findings.filter(f => f.severity === 'hard').length;
	const applyReport = {
		template: { pass: rep.pass, score: rep.score, severity: rep.severity },
		target: targetGate,
		postProcess,
		modelNetContract,
		liveHarness: { pass: liveHarness.pass, score: liveHarness.score, severity: liveHarness.severity, byRule: liveHarness.byRule },
		pageComposition,
		documentStyle,
		liveNetContract,
		liveLibraryManifest,
		severityPolicy,
		live: { pass: liveResult.pass, score: liveResult.score, severity: liveResult.bySev, findings: liveResult.findings },
		drc: drcResult,
	};
	const reportSeverity = auditReportSeverityZero(applyReport);
	severityPolicy = {
		pass: severityPolicy.pass && reportSeverity.pass,
		severity: { hard: severityPolicy.severity.hard + reportSeverity.severity.hard, soft: 0, info: 0 },
		stats: { ...severityPolicy.stats, checkedSeverityNodes: reportSeverity.stats.checkedSeverityNodes },
		findings: [...severityPolicy.findings, ...reportSeverity.findings],
	};
	applyReport.severityPolicy = severityPolicy;
	saveApplyReport(applyReport);
	if (!liveHarness.pass || !pageComposition.pass || !documentStyle.pass || !liveNetContract.pass || !liveLibraryManifest.pass || !severityPolicy.pass || !liveResult.pass || hard > 0 || !drcResult.strictPass || (drcResult.errors || 0) || (drcResult.warnings || 0) || (drcResult.info || 0)) {
		console.error(`ABORT: live verification failed, hard=${hard}`);
		process.exitCode = 1;
	} else {
		const liveCommercial = spawnSync('node', ['engine/commercial_gate.mjs'], {
			cwd: DIR,
			stdio: 'inherit',
			env: { ...process.env, EASYEDA_WINDOW_ID: TARGET_WINDOW_ID },
		});
		if (liveCommercial.status !== 0) {
			console.error('ABORT: live commercial gate failed after write-back');
			process.exitCode = 1;
		} else {
			execSync('node engine/acceptance_audit.mjs', { cwd: DIR, stdio: 'inherit' });
			console.log('gate OK: template PASS, write-back done, live commercial gate PASS');
		}
	}
}
