import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_REPAIR_ACTIONS || DIR + 'repair_actions.json';

const REPORTS = [
	{ gate: 'entrypoints', file: 'entrypoint_audit_report.json', rerun: 'npm.cmd run entrypoints' },
	{ gate: 'agent-instructions', file: 'agent_instruction_report.json', rerun: 'npm.cmd run agent:instructions' },
	{ gate: 'workflow-smoke', file: 'workflow_smoke_report.json', rerun: 'npm.cmd run workflow:smoke' },
	{ gate: 'action-schema', file: 'action_schema_report.json', rerun: 'npm.cmd run action:schema' },
	{ gate: 'gsd-plan', file: 'gsd_plan_report.json', rerun: 'node bin/easyeda-gsd.mjs plan project_spec.json' },
	{ gate: 'gsd-generate', file: 'gsd_generate_report.json', rerun: 'node bin/easyeda-gsd.mjs generate project_spec.json' },
	{ gate: 'spec-schema', file: 'spec_schema_report.json', rerun: 'npm.cmd run spec:schema' },
	{ gate: 'project-spec', file: 'project_spec_report.json', rerun: 'npm.cmd run spec' },
	{ gate: 'project-contract', file: 'project_contract_report.json', rerun: 'npm.cmd run contract' },
	{ gate: 'project-rules', file: 'project_rule_report.json', rerun: 'npm.cmd run contract:rules' },
	{ gate: 'project-pack', file: 'project_pack_report.json', rerun: 'npm.cmd run contract:pack' },
	{ gate: 'project-library', file: 'project_library_report.json', rerun: 'npm.cmd run contract:library' },
	{ gate: 'cell-manifest', file: 'cell_manifest_report.json', rerun: 'npm.cmd run contract:cells' },
	{ gate: 'project-assembly', file: 'project_assembly_report.json', rerun: 'npm.cmd run contract:assembly' },
	{ gate: 'template', file: 'report.json', rerun: 'npm.cmd run fast' },
	{ gate: 'pipeline', file: 'layout_planner_report.json', rerun: 'npm.cmd run pipeline' },
	{ gate: 'project-layout', file: 'project_layout_report.json', rerun: 'npm.cmd run pipeline && npm.cmd run contract:layout' },
	{ gate: 'project-model', file: 'project_model_report.json', rerun: 'npm.cmd run contract:model' },
	{ gate: 'project-netlist', file: 'project_netlist_report.json', rerun: 'npm.cmd run contract:netlist' },
	{ gate: 'project-live-model', file: 'project_live_model_report.json', rerun: 'npm.cmd run accept:live' },
	{ gate: 'preview', file: 'visual_review_report.json', rerun: 'npm.cmd run preview' },
	{ gate: 'project-visual', file: 'project_visual_report.json', rerun: 'npm.cmd run contract:visual' },
	{ gate: 'drc', file: 'drc_report.json', rerun: 'npm.cmd run drc' },
	{ gate: 'apply-gated', file: 'apply_report.json', rerun: 'npm.cmd run apply:gated' },
	{ gate: 'live-shots', file: 'live_shots_report.json', rerun: 'npm.cmd run live:shots' },
	{ gate: 'final-evidence', file: 'final_evidence_report.json', rerun: 'npm.cmd run final:evidence' },
	{ gate: 'acceptance', file: 'acceptance_report.json', rerun: 'npm.cmd run accept' },
];

function readJson(name) {
	const normalized = normalizePath(name);
	const path = /^[A-Za-z]:[\\/]/.test(name) || normalized.startsWith('/') ? normalized : DIR + name;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message, path };
	}
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function uniq(items) {
	return [...new Set(items.filter(Boolean))];
}

function normalizePath(path) {
	return String(path || '').replace(/\\/g, '/');
}

function currentSpecArg() {
	const acceptance = readJson('acceptance_report.json');
	const spec = acceptance?.context?.spec || process.env.EASYEDA_PROJECT_SPEC || 'project_spec.json';
	const root = DIR.replace(/\/$/, '');
	const normalized = normalizePath(spec);
	if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
	return normalized;
}

function currentAssemblyPath() {
	const acceptance = readJson('acceptance_report.json');
	return acceptance?.context?.assemblyPath || process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
}

function currentCircuitPack() {
	const assemblyPath = normalizePath(currentAssemblyPath());
	const assembly = assemblyPath ? readJson(assemblyPath) : null;
	return assembly?.circuitPack || 'aihwdebugger';
}

