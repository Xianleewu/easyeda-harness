import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeNextActions } from '../workflows/action_schema.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_NEXT_ACTIONS || DIR + 'next_actions.json';
const INCLUDE_DELIVERY_REPORT = process.env.EASYEDA_INCLUDE_DELIVERY_REPORT === '1';

function readJson(name) {
	const normalized = String(name || '').replace(/\\/g, '/');
	const path = /^[A-Za-z]:[\\/]/.test(name) || normalized.startsWith('/') ? normalized : DIR + name;
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
		...resolvePackPlaceholder(item),
	});
}

function ruleMatches(finding, pattern) {
	return pattern.test(finding?.rule || '');
}

function hasActionArea(actions, area) {
	return actions.some(action => action.area === area);
}

function normalizePath(path) {
	return String(path || '').replace(/\\/g, '/');
}

function currentAssemblyPath() {
	return acceptance?.context?.assemblyPath || process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
}

function currentCircuitPack() {
	const assemblyPath = normalizePath(currentAssemblyPath());
	const assembly = assemblyPath ? readJson(assemblyPath) : null;
	return assembly?.circuitPack || gsdPlan?.circuitPack || projectPack?.circuitPack || cellManifest?.packId || 'aihwdebugger';
}

function resolvePackPlaceholder(value) {
	const pack = currentCircuitPack();
	if (typeof value === 'string') return value.replaceAll('<pack>', pack);
	if (Array.isArray(value)) return value.map(resolvePackPlaceholder);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePackPlaceholder(v)]));
	return value;
}

