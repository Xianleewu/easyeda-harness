import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeNextActions } from '../workflows/action_schema.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_NEXT_ACTIONS || DIR + 'next_actions.json';

function readJson(name) {
	const path = DIR + name;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message, path };
	}
}

function status(pass) {
	return pass === true ? 'pass' : pass === false ? 'fail' : 'missing';
}

function pushAction(actions, item) {
	actions.push({
		priority: actions.length + 1,
		...item,
	});
}

const acceptance = readJson('acceptance_report.json');
const agentInstructions = readJson('agent_instruction_report.json');
const workflowSmoke = readJson('workflow_smoke_report.json');
const gsdPlan = readJson('gsd_plan_report.json');
const gsdGenerate = readJson('gsd_generate_report.json');
const specSchema = readJson('spec_schema_report.json');
const spec = readJson('project_spec_report.json');
const contract = readJson('project_contract_report.json');
const projectRules = readJson('project_rule_report.json');
const projectPack = readJson('project_pack_report.json');
const projectLibrary = readJson('project_library_report.json');
const cellManifest = readJson('cell_manifest_report.json');
const projectAssembly = readJson('project_assembly_report.json');
const projectLayout = readJson('project_layout_report.json');
const projectModel = readJson('project_model_report.json');
const projectNetlist = readJson('project_netlist_report.json');
const projectLiveModel = readJson('project_live_model_report.json');
const projectVisual = readJson('project_visual_report.json');
const template = readJson('report.json');
const preview = readJson('visual_review_report.json');
const drc = readJson('drc_report.json');
const liveShots = readJson('live_shots_report.json');
const liveDiagnose = readJson('live_diagnose_report.json');
const repair = readJson('repair_actions.json');
const finalEvidence = readJson('final_evidence_report.json');

