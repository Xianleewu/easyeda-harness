// 写回硬闸门：pipeline 全 PASS 后才生成/执行写回脚本
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { normalizeLiveWires, validateLive } from './validate.mjs';
import { pullStableDrc } from './drc_pull.mjs';
import { runBridge, runBridgeSave } from './bridge_run.mjs';
import { listEdaWindows } from './bridge_client.mjs';
import { validateTargetContext } from './target_context_gate.mjs';
import { netContractReport } from './net_contract.mjs';
import { auditLibraryManifest } from './library_manifest.mjs';
import { auditSeverityPolicy, auditReportSeverityZero } from './severity_policy.mjs';
import { auditDocumentStyleFromSnapshot } from './document_style_gate.mjs';
import { auditPageComposition } from './page_composition.mjs';
import { acquireRunLock } from '../workflows/run_lock.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
let LOCK;
try {
	LOCK = acquireRunLock(DIR);
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
let TARGET_WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';
const LIVE_SNAP = process.env.EASYEDA_LIVE_SNAP || DIR + 'live.json';
const APPLY_REPORT = process.env.EASYEDA_APPLY_REPORT || DIR + 'apply_report.json';
const LIVE_HARNESS_REPORT = process.env.EASYEDA_LIVE_HARNESS_REPORT || DIR + 'harness_live_report.json';
const TARGET_CONTEXT_FILE = process.env.EASYEDA_TARGET_CONTEXT || DIR + 'target_context_apply_gate.json';
const APPROVED_LIBRARY_MANIFEST = process.env.EASYEDA_APPROVED_LIBRARY_MANIFEST || DIR + 'approved_library_manifest.json';

process.on('exit', () => LOCK.release());
process.on('SIGINT', () => {
	LOCK.release();
	process.exit(130);
});
process.on('SIGTERM', () => {
	LOCK.release();
	process.exit(143);
});

async function requireEdaWindow() {
	const { bridge, windows } = await listEdaWindows();
	const health = bridge.health;
	if (health.service !== 'easyeda-bridge') {
		throw new Error('unexpected bridge service response');
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

async function pullLive() {
	const snap = await runBridgeSave({ jsFile: DIR + 'snapshot2.js', outFile: LIVE_SNAP, windowId: TARGET_WINDOW_ID });
	console.log(`SAVED ${LIVE_SNAP}`);
	return snap;
}

function normalizeLiveContractModel(liveSnap) {
	return {
		components: liveSnap.components || [],
		netflags: liveSnap.netflags || [],
		wires: normalizeLiveWires(liveSnap),
	};
}

async function runBridgeScript(jsFile) {
	await runBridge({ jsFile, windowId: TARGET_WINDOW_ID });
}

async function runBridgeBestEffort(jsFile) {
	if (!existsSync(jsFile)) {
		console.warn(`post-process helper skipped, file not found: ${jsFile}`);
		return false;
	}
	try {
		await runBridgeScript(jsFile);
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
	execSync('node engine/acceptance_run.mjs', { cwd: DIR, stdio: 'inherit' });
} catch {
	console.error('ABORT: local acceptance gate failed, write-back blocked');
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
	const targetContext = await runBridgeSave({ jsFile: DIR + 'target_context.js', outFile: TARGET_CONTEXT_FILE, windowId: TARGET_WINDOW_ID });
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
	const applyArgs = ['engine/apply_run.mjs', '--force'];
	if (TARGET_WINDOW_ID) applyArgs.push('--window-id', TARGET_WINDOW_ID);
	const applyPs = spawnSync('node', applyArgs, {
		cwd: DIR,
		stdio: 'inherit',
		env: { ...process.env, EASYEDA_APPLY_RUN_AUTHORIZED: '1' },
	});
	if (applyPs.status !== 0) throw new Error('apply_run.mjs failed');
	const postProcess = {
		removeDuplicateTitleBlock: await runBridgeBestEffort(DIR + 'remove_duplicate_title_block.js'),
		deleteFakeNetTexts: await runBridgeBestEffort(DIR + 'delete_fake_net_texts.js'),
		fixWireNameAnchors: await runBridgeBestEffort(DIR + 'fix_wire_name_anchors.js'),
	};
	const liveSnap = await pullLive();
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
		const liveAcceptance = spawnSync('node', ['engine/acceptance_run.mjs', '--live'], {
			cwd: DIR,
			stdio: 'inherit',
			env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token, EASYEDA_WINDOW_ID: TARGET_WINDOW_ID },
		});
		if (liveAcceptance.status !== 0) {
			console.error('ABORT: live acceptance gate failed after write-back');
			process.exitCode = 1;
		} else {
			const finalEvidence = spawnSync('node', ['engine/final_evidence_gate.mjs', '--live'], {
				cwd: DIR,
				stdio: 'inherit',
				env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token },
			});
			if (finalEvidence.status !== 0) {
				console.error('ABORT: final evidence gate failed after write-back');
				process.exitCode = 1;
			} else {
				console.log('gate OK: template PASS, write-back done, live acceptance PASS, final evidence PASS');
			}
		}
	}
}
