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
steps.push(runStep('agent:instructions', 'node', ['engine/agent_instruction_gate.mjs']));
steps.push(runStep('gsd:plan', 'node', ['bin/easyeda-gsd.mjs', 'plan']));
steps.push(runStep('gsd:generate', 'node', ['bin/easyeda-gsd.mjs', 'generate']));
steps.push(runStep('spec:schema', 'node', ['engine/spec_schema_gate.mjs']));
steps.push(runStep('spec', 'node', ['engine/project_spec_gate.mjs']));
steps.push(runStep('contract', 'node', ['engine/project_contract_gate.mjs']));
steps.push(runStep('contract:rules', 'node', ['engine/project_rule_gate.mjs']));
steps.push(runStep('contract:pack', 'node', ['engine/project_pack_gate.mjs']));
steps.push(runStep('contract:cells', 'node', ['engine/project_cell_manifest_gate.mjs']));
steps.push(runStep('contract:assembly', 'node', ['engine/project_assembly_gate.mjs']));
steps.push(runStep('fast', 'node', ['engine/pipeline_fast.mjs']));
steps.push(runStep('pipeline', 'node', ['engine/pipeline.mjs']));
steps.push(runStep('contract:layout', 'node', ['engine/project_layout_gate.mjs']));
steps.push(runStep('contract:model', 'node', ['engine/project_model_gate.mjs']));
steps.push(runStep('contract:netlist', 'node', ['engine/project_netlist_gate.mjs']));
steps.push(runStep('preview', 'node', ['engine/visual_crops.mjs']));
steps.push(runStep('contract:visual', 'node', ['engine/project_visual_gate.mjs']));

if (RUN_LIVE) {
	steps.push(runStep('live:save', 'node', ['engine/bridge_exec.mjs', '--js', 'snapshot2.js', '--out', 'live.json']));
	steps.push(runStep('contract:live:model', 'node', ['engine/project_live_model_gate.mjs']));
	steps.push(runStep('live:image', 'node', ['engine/bridge_exec.mjs', '--js', 'snapshot-image.js', '--out', 'live_canvas.png', '--mode', 'image']));
	steps.push(runStep('drc', 'node', ['engine/drc_check.mjs']));
	const liveShots = runStep('live:shots', 'node', ['engine/live_shots.mjs']);
	steps.push(liveShots);
	if (!liveShots.pass) steps.push(runStep('live:diagnose', 'node', ['engine/live_diagnose.mjs'], { required: false }));
}