const acceptance = readJson('acceptance_report.json');
const agentInstructions = readJson('agent_instruction_report.json');
const workflowSmoke = readJson('workflow_smoke_report.json');
const gsdPlan = readJson('plexus_plan_report.json');
const gsdGenerate = readJson('plexus_generate_report.json');
const specSchema = readJson('spec_schema_report.json');
const spec = readJson('project_spec_report.json');
const contract = readJson('project_contract_report.json');
const projectRules = readJson('project_rule_report.json');
const projectPack = readJson('project_pack_report.json');
const projectLibrary = readJson('project_library_report.json');
const cellManifest = readJson('cell_manifest_report.json');
const projectAssembly = readJson('project_assembly_report.json');
const projectLayout = readJson('project_layout_report.json');
const projectGeometry = readJson('project_geometry_report.json');
const projectLabelLayout = readJson('project_label_layout_report.json');
const projectModel = readJson('project_model_report.json');
const projectNetlist = readJson('project_netlist_report.json');
const projectLiveModel = readJson('project_live_model_report.json');
const projectVisual = readJson('project_visual_report.json');
const template = readJson('report.json');
const preview = readJson('visual_review_report.json');
const drc = readJson('drc_report.json');
const applyGated = readJson('apply_report.json');
const liveShots = readJson('live_shots_report.json');
const liveDiagnose = readJson('live_diagnose_report.json');
const repair = readJson('repair_actions.json');
const finalEvidence = readJson('final_evidence_report.json');
const delivery = INCLUDE_DELIVERY_REPORT ? readJson('delivery_report.json') : null;

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
		evidence: 'plexus_plan_report.json',
	},
	gsdGenerate: {
		status: status(gsdGenerate?.pass),
		severity: gsdGenerate?.severity || null,
		projectId: gsdGenerate?.projectId || null,
		circuitPack: gsdGenerate?.circuitPack || null,
		firstFinding: gsdGenerate?.findings?.[0] || null,
		evidence: 'plexus_generate_report.json',
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
	projectGeometry: {
		status: status(projectGeometry?.pass),
		severity: projectGeometry?.severity || null,
		source: projectGeometry?.source || null,
		stats: projectGeometry?.stats || null,
		firstFinding: projectGeometry?.findings?.[0] || null,
		evidence: 'project_geometry_report.json',
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
	projectLabelLayout: {
		status: status(projectLabelLayout?.pass),
		severity: projectLabelLayout?.severity || null,
		projectId: projectLabelLayout?.projectId || null,
		source: projectLabelLayout?.source || null,
		stats: projectLabelLayout?.stats || null,
		firstFinding: projectLabelLayout?.findings?.[0] || null,
		evidence: 'project_label_layout_report.json',
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
	applyGated: {
		status: status(applyGated?.pass),
		mode: applyGated?.mode || null,
		writeBack: applyGated?.writeBack ?? null,
		applyWriter: applyGated?.applyWriter ? {
			pass: applyGated.applyWriter.pass ?? null,
			mode: applyGated.applyWriter.mode || null,
			writer: applyGated.applyWriter.writer || null,
			firstFinding: applyGated.applyWriter.findings?.[0] || null,
		} : null,
		severity: applyGated?.severity || null,
		firstFinding: applyGated?.findings?.[0] || applyGated?.applyWriter?.findings?.[0] || null,
		evidence: 'apply_report.json',
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
	delivery: {
		status: status(delivery?.pass),
		mode: delivery?.mode || null,
		context: delivery?.context || null,
		severity: delivery?.severity || null,
		firstFinding: delivery?.findings?.[0] || null,
		evidence: 'delivery_report.json',
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
		evidence: ['workflow_smoke_report.json', 'engine/workflow_smoke_gate.mjs', 'workflows/plexus_plan.mjs', 'workflows/plexus_generate.mjs', 'workflows/plexus_scaffold.mjs', 'contracts/library_contract.mjs'],
		observed: checks.workflowSmoke.firstFinding || checks.workflowSmoke,
	});
}
if (checks.gsdPlan.status !== 'pass') {
	const finding = checks.gsdPlan.firstFinding;
	if (ruleMatches(finding, /^(GP-)?DR/)) {
		pushAction(actions, {
			area: 'drawing-rule-bindings',
			action: 'Bind every project drawingRules and manifest qualityRules entry to executable harness rules before generation; prose-only drawing rules must fail closed.',
			evidence: ['plexus_plan_report.json', 'contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json'],
			observed: finding,
			editFiles: ['contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^GP6-contract-parts$|^PC12/)) {
		pushAction(actions, {
			area: 'module-contract-bootstrap',
			action: 'Fill the module contract from the user intent before drawing. Each module needs concrete requiredParts, requiredNets, drawingRules, visualEvidence, and matching structured netlist endpoints.',
			evidence: ['plexus_plan_report.json', 'project_spec.json', 'project_contract.json', 'project_netlist.json'],
			observed: finding,
			editFiles: ['project_spec.json', 'project_contract.json', 'project_netlist.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^GP8|^GP1[5-7]/)) {
		pushAction(actions, {
			area: 'cell-builder-bootstrap',
			action: 'Map the contract module to an executable deterministic cell. project_assembly.json must declare cell, refs, anchor, netArgs/nets, and the active pack must declare and implement that cell.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			observed: finding,
			editFiles: ['project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^CM1[6-9]|^CM20|^CB1[4-8]/)) {
		pushAction(actions, {
			area: 'cell-port-layout',
			action: 'Make port label placement executable. cell_manifest.json portLayout must define each port side/kind/label and the builder must emit real netflags with alignMode=6 on left ports or alignMode=8 on right ports.',
			evidence: ['plexus_plan_report.json', 'cell_manifest_report.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			observed: finding,
			editFiles: ['circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^PC29|^PC30|^GP-PC29|^GP-PC30/)) {
		pushAction(actions, {
			area: 'quality-rule-profile',
			action: 'Declare qualityPolicy.ruleProfile from the executable harness budgets before generation: module gap, wire intrusions, component/text clearance, named-stub length, wire-name origins, fake-text-net ban, and NET PORT policy.',
			evidence: ['plexus_plan_report.json', 'project_contract.json', 'harness/config.mjs'],
			observed: finding,
			editFiles: ['project_contract.json', 'contracts/module_contract.mjs', 'harness/config.mjs'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^GP4[4-6]|^GP6[3-5]/)) {
		pushAction(actions, {
			area: 'interface-label-columns',
			action: 'Declare module-side layoutPolicy.labelColumns for each visible signal label and grouped-net-label interface. Every column needs module, routeEnd, side, x, tolerance, and allowed nets; duplicate module-side net budgets are forbidden.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: finding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^GP4[7-9]|^GP5[0-7]/)) {
		pushAction(actions, {
			area: 'module-region-contract',
			action: 'Declare layoutPolicy.moduleRegions before generation. Every assembly module needs one anchor-relative readable rectangle with module, anchor, column, dx/dy, width, height, and enough gap from other module regions.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: finding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^GP2[7-9]|^GP3[0-4]|^GP4[3-6]/)) {
		pushAction(actions, {
			area: 'interface-routing-contract',
			action: 'Declare layoutPolicy.interfaceRoutes before generation. Every project_contract interface needs net/from/to, strategy visible-continuity or grouped-net-label, a readable channel, and direction.',
			evidence: ['plexus_plan_report.json', 'project_contract.json', 'project_assembly.json'],
			observed: finding,
			editFiles: ['project_assembly.json', 'project_contract.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else if (ruleMatches(finding, /^CB/)) {
		pushAction(actions, {
			area: 'cell-builder-output',
			action: 'Fix deterministic cell builder output before generation: builders must return real place/wires/flags arrays, orthogonal wires, declared output nets, and no fake text labels.',
			evidence: ['plexus_plan_report.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'project_assembly.json'],
			observed: finding,
			editFiles: ['circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'project_assembly.json', 'project_contract.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	} else {
		pushAction(actions, {
			area: 'plexus-plan',
			action: 'Fix spec-to-contract realization before generation. plexus_plan_report.json must prove project_spec.json is covered by project_contract.json, project_netlist.json, project_assembly.json, and a registered circuit pack.',
			evidence: ['project_spec.json', 'project_contract.json', 'project_netlist.json', 'project_assembly.json', 'plexus_plan_report.json'],
			observed: finding || checks.gsdPlan,
		});
	}
	const planFindings = Array.isArray(gsdPlan?.findings) ? gsdPlan.findings : [];
	const cellBootstrapFinding = planFindings.find(f => ruleMatches(f, /^GP8|^GP1[5-7]/));
	if (cellBootstrapFinding && !hasActionArea(actions, 'cell-builder-bootstrap')) {
		pushAction(actions, {
			area: 'cell-builder-bootstrap',
			action: 'Map the contract module to an executable deterministic cell. project_assembly.json must declare cell, refs, anchor, netArgs/nets, and the active pack must declare and implement that cell.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			observed: cellBootstrapFinding,
			editFiles: ['project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
	const portLayoutFinding = planFindings.find(f => ruleMatches(f, /^CM1[6-9]|^CM20|^CB1[4-8]/));
	if (portLayoutFinding && !hasActionArea(actions, 'cell-port-layout')) {
		pushAction(actions, {
			area: 'cell-port-layout',
			action: 'Make port label placement executable. cell_manifest.json portLayout must define each port side/kind/label and the builder must emit real netflags with alignMode=6 on left ports or alignMode=8 on right ports.',
			evidence: ['plexus_plan_report.json', 'cell_manifest_report.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
			observed: portLayoutFinding,
			editFiles: ['circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
	const labelColumnFinding = planFindings.find(f => ruleMatches(f, /^GP4[4-6]|^GP6[3-5]/));
	if (labelColumnFinding && !hasActionArea(actions, 'interface-label-columns')) {
		pushAction(actions, {
			area: 'interface-label-columns',
			action: 'Declare module-side layoutPolicy.labelColumns for each visible signal label and grouped-net-label interface. Every column needs module, routeEnd, side, x, tolerance, and allowed nets; duplicate module-side net budgets are forbidden.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: labelColumnFinding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
	const routeFinding = planFindings.find(f => ruleMatches(f, /^GP2[7-9]|^GP3[0-4]/));
	if (routeFinding && !hasActionArea(actions, 'interface-routing-contract')) {
		pushAction(actions, {
			area: 'interface-routing-contract',
			action: 'Declare layoutPolicy.interfaceRoutes before generation. Every project_contract interface needs net/from/to, strategy visible-continuity or grouped-net-label, a readable channel, and direction.',
			evidence: ['plexus_plan_report.json', 'project_contract.json', 'project_assembly.json'],
			observed: routeFinding,
			editFiles: ['project_assembly.json', 'project_contract.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
	const moduleRegionFinding = planFindings.find(f => ruleMatches(f, /^GP4[7-9]|^GP5[0-7]/));
	if (moduleRegionFinding && !hasActionArea(actions, 'module-region-contract')) {
		pushAction(actions, {
			area: 'module-region-contract',
			action: 'Declare layoutPolicy.moduleRegions before generation. Every assembly module needs one anchor-relative readable rectangle with module, anchor, column, dx/dy, width, height, and enough gap from other module regions.',
			evidence: ['plexus_plan_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: moduleRegionFinding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
	const ruleProfileFinding = planFindings.find(f => ruleMatches(f, /^PC29|^PC30|^GP-PC29|^GP-PC30/));
	if (ruleProfileFinding && !hasActionArea(actions, 'quality-rule-profile')) {
		pushAction(actions, {
			area: 'quality-rule-profile',
			action: 'Declare qualityPolicy.ruleProfile from the executable harness budgets before generation: module gap, wire intrusions, component/text clearance, named-stub length, wire-name origins, fake-text-net ban, and NET PORT policy.',
			evidence: ['plexus_plan_report.json', 'project_contract.json', 'harness/config.mjs'],
			observed: ruleProfileFinding,
			editFiles: ['project_contract.json', 'contracts/module_contract.mjs', 'harness/config.mjs'],
			nextCommand: 'node bin/easyeda-plexus.mjs plan project_spec.json',
		});
	}
}
if (checks.gsdGenerate.status !== 'pass') {
	pushAction(actions, {
		area: 'plexus-generate',
		action: 'Run generation only through the plan-gated workflow. plexus_generate_report.json must prove a passing Plexus plan produced full_model.json and report.json from the deterministic generator.',
		evidence: ['plexus_generate_report.json', 'plexus_plan_report.json', 'full_model.json', 'report.json'],
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
	const finding = checks.contract.firstFinding;
	if (ruleMatches(finding, /^PC29|^PC30/)) {
		pushAction(actions, {
			area: 'quality-rule-profile',
			action: 'Declare qualityPolicy.ruleProfile from the executable harness budgets before drawing: module gap, wire intrusions, component/text clearance, named-stub length, wire-name origins, fake-text-net ban, and NET PORT policy.',
			evidence: ['project_contract.json', 'project_contract_report.json', 'harness/config.mjs'],
			observed: finding,
			editFiles: ['project_contract.json', 'contracts/module_contract.mjs', 'harness/config.mjs'],
			nextCommand: 'npm.cmd run contract',
		});
	} else {
		pushAction(actions, {
			area: 'project-contract',
			action: 'Create or fix project_contract.json before editing schematic cells or writing back. The contract must define modules, required parts/nets, interfaces, visual evidence regions, and no-free-draw policy.',
			evidence: ['project_contract.json', 'project_contract_report.json'],
			observed: finding || checks.contract,
		});
	}
}
if (checks.projectRules.status !== 'pass') {
	const finding = checks.projectRules.firstFinding;
	if (ruleMatches(finding, /^PR-DR/)) {
		pushAction(actions, {
			area: 'drawing-rule-bindings',
			action: 'Make every drawingRules and qualityRules string executable by binding it to registered harness rules; unknown rule prose is not accepted.',
			evidence: ['project_rule_report.json', 'contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json'],
			observed: finding,
			editFiles: ['contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json'],
			nextCommand: 'npm.cmd run contract:rules',
		});
	} else {
		pushAction(actions, {
			area: 'project-rules',
			action: 'Make harness rule registries cover project_contract.json. Update module registry, required parts, interface contracts, or rule registration before trusting template PASS.',
			evidence: ['project_contract.json', 'harness/module_registry.mjs', 'engine/interface_contract.mjs', 'harness/rule_registry.mjs', 'project_rule_report.json'],
			observed: finding || checks.projectRules,
		});
	}
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
	const finding = checks.projectLayout.firstFinding;
	if (ruleMatches(finding, /^PL3[0-3]|^PL5[2-4]/)) {
		pushAction(actions, {
			area: 'interface-label-columns',
			action: 'Fix layoutPolicy.labelColumns so visible signal labels and grouped-net-label interfaces have concrete module-side columns with module, routeEnd, side, x, tolerance, and nets. Duplicate module-side net budgets are not allowed.',
			evidence: ['project_layout_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: finding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		});
	} else if (ruleMatches(finding, /^PL3[4-9]|^PL4[0-6]/)) {
		pushAction(actions, {
			area: 'module-region-contract',
			action: 'Fix layoutPolicy.moduleRegions so every module has one non-overlapping planned rectangle and the generated structure bbox stays inside it. Use the reported module, plannedBox, actualBox, and tolerance instead of moving labels or wires by guesswork.',
			evidence: ['project_layout_report.json', 'project_assembly.json', 'docs/schematic-design-rules.md'],
			observed: finding,
			editFiles: ['project_assembly.json'],
			nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		});
	} else if (ruleMatches(finding, /^PL2[2-9]/)) {
		pushAction(actions, {
			area: 'interface-routing-contract',
			action: 'Fix layoutPolicy.interfaceRoutes so every contract interface has net/from/to, strategy, readable channel, and direction before layout acceptance.',
			evidence: ['project_layout_report.json', 'project_contract.json', 'project_assembly.json'],
			observed: finding,
			editFiles: ['project_assembly.json', 'project_contract.json'],
			nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		});
	} else {
		pushAction(actions, {
			area: 'project-layout',
			action: 'Make project_assembly.json layoutPolicy drive layout_planner.mjs and satisfy module spacing, no interlock, and no unrelated wire intrusion requirements.',
			evidence: ['project_assembly.json', 'engine/layout_planner.mjs', 'layout_planner_report.json', 'layout_planner_structure.json', 'project_layout_report.json'],
			observed: finding || checks.projectLayout,
		});
	}
}
if (checks.template.status !== 'pass') {
	pushAction(actions, {
		area: 'template',
		action: 'Fix deterministic schematic model until report.json has HARD=0 SOFT=0 INFO=0.',
		evidence: ['report.json'],
	});
}
if (checks.projectGeometry.status !== 'pass') {
	pushAction(actions, {
		area: 'project-geometry',
		action: 'Fix actual schematic geometry before accepting visual quality. Remove diagonal wires, different-net or unnamed wire crossings, wires through visible objects, and text/label/flag/attribute overlaps in deterministic cells or writer output.',
		evidence: ['project_geometry_report.json', 'full_model.json', 'live.json', 'docs/schematic-design-rules.md'],
		observed: checks.projectGeometry.firstFinding || checks.projectGeometry,
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'engine/apply_full.mjs'],
		nextCommand: 'npm.cmd run contract:geometry',
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
if (checks.projectLabelLayout.status !== 'pass') {
	const finding = checks.projectLabelLayout.firstFinding || checks.projectLabelLayout;
	if (ruleMatches(finding, /^LL22/)) {
		pushAction(actions, {
			area: 'label-budget-realization',
			action: 'Make layoutPolicy.labelColumns honest: every declared column/net budget must have an actual visible label attached to a same-net endpoint at the declared side and x. Generate the missing label in the deterministic cell, or remove/move the stale budget from project_assembly.json.',
			evidence: ['project_label_layout_report.json', 'project_assembly.json', 'full_model.json', 'live.json', 'docs/schematic-design-rules.md'],
			observed: finding,
			editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json'],
			nextCommand: 'npm.cmd run contract:labels',
		});
	} else {
		pushAction(actions, {
			area: 'project-label-layout',
			action: 'Make visible signal labels an executable layout contract. Declare layoutPolicy.labelColumns, keep each net label origin on a same-net wire endpoint, use left-bottom/right-bottom align modes, and remove fake text or unbudgeted scattered labels.',
			evidence: ['project_label_layout_report.json', 'project_assembly.json', 'full_model.json', 'live.json'],
			observed: finding,
			editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'engine/apply_full.mjs'],
			nextCommand: 'npm.cmd run contract:labels',
		});
	}
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
if (checks.applyGated.status === 'fail') {
	const finding = checks.applyGated.firstFinding;
	if (ruleMatches(finding, /^AW/)) {
		pushAction(actions, {
			area: 'apply-writer',
			action: 'Declare and implement an explicit pack writer before external write-back. apply:gated must fail closed instead of reusing the bundled AIHWDEBUGER writer for another pack.',
			evidence: ['apply_report.json', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs'],
			observed: finding,
			editFiles: ['circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/apply_writer.mjs', 'circuit_packs/<pack>/apply_run.mjs', 'engine/apply_gated.mjs'],
			nextCommand: checks.acceptance.context?.spec
				? `node bin/easyeda-plexus.mjs apply --gated --context-only ${checks.acceptance.context.spec}`
				: 'npm.cmd run apply:gated',
		});
	} else {
		pushAction(actions, {
			area: 'apply-gated',
			action: 'Fix apply:gated preflight before write-back. The apply report must prove context, writer, local gates, and target checks pass before EasyEDA is modified.',
			evidence: ['apply_report.json', 'project_assembly.json', 'target_context_apply_gate.json'],
			observed: finding || checks.applyGated,
		});
	}
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
if (INCLUDE_DELIVERY_REPORT && checks.delivery.status === 'fail') {
	pushAction(actions, {
		area: 'delivery-live-evidence',
		action: 'Run live-check for the active project spec and make the real EasyEDA snapshot, DRC, live shots, and live final evidence pass before handoff. Local-only acceptance is not delivery evidence.',
		evidence: ['delivery_report.json', 'acceptance_report.json', 'final_evidence_report.json', 'project_live_model_report.json', 'drc_report.json', 'live_shots_report.json', 'live.json', 'live_canvas.png'],
		observed: checks.delivery.firstFinding || checks.delivery,
		editFiles: ['engine/delivery_gate.mjs', 'engine/final_evidence_gate.mjs', 'engine/acceptance_run.mjs', 'project_spec.json', 'project_contract.json', 'project_assembly.json'],
		nextCommand: checks.acceptance.context?.spec
			? `node bin/easyeda-plexus.mjs live-check ${checks.acceptance.context.spec} && node bin/easyeda-plexus.mjs deliver ${checks.acceptance.context.spec}`
			: 'node bin/easyeda-plexus.mjs live-check && node bin/easyeda-plexus.mjs deliver',
	});
}
if (checks.repairActions.status === 'fail') {
	const sourceRepairActions = (repair.actions || [])
		.filter(action => !['final-evidence', 'acceptance'].includes(action.area));
	for (const action of sourceRepairActions.slice(0, 5)) {
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
	context: {
		spec: acceptance?.context?.spec || process.env.EASYEDA_PROJECT_SPEC || 'project_spec.json',
		assemblyPath: normalizePath(currentAssemblyPath()),
		circuitPack: currentCircuitPack(),
	},
	checks,
	actions,
};

const normalized = normalizeNextActions(result);
writeFileSync(OUT, JSON.stringify(normalized, null, 2), 'utf8');
console.log(`next actions ${normalized.pass ? 'PASS' : 'OPEN'} count=${normalized.actions.length}`);
console.log(`report -> ${OUT}`);
process.exit(normalized.pass ? 0 : 1);