const checks = {
	agentInstructions: {
		status: status(agentInstructions?.pass),
		severity: agentInstructions?.severity || null,
		filesChecked: agentInstructions?.filesChecked || null,
		firstFinding: agentInstructions?.findings?.[0] || null,
		evidence: 'agent_instruction_report.json',
	},
	workflowSmoke: {
		status: status(workflowSmoke?.pass),
		severity: workflowSmoke?.severity || null,
		checks: workflowSmoke?.checks || null,
		firstFinding: workflowSmoke?.findings?.[0] || null,
		evidence: 'workflow_smoke_report.json',
	},
	gsdPlan: {
		status: status(gsdPlan?.pass),
		severity: gsdPlan?.severity || null,
		projectId: gsdPlan?.projectId || null,
		circuitPack: gsdPlan?.circuitPack || null,
		modules: gsdPlan?.modules || null,
		firstFinding: gsdPlan?.findings?.[0] || null,
		evidence: 'gsd_plan_report.json',
	},
	gsdGenerate: {
		status: status(gsdGenerate?.pass),
		severity: gsdGenerate?.severity || null,
		projectId: gsdGenerate?.projectId || null,
		circuitPack: gsdGenerate?.circuitPack || null,
		firstFinding: gsdGenerate?.findings?.[0] || null,
		evidence: 'gsd_generate_report.json',
	},
	specSchema: {
		status: status(specSchema?.pass),
		severity: specSchema?.severity || null,
		projectId: specSchema?.projectId || null,
		modules: specSchema?.modules ?? null,
		interfaces: specSchema?.interfaces ?? null,
		firstFinding: specSchema?.findings?.[0] || null,
		evidence: 'spec_schema_report.json',
	},
	spec: {
		status: status(spec?.pass),
		severity: spec?.severity || null,
		projectId: spec?.projectId || null,
		modules: spec?.modules ?? null,
		interfaces: spec?.interfaces ?? null,
		firstFinding: spec?.findings?.[0] || null,
		evidence: 'project_spec_report.json',
	},
	contract: {
		status: status(contract?.pass),
		severity: contract?.severity || null,
		projectId: contract?.projectId || null,
		modules: contract?.modules ?? null,
		interfaces: contract?.interfaces ?? null,
		visualEvidenceRegions: contract?.visualEvidenceRegions ?? null,
		firstFinding: contract?.findings?.[0] || null,
		evidence: 'project_contract_report.json',
	},
	projectRules: {
		status: status(projectRules?.pass),
		severity: projectRules?.severity || null,
		projectId: projectRules?.projectId || null,
		registeredRules: projectRules?.registeredRules ?? null,
		registeredModules: projectRules?.registeredModules ?? null,
		registeredInterfaces: projectRules?.registeredInterfaces ?? null,
		firstFinding: projectRules?.findings?.[0] || null,
		evidence: 'project_rule_report.json',
	},
	projectPack: {
		status: status(projectPack?.pass),
		severity: projectPack?.severity || null,
		circuitPack: projectPack?.circuitPack || null,
		registeredPacks: projectPack?.registeredPacks || null,
		firstFinding: projectPack?.findings?.[0] || null,
		evidence: 'project_pack_report.json',
	},
	projectLibrary: {
		status: status(projectLibrary?.pass),
		severity: projectLibrary?.severity || null,
		projectId: projectLibrary?.projectId || null,
		stats: projectLibrary?.stats || null,
		firstFinding: projectLibrary?.findings?.[0] || null,
		evidence: 'project_library_report.json',
	},
	cellManifest: {
		status: status(cellManifest?.pass),
		severity: cellManifest?.severity || null,
		packId: cellManifest?.packId || null,
		cellCount: cellManifest?.cellCount ?? null,
		assemblyCells: cellManifest?.assemblyCells || null,
		firstFinding: cellManifest?.findings?.[0] || null,
		evidence: 'cell_manifest_report.json',
	},
	projectAssembly: {
		status: status(projectAssembly?.pass),
		severity: projectAssembly?.severity || null,
		projectId: projectAssembly?.projectId || null,
		modules: projectAssembly?.modules ?? null,
		anchors: projectAssembly?.anchors ?? null,
		cellTypes: projectAssembly?.cellTypes ?? null,
		firstFinding: projectAssembly?.findings?.[0] || null,
		evidence: 'project_assembly_report.json',
	},
	projectLayout: {
		status: status(projectLayout?.pass),
		severity: projectLayout?.severity || null,
		projectId: projectLayout?.projectId || null,
		candidateSource: projectLayout?.candidateSource || null,
		totalCandidates: projectLayout?.totalCandidates ?? null,
		minModuleGap: projectLayout?.minModuleGap ?? null,
		moduleWireIntrusions: projectLayout?.moduleWireIntrusions ?? null,
		laneInterlocks: projectLayout?.laneInterlocks ?? null,
		firstFinding: projectLayout?.findings?.[0] || null,
		evidence: 'project_layout_report.json',
	},
	template: {
		status: status(template?.pass),
		severity: template?.severity || null,
		evidence: 'report.json',
	},
	projectModel: {
		status: status(projectModel?.pass),
		severity: projectModel?.severity || null,
		projectId: projectModel?.projectId || null,
		modelStats: projectModel?.modelStats || null,
		firstFinding: projectModel?.findings?.[0] || null,
		evidence: 'project_model_report.json',
	},
	projectNetlist: {
		status: status(projectNetlist?.pass),
		severity: projectNetlist?.severity || null,
		projectId: projectNetlist?.projectId || null,
		stats: projectNetlist?.stats || null,
		firstFinding: projectNetlist?.findings?.[0] || null,
		evidence: 'project_netlist_report.json',
	},
	projectLiveModel: {
		status: status(projectLiveModel?.pass),
		severity: projectLiveModel?.severity || null,
		projectId: projectLiveModel?.projectId || null,
		source: projectLiveModel?.source || null,
		liveStats: projectLiveModel?.liveStats || null,
		firstFinding: projectLiveModel?.findings?.[0] || null,
		evidence: 'project_live_model_report.json',
	},
	projectVisual: {
		status: status(projectVisual?.pass),
		severity: projectVisual?.severity || null,
		projectId: projectVisual?.projectId || null,
		requiredRegions: projectVisual?.requiredRegions || null,
		availableRegions: projectVisual?.availableRegions || null,
		firstFinding: projectVisual?.findings?.[0] || null,
		evidence: 'project_visual_report.json',
	},
	preview: {
		status: status(preview?.pass),
		screenshots: preview?.screenshots || 0,
		severity: preview?.severity || null,
		evidence: 'visual_review_report.json',
	},
	acceptance: {
		status: status(acceptance?.pass),
		mode: acceptance?.mode || null,
		context: acceptance?.context || null,
		severity: acceptance?.severity || null,
		evidence: 'acceptance_report.json',
	},
	drc: {
		status: status(drc?.pass),
		severity: drc?.severity || null,
		counts: drc?.drc ? {
			errors: drc.drc.errors ?? null,
			warnings: drc.drc.warnings ?? null,
			info: drc.drc.info ?? null,
			source: drc.drc.source || null,
		} : null,
		evidence: 'drc_report.json',
	},
	liveShots: {
		status: status(liveShots?.pass),
		screenshots: liveShots?.screenshots || 0,
		captureMode: liveShots?.captureMode || null,
		fallbackDiagnosticOnly: liveShots?.fallbackDiagnosticOnly === true,
		zoomEvidence: liveShots?.zoomEvidence ? {
			requestedRegions: liveShots.zoomEvidence.requestedRegions,
			uniqueRequestedCaptures: liveShots.zoomEvidence.uniqueRequestedCaptures,
		} : null,
		firstFinding: liveShots?.findings?.[0] || null,
		evidence: 'live_shots_report.json',
	},
	liveDiagnose: {
		status: liveDiagnose ? 'available' : 'missing',
		zoomChecks: (liveDiagnose?.zoomChecks || []).map(z => ({
			name: z.name,
			ret: z.ret,
			err: z.err,
			canvasDataUrlSha256: z.canvasDataUrlSha256,
			canvasDataUrlLength: z.canvasDataUrlLength,
		})),
		evidence: 'live_diagnose_report.json',
	},
	repairActions: {
		status: status(repair?.pass),
		severity: repair?.severity || null,
		actionCount: repair?.actionCount ?? null,
		firstAction: repair?.actions?.[0] || null,
		evidence: 'repair_actions.json',
	},
	finalEvidence: {
		status: status(finalEvidence?.pass),
		mode: finalEvidence?.mode || null,
		context: finalEvidence?.context || null,
		severity: finalEvidence?.severity || null,
		firstFinding: finalEvidence?.findings?.[0] || null,
		evidence: 'final_evidence_report.json',
	},
};

