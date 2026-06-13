import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_REPAIR_ACTIONS || DIR + 'repair_actions.json';

const REPORTS = [
	{ gate: 'entrypoints', file: 'entrypoint_audit_report.json', rerun: 'npm.cmd run entrypoints' },
	{ gate: 'agent-instructions', file: 'agent_instruction_report.json', rerun: 'npm.cmd run agent:instructions' },
	{ gate: 'workflow-smoke', file: 'workflow_smoke_report.json', rerun: 'npm.cmd run workflow:smoke' },
	{ gate: 'action-schema', file: 'action_schema_report.json', rerun: 'npm.cmd run action:schema' },
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
	{ gate: 'live-shots', file: 'live_shots_report.json', rerun: 'npm.cmd run live:shots' },
	{ gate: 'acceptance', file: 'acceptance_report.json', rerun: 'npm.cmd run accept' },
];

function readJson(name) {
	const path = DIR + name;
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
	[/^PC/, {
		area: 'project-contract',
		editFiles: ['project_contract.json', 'contracts/module_contract.mjs'],
		inspectFiles: ['project_spec.json', 'project_contract_report.json', 'contracts/module_contract.mjs'],
		nextCommand: 'npm.cmd run contract',
		repairHint: 'Fix the machine contract: modules, required parts/nets, interfaces, visual evidence, and no-free-draw policy.',
	}],
	[/^PR1|^PR2|^PR3|^PR4/, {
		area: 'project-rules',
		editFiles: ['harness/module_registry.mjs', 'project_contract.json'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Make module registry and required parts exactly cover the contract modules without stale refs.',
	}],
	[/^PR5/, {
		area: 'project-rules',
		editFiles: ['engine/interface_contract.mjs', 'project_contract.json'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Register each cross-module interface contract with the same normalized source/target module ids.',
	}],
	[/^PR6/, {
		area: 'project-rules',
		editFiles: ['harness/rule_registry.mjs', 'harness/rules/'],
		inspectFiles: ['project_rule_report.json'],
		nextCommand: 'npm.cmd run contract:rules',
		repairHint: 'Restore missing core rules instead of weakening the project contract.',
	}],
	[/^PP/, {
		area: 'project-pack',
		editFiles: ['project_assembly.json', 'circuit_packs/registry.mjs', 'circuit_packs/aihwdebugger/pack.mjs'],
		inspectFiles: ['project_pack_report.json', 'circuit_packs/aihwdebugger/cell_manifest.json'],
		nextCommand: 'npm.cmd run contract:pack',
		repairHint: 'Keep the selected circuit pack registered and ensure it exposes id, cellBuilders, fallbackAnchors, library normalization, and matching cell manifest packId.',
	}],
	[/^LC|^GP-LC|^LIB-MANIFEST/, {
		area: 'project-library',
		editFiles: ['approved_library_manifest.json', 'project_contract.json'],
		inspectFiles: ['project_library_report.json', 'approved_library_manifest.json', 'project_contract.json'],
		nextCommand: 'npm.cmd run contract:library',
		repairHint: 'Bind every contract requiredPart to approved EasyEDA library Symbol, Device, Footprint, name/value, and BOM/PCB state before generation or write-back.',
	}],
	[/^CM/, {
		area: 'cell-manifest',
		editFiles: ['circuit_packs/aihwdebugger/cell_manifest.json', 'project_assembly.json', 'engine/cells.mjs', 'engine/assemble.mjs'],
		inspectFiles: ['cell_manifest_report.json', 'project_assembly_report.json'],
		nextCommand: 'npm.cmd run contract:cells',
		repairHint: 'Declare deterministic cell capabilities in the selected circuit-pack manifest and keep implemented builders plus project_assembly.json mappings in sync.',
	}],
	[/^PA/, {
		area: 'project-assembly',
		editFiles: ['project_assembly.json', 'project_contract.json', 'circuit_packs/aihwdebugger/cell_manifest.json', 'engine/cells.mjs', 'engine/assemble.mjs'],
		inspectFiles: ['project_assembly_report.json', 'cell_manifest_report.json'],
		nextCommand: 'npm.cmd run contract:assembly',
		repairHint: 'Map every contract module to a deterministic cell, anchor, ref roles, netArgs, and declared nets.',
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
		editFiles: ['project_contract.json', 'project_assembly.json', 'engine/cells.mjs', 'engine/assemble.mjs'],
		inspectFiles: ['full_model.json', 'project_model_report.json'],
		nextCommand: 'npm.cmd run fast && npm.cmd run contract:model',
		repairHint: 'Make the generated model express every required part, net, and interface near its source and target modules.',
	}],
	[/^PN/, {
		area: 'project-netlist',
		editFiles: ['project_netlist.json', 'project_contract.json', 'contracts/net_contract.mjs', 'engine/cells.mjs', 'engine/connectivity_qc.mjs'],
		inspectFiles: ['project_netlist_report.json', 'full_model.json', 'project_contract.json', 'contracts/net_contract.mjs'],
		nextCommand: 'npm.cmd run fast && npm.cmd run contract:netlist',
		repairHint: 'Make structured electrical intent explicit in project_netlist.json and ensure generated pins resolve to the required named nets.',
	}],
	[/^PLM/, {
		area: 'project-live-model',
		editFiles: ['engine/cells.mjs', 'engine/assemble.mjs', 'project_assembly.json', 'engine/apply_gated.mjs'],
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
		editFiles: ['engine/sheet_renderer.mjs', 'engine/sheet_output_gate.mjs', 'engine/visual_crops.mjs', 'engine/cells.mjs', 'engine/assemble.mjs'],
		inspectFiles: ['visual_review_report.json', 'visual_crops/', 'layout_planner_sheet.png'],
		nextCommand: 'npm.cmd run preview',
		repairHint: 'Fix renderer/model geometry or crop definitions until preview evidence is nonblank, readable, and collision-free.',
	}],
	[/^G1|^G2|^L2|^L3|^L4|^L5|^L6|^F2|^C20\.(8|9|10|11)/, {
		area: 'geometry-overlap',
		editFiles: ['engine/cells.mjs', 'engine/assemble.mjs', 'project_assembly.json', 'harness/config.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Move symbols, labels, frames, or local wires in deterministic cells; do not patch EasyEDA manually.',
	}],
	[/^G3|^E4/, {
		area: 'net-crossing',
		editFiles: ['engine/cells.mjs', 'engine/assemble.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Remove different-net crossings or mixed physical nets by changing deterministic wire geometry and net ownership.',
	}],
	[/^E2|^E3/, {
		area: 'electrical-connectivity',
		editFiles: ['engine/cells.mjs', 'engine/assemble.mjs', 'project_assembly.json'],
		inspectFiles: ['report.json', 'full_model.json', 'snap2.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Fix pin-to-wire endpoints, net names, or required connectivity in the deterministic cell that owns the affected part.',
	}],
	[/^L1|^L7|^L8|^L9|^L10|^C6/, {
		area: 'net-labels',
		editFiles: ['engine/cells.mjs', 'engine/wire_label_qc.mjs', 'harness/config.mjs'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Use real wire Name attributes, bottom-left/bottom-right alignment modes, short named stubs, and no vertical named wires.',
	}],
	[/^C8|^S4|^S5|^S7|^S8|^S11|^S12|^S13|^S14|^S15|^P[1-9]|^A[1-4]/, {
		area: 'layout-structure',
		editFiles: ['project_assembly.json', 'engine/layout_planner.mjs', 'engine/cells.mjs', 'harness/config.mjs'],
		inspectFiles: ['layout_planner_report.json', 'layout_planner_structure.json', 'report.json'],
		nextCommand: 'npm.cmd run pipeline && npm.cmd run contract:layout',
		repairHint: 'Adjust layoutPolicy search space, module anchors, or local cell footprint until module rectangles are separated and readable.',
	}],
	[/^C9|^C14|^C15|^C16|^C17|^C18|^C19/, {
		area: 'reference-quality',
		editFiles: ['engine/cells.mjs', 'harness/config.mjs', 'harness/rules/'],
		inspectFiles: ['report.json', 'full_model.json'],
		nextCommand: 'npm.cmd run fast',
		repairHint: 'Fix the project-specific reference-quality pattern in deterministic cells or tighten/repair its rule.',
	}],
	[/^SI/, {
		area: 'system-intent',
		editFiles: ['project_contract.json', 'project_assembly.json', 'engine/interface_contract.mjs', 'engine/cells.mjs'],
		inspectFiles: ['layout_planner_report.json', 'report.json'],
		nextCommand: 'npm.cmd run pipeline',
		repairHint: 'Make power tree, bring-up nets, external interfaces, and left-to-right reading flow explicit in the generated schematic.',
	}],
	[/^DRC/, {
		area: 'drc',
		editFiles: ['engine/cells.mjs', 'engine/assemble.mjs', 'engine/apply_gated.mjs'],
		inspectFiles: ['drc_report.json', 'live.json', 'live_canvas.png'],
		nextCommand: 'npm.cmd run accept:live',
		repairHint: 'Fix the deterministic source and re-apply through apply:gated; do not clear DRC by manual EasyEDA edits.',
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
	return action.nextCommand || fallback || 'npm.cmd run accept';
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
		editFiles: uniq(plan.editFiles || []),
		inspectFiles: uniq([...(plan.inspectFiles || []), item.report]),
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
	actionCount: actions.length,
	areas: Object.values(grouped).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area)),
	actions,
};

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
console.log(`repair actions ${result.pass ? 'PASS' : 'OPEN'} count=${actions.length}`);
console.log(`report -> ${OUT}`);
process.exit(result.pass ? 0 : 1);