const CURRENT_CIRCUIT_PACK = currentCircuitPack();

function resolvePackPlaceholder(value) {
	if (typeof value === 'string') return value.replaceAll('<pack>', CURRENT_CIRCUIT_PACK);
	if (Array.isArray(value)) return value.map(resolvePackPlaceholder);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePackPlaceholder(v)]));
	return value;
}

function isExternalSpec(spec) {
	return normalizePath(spec || 'project_spec.json') !== 'project_spec.json';
}

function contextAwareCommand(command) {
	const spec = currentSpecArg();
	if (!isExternalSpec(spec)) return command;
	if (/easyeda-gsd\.mjs plan|gsd:plan/.test(command || '')) {
		return `node bin/easyeda-gsd.mjs plan ${spec}`;
	}
	if (/easyeda-gsd\.mjs generate|gsd:generate/.test(command || '')) {
		return `node bin/easyeda-gsd.mjs generate ${spec}`;
	}
	if (/apply:gated|apply --gated/.test(command || '')) {
		return `node bin/easyeda-gsd.mjs apply --gated --context-only ${spec}`;
	}
	if (/(accept:live|live:|drc|final:evidence:live)/.test(command || '')) {
		return `node bin/easyeda-gsd.mjs live-check ${spec}`;
	}
	return `node bin/easyeda-gsd.mjs accept ${spec}`;
}

function firstMatch(rule, patterns) {
	return patterns.find(([pattern]) => pattern.test(rule || ''))?.[1] || null;
}