const actions = [];
if (checks.agentInstructions.status !== 'pass') {
	pushAction(actions, {
		area: 'agent-instructions',
		action: 'Fix Codex/Claude-facing instructions so agents are forced through project spec, contract, netlist, assembly, local gates, live evidence, and fail-closed apply:gated instead of free-drawing in EasyEDA.',
		evidence: ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.en.md', 'agent_instruction_report.json'],
		observed: checks.agentInstructions.firstFinding || checks.agentInstructions,
	});
}
if (checks.workflowSmoke.status !== 'pass') {
	pushAction(actions, {
		area: 'workflow-smoke',
		action: 'Fix reusable workflow smoke checks before claiming the harness works for other projects. Bad specs must be rejected, scaffold must not be generation-ready, missing library bindings must fail, and invalid generate must not rewrite full_model.json.',
		evidence: ['workflow_smoke_report.json', 'engine/workflow_smoke_gate.mjs', 'workflows/gsd_plan.mjs', 'workflows/gsd_generate.mjs', 'workflows/gsd_scaffold.mjs', 'contracts/library_contract.mjs'],
		observed: checks.workflowSmoke.firstFinding || checks.workflowSmoke,
	});
}
if (checks.gsdPlan.status !== 'pass') {
	pushAction(actions, {
		area: 'gsd-plan',
		action: 'Fix spec-to-contract realization before generation. gsd_plan_report.json must prove project_spec.json is covered by project_contract.json, project_netlist.json, project_assembly.json, and a registered circuit pack.',
		evidence: ['project_spec.json', 'project_contract.json', 'project_netlist.json', 'project_assembly.json', 'gsd_plan_report.json'],
		observed: checks.gsdPlan.firstFinding || checks.gsdPlan,
	});
}
if (checks.gsdGenerate.status !== 'pass') {
	pushAction(actions, {
		area: 'gsd-generate',
		action: 'Run generation only through the plan-gated workflow. gsd_generate_report.json must prove a passing GSD plan produced full_model.json and report.json from the deterministic generator.',
		evidence: ['gsd_generate_report.json', 'gsd_plan_report.json', 'full_model.json', 'report.json'],
		observed: checks.gsdGenerate.firstFinding || checks.gsdGenerate,
	});
}
if (checks.specSchema.status !== 'pass') {
	pushAction(actions, {
		area: 'spec-schema',
		action: 'Fix project_spec.json shape before deriving contracts or editing schematic cells. The spec must be the first valid user-intent input.',
		evidence: ['project_spec.json', 'spec_schema_report.json'],
		observed: checks.specSchema.firstFinding || checks.specSchema,
	});
}
if (checks.spec.status !== 'pass') {
	pushAction(actions, {
		area: 'project-spec',
		action: 'Create or fix project_spec.json first. The spec is the user-intent input and must be covered by project_contract.json before cells, assembly, or write-back work can be trusted.',
		evidence: ['project_spec.json', 'project_contract.json', 'project_spec_report.json'],
		observed: checks.spec.firstFinding || checks.spec,
	});
}
if (checks.contract.status !== 'pass') {
	pushAction(actions, {
		area: 'project-contract',
		action: 'Create or fix project_contract.json before editing schematic cells or writing back. The contract must define modules, required parts/nets, interfaces, visual evidence regions, and no-free-draw policy.',
		evidence: ['project_contract.json', 'project_contract_report.json'],
		observed: checks.contract.firstFinding || checks.contract,
	});
}
if (checks.projectRules.status !== 'pass') {
	pushAction(actions, {
		area: 'project-rules',
		action: 'Make harness rule registries cover project_contract.json. Update module registry, required parts, interface contracts, or rule registration before trusting template PASS.',
		evidence: ['project_contract.json', 'harness/module_registry.mjs', 'engine/interface_contract.mjs', 'harness/rule_registry.mjs', 'project_rule_report.json'],
		observed: checks.projectRules.firstFinding || checks.projectRules,
	});
}
if (checks.projectPack.status !== 'pass') {
	pushAction(actions, {
		area: 'project-pack',
		action: 'Fix the selected circuit pack before trusting generation. project_assembly.json must reference a registered pack with builders, fallback anchors, library normalization, and matching cell manifest.',
		evidence: ['project_assembly.json', 'circuit_packs/registry.mjs', 'circuit_packs/<pack>/pack.mjs', 'project_pack_report.json'],
		observed: checks.projectPack.firstFinding || checks.projectPack,
	});
}
if (checks.projectLibrary.status !== 'pass') {
	pushAction(actions, {
		area: 'project-library',
		action: 'Fix approved_library_manifest.json or project_contract.json so every required part has approved Symbol/Device/Footprint bindings before generation or write-back.',
		evidence: ['approved_library_manifest.json', 'project_contract.json', 'project_library_report.json'],
		observed: checks.projectLibrary.firstFinding || checks.projectLibrary,
	});
}
if (checks.cellManifest.status !== 'pass') {
	pushAction(actions, {
		area: 'cell-manifest',
		action: 'Make the selected circuit-pack cell manifest declare every deterministic cell used by project_assembly.json and match the implemented builders before trusting assembly generation.',
		evidence: ['circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly.json', 'cell_manifest_report.json'],
		observed: checks.cellManifest.firstFinding || checks.cellManifest,
	});
}
if (checks.projectAssembly.status !== 'pass') {
	pushAction(actions, {
		area: 'project-assembly',
		action: 'Make project_assembly.json map every project_contract.json module to a deterministic cell, anchor, refs, and nets before generation. This is the bridge from user intent to executable schematic layout.',
		evidence: ['project_spec.json', 'project_contract.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly_report.json'],
		observed: checks.projectAssembly.firstFinding || checks.projectAssembly,
	});
}
if (checks.projectLayout.status !== 'pass') {
	pushAction(actions, {
		area: 'project-layout',
		action: 'Make project_assembly.json layoutPolicy drive layout_planner.mjs and satisfy module spacing, no interlock, and no unrelated wire intrusion requirements.',
		evidence: ['project_assembly.json', 'engine/layout_planner.mjs', 'layout_planner_report.json', 'layout_planner_structure.json', 'project_layout_report.json'],
		observed: checks.projectLayout.firstFinding || checks.projectLayout,
	});
}
if (checks.template.status !== 'pass') {
	pushAction(actions, {
		area: 'template',
		action: 'Fix deterministic schematic model until report.json has HARD=0 SOFT=0 INFO=0.',
		evidence: ['report.json'],
	});
}
if (checks.projectModel.status !== 'pass') {
	pushAction(actions, {
		area: 'project-model',
		action: 'Make full_model.json satisfy project_contract.json. Fix deterministic cells, assembly, or the contract so required modules, parts, nets, and interfaces match the generated model.',
		evidence: ['project_contract.json', 'full_model.json', 'project_model_report.json'],
		observed: checks.projectModel.firstFinding || checks.projectModel,
	});
}
if (checks.projectNetlist.status !== 'pass') {
	pushAction(actions, {
		area: 'project-netlist',
		action: 'Make project_netlist.json describe structured electrical intent and make full_model.json satisfy every required pin/net endpoint.',
		evidence: ['project_netlist.json', 'project_contract.json', 'full_model.json', 'project_netlist_report.json'],
		observed: checks.projectNetlist.firstFinding || checks.projectNetlist,
	});
}
if (acceptance?.mode === 'full-with-live' && checks.projectLiveModel.status !== 'pass') {
	pushAction(actions, {
		area: 'project-live-model',
		action: 'Make live.json from the real EasyEDA canvas satisfy project_contract.json. Local-only model PASS is not final acceptance.',
		evidence: ['live.json', 'project_contract.json', 'project_live_model_report.json', 'apply_report.json'],
		observed: checks.projectLiveModel.firstFinding || checks.projectLiveModel,
	});
}
if (checks.preview.status !== 'pass' || checks.preview.screenshots < 10) {
	pushAction(actions, {
		area: 'offline-preview',
		action: 'Fix offline preview renderer/model until visual_review_report.json passes with at least 10 screenshots.',
		evidence: ['visual_review_report.json', 'visual_crops/'],
	});
}
if (checks.projectVisual.status !== 'pass') {
	pushAction(actions, {
		area: 'project-visual',
		action: 'Make visual_review_report.json cover every visualEvidenceRegions entry from project_contract.json. Add preview regions or fix failing crop inspection before delivery.',
		evidence: ['project_contract.json', 'visual_review_report.json', 'project_visual_report.json'],
		observed: checks.projectVisual.firstFinding || checks.projectVisual,
	});
}
if (acceptance?.mode === 'full-with-live' && checks.drc.status !== 'pass') {
	pushAction(actions, {
		area: 'drc',
		action: 'Fix EasyEDA DRC until drc_report.json proves 0 errors, 0 warnings, and 0 info.',
		evidence: ['drc_report.json'],
		observed: checks.drc.counts || checks.drc,
	});
}
if (checks.liveShots.status === 'fail') {
	const first = checks.liveShots.firstFinding;
	if (first?.rule === 'LS6-live-crop-diagnostic-only') {
		pushAction(actions, {
			area: 'live-capture',
			action: 'Resolve EasyEDA live region capture: zoom requests currently produce identical canvas images, so module-level live screenshots cannot be accepted.',
			evidence: ['live_shots_report.json', 'live_diagnose_report.json'],
			observed: checks.liveShots.zoomEvidence,
			nextProbe: 'Use npm run live:diagnose after changing EasyEDA client/bridge capture behavior; acceptance requires uniqueRequestedCaptures >= 10 for requestedRegions >= 10.',
		});
	} else {
		pushAction(actions, {
			area: 'live-capture',
			action: 'Fix live module screenshots until live_shots_report.json passes with at least 10 distinct module-level images.',
			evidence: ['live_shots_report.json'],
			observed: first || checks.liveShots,
		});
	}
}
if (checks.acceptance.status === 'fail' && !actions.length) {
	pushAction(actions, {
		area: 'acceptance',
		action: 'Inspect acceptance_report.json for failed required steps.',
		evidence: ['acceptance_report.json'],
	});
}
if (checks.finalEvidence.status !== 'pass') {
	pushAction(actions, {
		area: 'final-evidence',
		action: 'Regenerate and inspect evidence for the active project spec context. Final evidence must not reuse stale reports from another spec or project.',
		evidence: ['final_evidence_report.json', 'acceptance_report.json', 'gsd_plan_report.json', 'gsd_generate_report.json'],
		observed: checks.finalEvidence.firstFinding || checks.finalEvidence,
		nextCommand: checks.acceptance.context?.spec
			? `node bin/easyeda-gsd.mjs accept ${checks.acceptance.context.spec}`
			: 'node bin/easyeda-gsd.mjs accept',
	});
}
if (checks.repairActions.status === 'fail') {
	for (const action of (repair.actions || []).slice(0, 5)) {
		pushAction(actions, {
			area: `repair:${action.area}`,
			action: action.repairHint,
			evidence: action.inspectFiles,
			observed: {
				gate: action.gate,
				rule: action.rule,
				message: action.message,
				where: action.where,
			},
			editFiles: action.editFiles,
			nextCommand: action.nextCommand,
		});
	}
}

const result = {
	generatedAt: new Date().toISOString(),
	pass: actions.length === 0,
	checks,
	actions,
};

const normalized = normalizeNextActions(result);
writeFileSync(OUT, JSON.stringify(normalized, null, 2), 'utf8');
console.log(`next actions ${normalized.pass ? 'PASS' : 'OPEN'} count=${normalized.actions.length}`);
console.log(`report -> ${OUT}`);
process.exit(normalized.pass ? 0 : 1);