const artifacts = {};
for (const [key, path] of Object.entries({
	report: DIR + 'report.json',
	agentInstructions: DIR + 'agent_instruction_report.json',
	gsdPlan: DIR + 'gsd_plan_report.json',
	gsdGenerate: DIR + 'gsd_generate_report.json',
	specSchema: DIR + 'spec_schema_report.json',
	projectSpec: DIR + 'project_spec_report.json',
	projectContract: DIR + 'project_contract_report.json',
	projectRules: DIR + 'project_rule_report.json',
	projectPack: DIR + 'project_pack_report.json',
	cellManifest: DIR + 'cell_manifest_report.json',
	projectAssembly: DIR + 'project_assembly_report.json',
	projectLayout: DIR + 'project_layout_report.json',
	projectModel: DIR + 'project_model_report.json',
	projectNetlist: DIR + 'project_netlist_report.json',
	projectLiveModel: DIR + 'project_live_model_report.json',
	projectVisual: DIR + 'project_visual_report.json',
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
			agentInstructions: steps.find(s => s.name === 'agent:instructions')?.pass === true,
			gsdPlan: steps.find(s => s.name === 'gsd:plan')?.pass === true,
			gsdGenerate: steps.find(s => s.name === 'gsd:generate')?.pass === true,
			specSchema: steps.find(s => s.name === 'spec:schema')?.pass === true,
			spec: steps.find(s => s.name === 'spec')?.pass === true,
			contract: steps.find(s => s.name === 'contract')?.pass === true,
			projectRules: steps.find(s => s.name === 'contract:rules')?.pass === true,
			projectPack: steps.find(s => s.name === 'contract:pack')?.pass === true,
			cellManifest: steps.find(s => s.name === 'contract:cells')?.pass === true,
			projectAssembly: steps.find(s => s.name === 'contract:assembly')?.pass === true,
			fast: steps.find(s => s.name === 'fast')?.pass === true,
			pipeline: steps.find(s => s.name === 'pipeline')?.pass === true,
			projectLayout: steps.find(s => s.name === 'contract:layout')?.pass === true,
			projectModel: steps.find(s => s.name === 'contract:model')?.pass === true,
			projectNetlist: steps.find(s => s.name === 'contract:netlist')?.pass === true,
			preview: steps.find(s => s.name === 'preview')?.pass === true,
			projectVisual: steps.find(s => s.name === 'contract:visual')?.pass === true,
		},
		live: RUN_LIVE ? {
			save: steps.find(s => s.name === 'live:save')?.pass === true,
			projectLiveModel: steps.find(s => s.name === 'contract:live:model')?.pass === true,
			image: steps.find(s => s.name === 'live:image')?.pass === true,
			drc: steps.find(s => s.name === 'drc')?.pass === true,
			shots: steps.find(s => s.name === 'live:shots')?.pass === true,
			diagnose: steps.find(s => s.name === 'live:diagnose')?.pass === true,
		} : null,
	},
	artifacts: {
		report: artifacts.report ? { pass: artifacts.report.pass, severity: artifacts.report.severity, score: artifacts.report.score } : null,
		agentInstructions: artifacts.agentInstructions ? { pass: artifacts.agentInstructions.pass, severity: artifacts.agentInstructions.severity, filesChecked: artifacts.agentInstructions.filesChecked } : null,
		gsdPlan: artifacts.gsdPlan ? { pass: artifacts.gsdPlan.pass, severity: artifacts.gsdPlan.severity, projectId: artifacts.gsdPlan.projectId, circuitPack: artifacts.gsdPlan.circuitPack, modules: artifacts.gsdPlan.modules } : null,
		gsdGenerate: artifacts.gsdGenerate ? { pass: artifacts.gsdGenerate.pass, severity: artifacts.gsdGenerate.severity, projectId: artifacts.gsdGenerate.projectId, circuitPack: artifacts.gsdGenerate.circuitPack, generated: artifacts.gsdGenerate.generated } : null,
		specSchema: artifacts.specSchema ? { pass: artifacts.specSchema.pass, severity: artifacts.specSchema.severity, projectId: artifacts.specSchema.projectId, modules: artifacts.specSchema.modules, interfaces: artifacts.specSchema.interfaces } : null,
		projectSpec: artifacts.projectSpec ? { pass: artifacts.projectSpec.pass, severity: artifacts.projectSpec.severity, projectId: artifacts.projectSpec.projectId, modules: artifacts.projectSpec.modules, interfaces: artifacts.projectSpec.interfaces } : null,
		projectContract: artifacts.projectContract ? { pass: artifacts.projectContract.pass, severity: artifacts.projectContract.severity, projectId: artifacts.projectContract.projectId, modules: artifacts.projectContract.modules, interfaces: artifacts.projectContract.interfaces } : null,
		projectRules: artifacts.projectRules ? { pass: artifacts.projectRules.pass, severity: artifacts.projectRules.severity, projectId: artifacts.projectRules.projectId, registeredRules: artifacts.projectRules.registeredRules, registeredModules: artifacts.projectRules.registeredModules, registeredInterfaces: artifacts.projectRules.registeredInterfaces } : null,
		projectPack: artifacts.projectPack ? { pass: artifacts.projectPack.pass, severity: artifacts.projectPack.severity, circuitPack: artifacts.projectPack.circuitPack, registeredPacks: artifacts.projectPack.registeredPacks } : null,
		cellManifest: artifacts.cellManifest ? { pass: artifacts.cellManifest.pass, severity: artifacts.cellManifest.severity, packId: artifacts.cellManifest.packId, cellCount: artifacts.cellManifest.cellCount, assemblyCells: artifacts.cellManifest.assemblyCells } : null,
		projectAssembly: artifacts.projectAssembly ? { pass: artifacts.projectAssembly.pass, severity: artifacts.projectAssembly.severity, projectId: artifacts.projectAssembly.projectId, modules: artifacts.projectAssembly.modules, anchors: artifacts.projectAssembly.anchors, cellTypes: artifacts.projectAssembly.cellTypes } : null,
		projectLayout: artifacts.projectLayout ? { pass: artifacts.projectLayout.pass, severity: artifacts.projectLayout.severity, projectId: artifacts.projectLayout.projectId, candidateSource: artifacts.projectLayout.candidateSource, totalCandidates: artifacts.projectLayout.totalCandidates, minModuleGap: artifacts.projectLayout.minModuleGap, moduleWireIntrusions: artifacts.projectLayout.moduleWireIntrusions, laneInterlocks: artifacts.projectLayout.laneInterlocks } : null,
		projectModel: artifacts.projectModel ? { pass: artifacts.projectModel.pass, severity: artifacts.projectModel.severity, projectId: artifacts.projectModel.projectId, modelStats: artifacts.projectModel.modelStats } : null,
		projectNetlist: artifacts.projectNetlist ? { pass: artifacts.projectNetlist.pass, severity: artifacts.projectNetlist.severity, projectId: artifacts.projectNetlist.projectId, stats: artifacts.projectNetlist.stats } : null,
		projectLiveModel: artifacts.projectLiveModel ? { pass: artifacts.projectLiveModel.pass, severity: artifacts.projectLiveModel.severity, projectId: artifacts.projectLiveModel.projectId, source: artifacts.projectLiveModel.source, liveStats: artifacts.projectLiveModel.liveStats } : null,
		projectVisual: artifacts.projectVisual ? { pass: artifacts.projectVisual.pass, severity: artifacts.projectVisual.severity, projectId: artifacts.projectVisual.projectId, requiredRegions: artifacts.projectVisual.requiredRegions, availableRegions: artifacts.projectVisual.availableRegions } : null,
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
const repair = spawnSync('node', ['engine/repair_actions.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
if (repair.error) console.warn(`repair actions failed: ${repair.error.message}`);
const next = spawnSync('node', ['engine/next_actions.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
if (next.error) console.warn(`next actions failed: ${next.error.message}`);
const actionSchema = spawnSync('node', ['engine/action_schema_gate.mjs'], { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
if (actionSchema.error) console.warn(`action schema failed: ${actionSchema.error.message}`);
const finalEvidenceArgs = RUN_LIVE ? ['engine/final_evidence_gate.mjs', '--live'] : ['engine/final_evidence_gate.mjs'];
const finalEvidence = spawnSync('node', finalEvidenceArgs, { cwd: DIR, stdio: 'inherit', shell: false, env: process.env });
if (finalEvidence.error) console.warn(`final evidence failed: ${finalEvidence.error.message}`);
const postSteps = [
	{ name: 'repair:actions', status: repair.status, pass: repair.status === 0, required: true },
	{ name: 'next:actions', status: next.status, pass: next.status === 0, required: true },
	{ name: 'action:schema', status: actionSchema.status, pass: actionSchema.status === 0, required: true },
	{ name: 'final:evidence', status: finalEvidence.status, pass: finalEvidence.status === 0, required: true },
];
steps.push(...postSteps.map(step => ({ ...step, command: step.name, durationMs: 0, error: '' })));
const finalRequiredFailed = steps.filter(s => s.required && !s.pass);
acceptance.pass = finalRequiredFailed.length === 0;
acceptance.severity = { hard: finalRequiredFailed.length, soft: 0, info: 0 };
acceptance.summary.local.repairActions = repair.status === 0;
acceptance.summary.local.nextActions = next.status === 0;
acceptance.summary.local.actionSchema = actionSchema.status === 0;
acceptance.summary.local.finalEvidence = finalEvidence.status === 0;
writeFileSync(REPORT, JSON.stringify(acceptance, null, 2), 'utf8');
console.log(`acceptance ${acceptance.pass ? 'PASS' : 'FAIL'} mode=${acceptance.mode} hard=${acceptance.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(acceptance.pass ? 0 : 1);