const RULE_PLANS = [
	[/^AI/, {
		area: 'agent-instructions',
		editFiles: ['AGENTS.md', 'CLAUDE.md', 'README.md', 'README.en.md', 'package.json'],
		inspectFiles: ['agent_instruction_report.json', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'README.en.md'],
		nextCommand: 'npm.cmd run agent:instructions',
		repairHint: 'Keep Codex/Claude-facing instructions complete: require official easyeda-api-skill, project spec/contract/netlist/assembly updates, no free-draw, fail-closed apply:gated, live evidence, and repair/next actions.',
	}],
	[/^AS/, {
		area: 'action-schema',
		editFiles: ['engine/next_actions.mjs', 'workflows/action_schema.mjs', 'engine/action_schema_gate.mjs'],
		inspectFiles: ['next_actions.json', 'action_schema_report.json'],
		nextCommand: 'npm.cmd run next:actions && npm.cmd run action:schema',
		repairHint: 'Keep next_actions.json on the stable schema: schemaVersion, mode, normalized checks, action ids, severity/source/title/target, and evidence arrays.',
	}],
	[/^WS/, {
		area: 'workflow-smoke',
		editFiles: ['engine/workflow_smoke_gate.mjs', 'workflows/gsd_plan.mjs', 'workflows/gsd_generate.mjs', 'workflows/gsd_scaffold.mjs', 'contracts/library_contract.mjs'],
		inspectFiles: ['workflow_smoke_report.json', 'project_spec.json', 'project_contract.json', 'project_netlist.json', 'project_assembly.json', 'approved_library_manifest.json'],
		nextCommand: 'npm.cmd run workflow:smoke',
		repairHint: 'Keep reusable workflow regression checks fail-closed: bad specs must be rejected, scaffold must not be generation-ready, library bindings must be required, and negative generate must not rewrite full_model.json.',
	}],
	[/^SS/, {
		area: 'spec-schema',
		editFiles: ['project_spec.json', 'contracts/spec_schema.mjs'],
		inspectFiles: ['project_spec.json', 'spec_schema_report.json'],
		nextCommand: 'npm.cmd run spec:schema',
		repairHint: 'Fix the user-intent spec shape before deriving project_contract.json, project_netlist.json, or project_assembly.json.',
	}],
	[/^EA\d|entrypoint/i, {
		area: 'entrypoints',
		editFiles: ['package.json', 'engine/entrypoint_audit.mjs'],
		inspectFiles: ['package.json', 'engine/', 'apply_run.ps1', 'run.ps1', 'run-save.ps1'],
		nextCommand: 'npm.cmd run entrypoints',
		repairHint: 'Keep package scripts and source-level entrypoints pointing to existing files; remove or replace stale command references.',
	}],
	[/^PS/, {
		area: 'project-spec',
		editFiles: ['project_spec.json', 'project_contract.json'],
		inspectFiles: ['project_spec_report.json'],
		nextCommand: 'npm.cmd run spec',
		repairHint: 'Update user-intent modules, nets, interfaces, or contract coverage before touching schematic geometry.',
	}],
	[/^PC29|^PC30|^GP-PC29|^GP-PC30/, {
		area: 'quality-rule-profile',
		editFiles: ['project_contract.json', 'contracts/module_contract.mjs', 'harness/config.mjs'],
		inspectFiles: ['project_contract_report.json', 'gsd_plan_report.json', 'project_contract.json', 'harness/config.mjs'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Declare qualityPolicy.ruleProfile from the executable harness budgets: module gap, wire-intrusion budget, component/text clearance, named-stub length, wire-name origins, no fake text nets, and no unnecessary NET PORTs.',
	}],
	[/^PC12|^GP6/, {
		area: 'module-contract-bootstrap',
		editFiles: ['project_spec.json', 'project_contract.json', 'project_netlist.json'],
		inspectFiles: ['project_spec.json', 'project_contract.json', 'project_contract_report.json', 'gsd_plan_report.json'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Bootstrap the module contract from the user intent: every module needs concrete requiredParts, requiredNets, drawingRules, visualEvidence, and matching structured netlist endpoints before any cell geometry is edited.',
	}],
	[/^PC/, {
		area: 'project-contract',
		editFiles: ['project_contract.json', 'contracts/module_contract.mjs'],
		inspectFiles: ['project_spec.json', 'project_contract_report.json', 'contracts/module_contract.mjs'],
		nextCommand: 'npm.cmd run contract',
		repairHint: 'Fix the machine contract: modules, required parts/nets, interfaces, visual evidence, and no-free-draw policy.',
	}],
	[/^PR1|^PR2|^PR3|^PR4/, {
		area: 'project-rules',
		editFiles: ['project_contract.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Make project_assembly.json refs/nets and the selected cell manifest cover every project_contract.json module instead of relying on global reference-design registries.',
	}],
	[/^PR5/, {
		area: 'project-rules',
		editFiles: ['project_contract.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Make each deterministic cell qualityRules cover the owning module drawingRules before generation is trusted.',
	}],
	[/^(GP-)?DR|^PR-DR/, {
		area: 'drawing-rule-bindings',
		editFiles: ['contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json'],
		inspectFiles: ['gsd_plan_report.json', 'project_rule_report.json', 'contracts/drawing_rule_registry.mjs', 'harness/rule_registry.mjs'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Bind every contract drawingRules and manifest qualityRules string to executable harness rules; do not let prose-only drawing rules pass generation.',
	}],
	[/^PR6|^PR7|^PR8/, {
		area: 'project-rules',
		editFiles: ['project_contract.json', 'project_assembly.json', 'harness/rule_registry.mjs', 'harness/rules/'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Keep assembly modules, interfaces, and core reusable rules in sync with the project contract.',
	}],
	[/^PP/, {
		area: 'project-pack',
		editFiles: ['project_assembly.json', 'circuit_packs/registry.mjs', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json'],
		inspectFiles: ['project_pack_report.json', 'project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json'],
		nextCommand: 'npm.cmd run contract:pack',
		repairHint: 'Implement the selected circuit pack, remove scaffoldOnly, keep it registered, and ensure it exposes id, cellBuilders, fallbackAnchors, library normalization, and matching cell manifest packId.',
	}],
	[/^LC|^GP-LC|^LIB-MANIFEST/, {
		area: 'project-library',
		editFiles: ['approved_library_manifest.json', 'project_contract.json'],
		inspectFiles: ['project_library_report.json', 'approved_library_manifest.json', 'project_contract.json'],
		nextCommand: 'npm.cmd run contract:library',
		repairHint: 'Bind every contract requiredPart to approved EasyEDA library Symbol, Device, Footprint, name/value, and BOM/PCB state before generation or write-back.',
	}],
	[/^CM1[6-9]|^CM20|^CB1[4-8]/, {
		area: 'cell-port-layout',
		editFiles: ['circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly.json'],
		inspectFiles: ['cell_manifest_report.json', 'gsd_plan_report.json', 'circuit_packs/<pack>/cell_manifest.json'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Make port layout executable: manifest portLayout must declare each port side/kind/label, and builders must emit real netflags on those ports with left-bottom alignMode=6 or right-bottom alignMode=8 instead of fake text or floating labels.',
	}],
	[/^CM/, {
		area: 'cell-manifest',
		editFiles: ['circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs', 'project_assembly.json'],
		inspectFiles: ['cell_manifest_report.json', 'project_assembly_report.json'],
		nextCommand: 'npm.cmd run contract:cells',
		repairHint: 'Declare deterministic cell capabilities in the selected circuit-pack manifest and keep implemented builders plus project_assembly.json mappings in sync.',
	}],
	[/^GP8|^GP1[5-7]/, {
		area: 'cell-builder-bootstrap',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['gsd_plan_report.json', 'project_assembly.json', 'cell_manifest_report.json'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Bootstrap executable cell mappings: every assembly module needs cell, refs, anchor, netArgs/nets, and a selected manifest cell implemented by the active circuit pack before generation runs.',
	}],
	[/^CB/, {
		area: 'cell-builder-output',
		editFiles: ['circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'project_assembly.json', 'project_contract.json'],
		inspectFiles: ['gsd_plan_report.json', 'cell_manifest_report.json', 'project_assembly.json', 'full_model.json'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Fix deterministic cell builder output before model generation: return real place/wires/flags arrays, use orthogonal segments, declare output nets, and avoid fake text labels.',
	}],
	[/^PA/, {
		area: 'project-assembly',
		editFiles: ['project_assembly.json', 'project_contract.json', 'circuit_packs/<pack>/cell_manifest.json', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['project_assembly_report.json', 'cell_manifest_report.json'],
		nextCommand: 'npm.cmd run contract:assembly',
		repairHint: 'Map every contract module to a deterministic cell, anchor, ref roles, netArgs, and declared nets.',
	}],
	[/^GP2[7-9]|^GP3[0-4]|^PL2[2-9]/, {
		area: 'interface-routing-contract',
		editFiles: ['project_assembly.json', 'project_contract.json'],
		inspectFiles: ['gsd_plan_report.json', 'project_layout_report.json', 'project_assembly.json'],
		nextCommand: 'node bin/easyeda-gsd.mjs plan project_spec.json',
		repairHint: 'Declare layoutPolicy.interfaceRoutes for every project_contract interface: net/from/to, strategy visible-continuity or grouped-net-label, readable channel, and direction before generation or layout acceptance.',
	}],
	[/^PL/, {
		area: 'project-layout',
		editFiles: ['project_assembly.json', 'engine/layout_planner.mjs', 'contracts/layout_contract.mjs'],
		inspectFiles: ['layout_planner_report.json', 'layout_planner_structure.json', 'project_layout_report.json', 'contracts/layout_contract.mjs'],
		nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		repairHint: 'Fix project_assembly.json layoutPolicy or planner consumption until candidate source, module gaps, interlocks, and wire intrusions pass.',
	}],
	[/^PM/, {
		area: 'project-model',
		editFiles: ['project_contract.json', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json'],
		inspectFiles: ['full_model.json', 'project_model_report.json'],
		nextCommand: 'npm.cmd run fast && npm.cmd run contract:model',
		repairHint: 'Make the generated model express every required part, net, and interface near its source and target modules.',
	}],
	[/^PN/, {
		area: 'project-netlist',
		editFiles: ['project_netlist.json', 'project_contract.json', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'contracts/net_contract.mjs', 'engine/connectivity_qc.mjs'],
		inspectFiles: ['project_netlist_report.json', 'full_model.json', 'project_contract.json', 'contracts/net_contract.mjs'],
		nextCommand: 'npm.cmd run fast && npm.cmd run contract:netlist',
		repairHint: 'Make structured electrical intent explicit in project_netlist.json and ensure generated pins resolve to the required named nets.',
	}],
	[/^PLM/, {
		area: 'project-live-model',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'engine/apply_gated.mjs'],
		inspectFiles: ['live.json', 'project_live_model_report.json', 'full_model.json', 'apply_report.json'],
		nextCommand: 'npm.cmd run accept:live',
		repairHint: 'Make the real EasyEDA live snapshot satisfy project_contract.json; fix deterministic generation or gated write-back rather than trusting local-only PASS.',
	}],
	[/^PV/, {
		area: 'project-visual',
		editFiles: ['project_contract.json', 'engine/visual_crops.mjs'],
		inspectFiles: ['visual_review_report.json', 'project_visual_report.json', 'visual_crops/'],
		nextCommand: 'npm.cmd run preview && npm.cmd run contract:visual',
		repairHint: 'Add or repair visual evidence regions so every contract region has a passing crop.',
	}],
	[/^V\d|^SO|^I\d/, {
		area: 'preview',
		editFiles: ['engine/sheet_renderer.mjs', 'engine/sheet_output_gate.mjs', 'engine/visual_crops.mjs', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['visual_review_report.json', 'visual_crops/', 'layout_planner_sheet.png'],
		nextCommand: 'npm.cmd run preview',
		repairHint: 'Fix renderer/model geometry or crop definitions until preview evidence is nonblank, readable, and collision-free.',
	}],
	[/^G1|^G2|^L2|^L3|^L4|^L5|^L6|^F2|^C20\.(8|9|10|11)/, {
		area: 'geometry-overlap',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/cell_manifest.json', 'harness/config.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Move symbols, labels, frames, or local wires in deterministic cells; do not patch EasyEDA manually.',
	}],
	[/^G3|^E4/, {
		area: 'net-crossing',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Remove different-net crossings or mixed physical nets by changing deterministic wire geometry and net ownership.',
	}],
	[/^E2|^E3/, {
		area: 'electrical-connectivity',
		editFiles: ['project_netlist.json', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['report.json', 'full_model.json', 'snap2.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Fix pin-to-wire endpoints, net names, or required connectivity in the deterministic cell that owns the affected part.',
	}],
	[/^L1|^L7|^L8|^L9|^L10|^C6/, {
		area: 'net-labels',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'engine/wire_label_qc.mjs', 'harness/config.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Use real wire Name attributes, bottom-left/bottom-right alignment modes, short named stubs, and no vertical named wires.',
	}],
	[/^C8|^S4|^S5|^S7|^S8|^S11|^S12|^S13|^S14|^S15|^P[1-9]|^A[1-4]/, {
		area: 'layout-structure',
		editFiles: ['project_assembly.json', 'engine/layout_planner.mjs', 'circuit_packs/<pack>/pack.mjs', 'harness/config.mjs'],
		inspectFiles: ['layout_planner_report.json', 'layout_planner_structure.json', 'report.json'],
		nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		repairHint: 'Adjust layoutPolicy search space, module anchors, or local cell footprint until module rectangles are separated and readable.',
	}],
	[/^C9|^C14|^C15|^C16|^C17|^C18|^C19/, {
		area: 'reference-quality',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'harness/config.mjs', 'harness/rules/'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Fix the project-specific reference-quality pattern in deterministic cells or tighten/repair its rule.',
	}],
	[/^SI/, {
		area: 'system-intent',
		editFiles: ['project_contract.json', 'project_assembly.json', 'engine/interface_contract.mjs', 'circuit_packs/<pack>/pack.mjs'],
		inspectFiles: ['layout_planner_report.json', 'report.json'],
		nextCommand: 'npm.cmd run pipeline',
		repairHint: 'Make power tree, bring-up nets, external interfaces, and left-to-right reading flow explicit in the generated schematic.',
	}],
	[/^DRC/, {
		area: 'drc',
		editFiles: ['project_assembly.json', 'circuit_packs/<pack>/pack.mjs', 'engine/apply_gated.mjs'],
		inspectFiles: ['drc_report.json', 'live.json', 'live_canvas.png'],
		nextCommand: 'npm.cmd run accept:live',
		repairHint: 'Fix the deterministic source and re-apply through apply:gated; do not clear DRC by manual EasyEDA edits.',
	}],
	[/^AW/, {
		area: 'apply-writer',
		editFiles: ['circuit_packs/<pack>/pack.mjs', 'circuit_packs/<pack>/apply_writer.mjs', 'circuit_packs/<pack>/apply_run.mjs', 'engine/apply_gated.mjs'],
		inspectFiles: ['apply_report.json', 'project_assembly.json', 'circuit_packs/<pack>/pack.mjs'],
		nextCommand: 'npm.cmd run apply:gated',
		repairHint: 'Declare and implement an explicit pack writer before external write-back; apply:gated must never reuse the bundled AIHWDEBUGER writer for another circuit pack.',
	}],
	[/^LS/, {
		area: 'live-capture',
		editFiles: ['engine/live_shots.mjs', 'engine/bridge_exec.mjs'],
		inspectFiles: ['live_shots_report.json', 'live_diagnose_report.json'],
		nextCommand: 'npm.cmd run live:diagnose',
		repairHint: 'Repair EasyEDA bridge/canvas capture behavior or crop fallback evidence until live module shots are distinct.',
	}],
	[/^SP/, {
		area: 'severity-policy',
		editFiles: ['engine/', 'harness/'],
		inspectFiles: ['acceptance_report.json'],
		nextCommand: 'npm.cmd run accept',
		repairHint: 'Keep acceptance gates fail-closed with hard-only severities and zero non-hard warning/info budgets.',
	}],
	[/^FE/, {
		area: 'final-evidence',
		editFiles: ['engine/final_evidence_gate.mjs', 'engine/acceptance_run.mjs', 'project_spec.json', 'project_contract.json', 'project_netlist.json', 'project_assembly.json'],
		inspectFiles: ['final_evidence_report.json', 'acceptance_report.json', 'gsd_plan_report.json', 'gsd_generate_report.json', 'repair_actions.json', 'next_actions.json'],
		nextCommand: 'npm.cmd run accept',
		repairHint: 'Regenerate evidence for the active project spec context; stale or mismatched root-project reports must not be used as final proof.',
	}],
];

function defaultPlan(gate, report) {
	return {
		area: gate,
		editFiles: report?.gate === 'acceptance' ? ['engine/acceptance_run.mjs', 'package.json'] : ['engine/', 'harness/'],
		inspectFiles: [report?.file || 'acceptance_report.json'],
		nextCommand: report?.rerun || 'npm.cmd run accept',
		repairHint: 'Inspect the finding and repair the deterministic source or project contract that owns it.',
	};
}

function planForFinding(finding, report) {
	const matched = firstMatch(finding.rule, RULE_PLANS);
	return matched || defaultPlan(report.gate, report);
}

function findingItems(report) {
	const data = readJson(report.file);
	if (!data) return [];
	if (data.parseError) {
		return [{
			gate: report.gate,
			report: report.file,
			finding: {
				rule: 'REPORT-parse',
				severity: 'hard',
				category: 'report',
				msg: `${report.file} could not parse`,
				where: { error: data.parseError, path: data.path },
			},
		}];
	}
	return asArray(data.findings)
		.filter(f => f && (f.severity === 'hard' || f.severity === undefined))
		.map(finding => ({ gate: report.gate, report: report.file, finding }));
}

function commandForAction(action, fallback) {
	return contextAwareCommand(action.nextCommand || fallback || 'npm.cmd run accept');
}

const rawFindings = REPORTS.flatMap(findingItems);
const actions = rawFindings.map((item, index) => {
	const report = REPORTS.find(r => r.file === item.report) || {};
	const plan = planForFinding(item.finding, report);
	return {
		priority: index + 1,
		area: plan.area,
		gate: item.gate,
		rule: item.finding.rule || 'unknown-rule',
		severity: item.finding.severity || 'hard',
		message: item.finding.msg || '',
		editFiles: uniq(resolvePackPlaceholder(plan.editFiles || [])),
		inspectFiles: uniq(resolvePackPlaceholder([...(plan.inspectFiles || []), item.report])),
		nextCommand: commandForAction(plan, report.rerun),
		repairHint: plan.repairHint,
		where: item.finding.where || {},
	};
});

const grouped = {};
for (const action of actions) {
	if (!grouped[action.area]) grouped[action.area] = {
		area: action.area,
		count: 0,
		editFiles: [],
		inspectFiles: [],
		nextCommands: [],
		rules: [],
	};
	const g = grouped[action.area];
	g.count += 1;
	g.editFiles = uniq([...g.editFiles, ...action.editFiles]);
	g.inspectFiles = uniq([...g.inspectFiles, ...action.inspectFiles]);
	g.nextCommands = uniq([...g.nextCommands, action.nextCommand]);
	g.rules = uniq([...g.rules, action.rule]);
}

const result = {
	generatedAt: new Date().toISOString(),
	pass: actions.length === 0,
	severity: { hard: actions.length, soft: 0, info: 0 },
	context: {
		spec: currentSpecArg(),
		assemblyPath: normalizePath(currentAssemblyPath()),
		circuitPack: CURRENT_CIRCUIT_PACK,
	},
	actionCount: actions.length,
	areas: Object.values(grouped).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
	actions,
};

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
console.log(`repair actions ${result.pass ? 'PASS' : 'OPEN'} count=${actions.length}`);
console.log(`report -> ${OUT}`);
process.exit(result.pass ? 0 : 1);
