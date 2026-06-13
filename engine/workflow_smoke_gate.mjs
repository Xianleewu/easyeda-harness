import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGsdPlan } from '../workflows/gsd_plan.mjs';
import { runGsdGenerate } from '../workflows/gsd_generate.mjs';
import { writeScaffold } from '../workflows/gsd_scaffold.mjs';
import { buildMinimalSpec, syncPackRegistry, writePackScaffold } from '../workflows/pack_scaffold.mjs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';
import { buildAnchorFamily } from './layout_planner.mjs';
import { acquireRunLock } from '../workflows/run_lock.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
let LOCK;
try {
	LOCK = acquireRunLock(ROOT);
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
const REPORT = process.env.EASYEDA_WORKFLOW_SMOKE_REPORT || `${ROOT}/workflow_smoke_report.json`;
const TMP_DIR = `${ROOT}/_tmp_workflow_smoke`;
const BAD_SPEC = `${TMP_DIR}/bad_project_spec.json`;
const SCAFFOLD_DIR = `${TMP_DIR}/scaffold`;
const BAD_MANIFEST = `${TMP_DIR}/bad_cell_manifest.json`;
const BAD_MANIFEST_ASSEMBLY = `${TMP_DIR}/bad_manifest_project_assembly.json`;
const GENERIC_RULE_DIR = `${TMP_DIR}/generic_rule_project`;
const CUSTOM_PACK = 'workflow_smoke_pack';
const CUSTOM_PACK_DIR = `${ROOT}/circuit_packs/${CUSTOM_PACK}`;

process.on('exit', () => LOCK.release());
process.on('SIGINT', () => {
	LOCK.release();
	process.exit(130);
});
process.on('SIGTERM', () => {
	LOCK.release();
	process.exit(143);
});

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'workflow-smoke', msg, where });
}

function assertFinding(findings, condition, rule, msg, where = {}) {
	if (!condition) hard(findings, rule, msg, where);
}

function fileMtimeMs(path) {
	if (!existsSync(path)) return null;
	return statSync(path).mtimeMs;
}

function hasRule(report, rule) {
	return (report?.findings || []).some(f => f.rule === rule);
}

function buildPlanForFiles({ spec, contract, netlist, assembly, libraryManifest, specPath }) {
	const modelPath = `${ROOT}/full_model.json`;
	const model = existsSync(modelPath) ? readJson(modelPath) : null;
	return buildGsdPlan({ spec, contract, netlist, assembly, libraryManifest, model, specPath });
}

const findings = [];
const checks = {};

rmSync(TMP_DIR, { recursive: true, force: true });
rmSync(CUSTOM_PACK_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

try {
	const spec = readJson(`${ROOT}/project_spec.json`);
	const contract = readJson(`${ROOT}/project_contract.json`);
	const netlist = readJson(`${ROOT}/project_netlist.json`);
	const assembly = readJson(`${ROOT}/project_assembly.json`);
	const libraryManifest = readJson(`${ROOT}/approved_library_manifest.json`);
	const assembleSource = readFileSync(`${ROOT}/engine/assemble.mjs`, 'utf8');
	const repairSource = readFileSync(`${ROOT}/engine/repair_actions.mjs`, 'utf8');
	const nextActionsSource = readFileSync(`${ROOT}/engine/next_actions.mjs`, 'utf8');

	checks.noGlobalCellBuildersExport = {
		assembleExportsGlobalCellBuilders: /export\s+const\s+CELL_BUILDERS\b/.test(assembleSource),
		assembleBindsAihwdebuggerBuilders: /getCircuitPack\(['"]aihwdebugger['"]\)\.cellBuilders/.test(assembleSource),
	};
	assertFinding(
		findings,
		!checks.noGlobalCellBuildersExport.assembleExportsGlobalCellBuilders
			&& !checks.noGlobalCellBuildersExport.assembleBindsAihwdebuggerBuilders,
		'WS24-no-global-cell-builders-export',
		'generic assemble.mjs must not export AIHWDEBUGGER cell builders; selected pack builders must come from project_assembly.json',
		checks.noGlobalCellBuildersExport,
	);

	checks.packAwareRepairTargets = {
		repairActionsRootCellTargets: (repairSource.match(/['"]engine\/cells\.mjs['"]/g) || []).length,
		nextActionsRootCellTargets: (nextActionsSource.match(/['"]engine\/cells\.mjs['"]/g) || []).length,
		repairActionsPackTargets: (repairSource.match(/circuit_packs\/<pack>\/pack\.mjs/g) || []).length,
		nextActionsPackTargets: (nextActionsSource.match(/circuit_packs\/<pack>\/pack\.mjs/g) || []).length,
	};
	assertFinding(
		findings,
		checks.packAwareRepairTargets.repairActionsRootCellTargets === 0
			&& checks.packAwareRepairTargets.nextActionsRootCellTargets === 0
			&& checks.packAwareRepairTargets.repairActionsPackTargets > 0
			&& checks.packAwareRepairTargets.nextActionsPackTargets > 0,
		'WS25-pack-aware-repair-targets',
		'repair and next-action guidance must point agents at the selected circuit pack instead of the bundled root engine/cells.mjs example',
		checks.packAwareRepairTargets,
	);

	const rootPlan = buildPlanForFiles({
		spec,
		contract,
		netlist,
		assembly,
		libraryManifest,
		specPath: 'project_spec.json',
	});
	checks.rootPlan = { pass: rootPlan.pass, severity: rootPlan.severity };
	assertFinding(findings, rootPlan.pass === true, 'WS1-root-plan-pass', 'root GSD plan must pass before workflow smoke can be trusted', {
		severity: rootPlan.severity,
		firstFinding: rootPlan.findings?.[0] || null,
	});

	const badSpec = clone(spec);
	badSpec.projectId = `${spec.projectId || 'project'}-workflow-smoke-mismatch`;
	const mismatchPlan = buildPlanForFiles({
		spec: badSpec,
		contract,
		netlist,
		assembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/bad_project_spec.json',
	});
	checks.projectMismatchRejected = {
		pass: !mismatchPlan.pass,
		rules: (mismatchPlan.findings || []).map(f => f.rule),
	};
	for (const rule of ['GP1-project-id-contract', 'GP2-project-id-netlist', 'GP3-project-id-assembly']) {
		assertFinding(findings, hasRule(mismatchPlan, rule), `WS2-${rule}`, 'projectId mismatch must be rejected by GSD plan', {
			expectedRule: rule,
			observedRules: checks.projectMismatchRejected.rules,
		});
	}

	const noColumnsAssembly = clone(assembly);
	delete noColumnsAssembly.layoutPolicy.columns;
	const noColumnsPlan = buildPlanForFiles({
		spec,
		contract,
		netlist,
		assembly: noColumnsAssembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/no_columns_project_spec.json',
	});
	checks.layoutColumnsRequired = {
		pass: !noColumnsPlan.pass && hasRule(noColumnsPlan, 'GP12-layout-policy-present'),
		rules: (noColumnsPlan.findings || []).map(f => f.rule),
	};
	assertFinding(findings, checks.layoutColumnsRequired.pass, 'WS3-layout-columns-required', 'GSD plan must reject layout policies that do not declare ordered columns', {
		observedRules: checks.layoutColumnsRequired.rules,
	});

	const noDrawingRulesContract = clone(contract);
	if (noDrawingRulesContract.modules?.[0]) delete noDrawingRulesContract.modules[0].drawingRules;
	const noDrawingRulesPlan = buildPlanForFiles({
		spec,
		contract: noDrawingRulesContract,
		netlist,
		assembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/no_drawing_rules_project_spec.json',
	});
	checks.moduleDrawingRulesRequired = {
		pass: !noDrawingRulesPlan.pass && hasRule(noDrawingRulesPlan, 'PC27-module-drawing-rules'),
		rules: (noDrawingRulesPlan.findings || []).map(f => f.rule),
	};
	assertFinding(findings, checks.moduleDrawingRulesRequired.pass, 'WS16-module-drawing-rules-required', 'GSD plan must reject modules that do not declare reusable drawing rule contracts before generation', {
		observedRules: checks.moduleDrawingRulesRequired.rules,
	});

	const missingBuilderAssembly = clone(assembly);
	if (missingBuilderAssembly.modules?.[0]) missingBuilderAssembly.modules[0].cell = 'notImplementedCell';
	const missingBuilderPlan = buildPlanForFiles({
		spec,
		contract,
		netlist,
		assembly: missingBuilderAssembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/missing_builder_project_spec.json',
	});
	checks.planRejectsMissingCellBuilder = {
		pass: !missingBuilderPlan.pass && (hasRule(missingBuilderPlan, 'GP16-assembly-cell-declared') || hasRule(missingBuilderPlan, 'GP17-assembly-cell-builder')),
		rules: (missingBuilderPlan.findings || []).map(f => f.rule),
	};
	assertFinding(
		findings,
		checks.planRejectsMissingCellBuilder.pass,
		'WS22-plan-rejects-missing-cell-builder',
		'GSD plan must reject assembly cells that are not declared in the active manifest or not implemented by the selected circuit pack before generation runs',
		{
			observedRules: checks.planRejectsMissingCellBuilder.rules,
		},
	);

	writeFileSync(BAD_SPEC, JSON.stringify(badSpec, null, 2) + '\n', 'utf8');
	const fullModelPath = `${ROOT}/full_model.json`;
	const beforeFullModelMtime = fileMtimeMs(fullModelPath);
	const badGenerate = runGsdGenerate({
		root: ROOT,
		specPath: '_tmp_workflow_smoke/bad_project_spec.json',
		command: ['engine/pipeline_fast.mjs'],
		draft: true,
	});
	const afterFullModelMtime = fileMtimeMs(fullModelPath);
	checks.badGenerateRejected = {
		pass: badGenerate.status !== 0,
		stage: badGenerate.report?.stage || null,
		fullModelMtimeUnchanged: beforeFullModelMtime === afterFullModelMtime,
	};
	assertFinding(findings, badGenerate.status !== 0 && badGenerate.report?.stage === 'plan', 'WS3-generate-plan-gated', 'GSD generate must stop at plan stage for invalid specs', {
		status: badGenerate.status,
		stage: badGenerate.report?.stage || null,
	});
	assertFinding(findings, beforeFullModelMtime === afterFullModelMtime, 'WS4-generate-no-side-effect-on-bad-plan', 'GSD generate must not rewrite full_model.json when plan fails', {
		beforeFullModelMtime,
		afterFullModelMtime,
	});

	const missingPartManifest = clone(libraryManifest);
	const firstRequiredPart = (contract.modules || []).flatMap(mod => mod.requiredParts || [])[0];
	if (firstRequiredPart) delete missingPartManifest.parts[firstRequiredPart];
	const missingPartResult = validateLibraryContract(contract, missingPartManifest);
	checks.libraryMissingPartRejected = {
		pass: missingPartResult.findings.some(f => f.rule === 'LC4-required-part-approved'),
		removedPart: firstRequiredPart || null,
	};
	assertFinding(
		findings,
		checks.libraryMissingPartRejected.pass,
		'WS5-library-missing-part-rejected',
		'approved library manifest must fail when a required part binding is missing',
		{ removedPart: firstRequiredPart || null, findings: missingPartResult.findings },
	);

	const badManifest = clone(readJson(`${ROOT}/circuit_packs/aihwdebugger/cell_manifest.json`));
	if (badManifest.cells?.[0]) delete badManifest.cells[0].qualityRules;
	const badManifestAssembly = { ...assembly, cellManifest: '_tmp_workflow_smoke/bad_cell_manifest.json' };
	writeFileSync(BAD_MANIFEST, JSON.stringify(badManifest, null, 2) + '\n', 'utf8');
	writeFileSync(BAD_MANIFEST_ASSEMBLY, JSON.stringify(badManifestAssembly, null, 2) + '\n', 'utf8');
	const badManifestGate = spawnSync(process.execPath, ['engine/project_cell_manifest_gate.mjs'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_ASSEMBLY: BAD_MANIFEST_ASSEMBLY,
			EASYEDA_CELL_MANIFEST_REPORT: `${TMP_DIR}/bad_cell_manifest_report.json`,
		},
		encoding: 'utf8',
	});
	const badManifestReport = existsSync(`${TMP_DIR}/bad_cell_manifest_report.json`)
		? readJson(`${TMP_DIR}/bad_cell_manifest_report.json`)
		: null;
	checks.cellQualityRulesRejected = {
		pass: badManifestGate.status !== 0 && (badManifestReport?.findings || []).some(f => f.rule === 'CM15-cell-quality-rules'),
		status: badManifestGate.status,
		rules: (badManifestReport?.findings || []).map(f => f.rule),
	};
	assertFinding(findings, checks.cellQualityRulesRejected.pass, 'WS11-cell-quality-rules-rejected', 'cell manifest gate must reject cells that do not declare required reusable quality rules', {
		status: badManifestGate.status,
		stdout: badManifestGate.stdout,
		stderr: badManifestGate.stderr,
		observedRules: checks.cellQualityRulesRejected.rules,
	});

	const scaffoldReport = writeScaffold({ outDir: SCAFFOLD_DIR, spec, pack: spec.circuitPack || 'aihwdebugger' });
	const scaffoldFiles = [
		'project_spec.json',
		'project_contract.json',
		'project_netlist.json',
		'project_assembly.json',
		'approved_library_manifest.json',
		'gsd_scaffold_report.json',
	];
	const missingScaffoldFiles = scaffoldFiles.filter(name => !existsSync(`${SCAFFOLD_DIR}/${name}`));
	const scaffoldSpec = readJson(`${SCAFFOLD_DIR}/project_spec.json`);
	const scaffoldContract = readJson(`${SCAFFOLD_DIR}/project_contract.json`);
	const scaffoldNetlist = readJson(`${SCAFFOLD_DIR}/project_netlist.json`);
	const scaffoldAssembly = readJson(`${SCAFFOLD_DIR}/project_assembly.json`);
	const scaffoldLibrary = readJson(`${SCAFFOLD_DIR}/approved_library_manifest.json`);
	const scaffoldPlan = buildGsdPlan({
		spec: scaffoldSpec,
		contract: scaffoldContract,
		netlist: scaffoldNetlist,
		assembly: scaffoldAssembly,
		libraryManifest: scaffoldLibrary,
		model: null,
		specPath: '_tmp_workflow_smoke/scaffold/project_spec.json',
	});
	checks.scaffold = {
		pass: scaffoldReport.pass === true,
		readyForGenerate: scaffoldReport.readyForGenerate,
		missingFiles: missingScaffoldFiles,
		planPass: scaffoldPlan.pass,
		rules: (scaffoldPlan.findings || []).map(f => f.rule),
	};
	assertFinding(findings, missingScaffoldFiles.length === 0, 'WS6-scaffold-files-present', 'GSD scaffold must emit all editable project contract files', {
		missingScaffoldFiles,
	});
	assertFinding(findings, scaffoldReport.readyForGenerate === false, 'WS7-scaffold-not-ready', 'GSD scaffold must be explicitly not ready for generation until filled by an agent', {
		readyForGenerate: scaffoldReport.readyForGenerate,
	});
	assertFinding(findings, scaffoldPlan.pass === false, 'WS8-scaffold-plan-fails', 'fresh scaffold must fail plan until required parts, pins, library bindings, and cells are filled', {
		severity: scaffoldPlan.severity,
		firstFinding: scaffoldPlan.findings?.[0] || null,
	});
	for (const rule of ['GP6-contract-parts', 'GP8-assembly-executable-module', 'GP-LC3-approved-parts']) {
		assertFinding(findings, hasRule(scaffoldPlan, rule), `WS9-${rule}`, 'fresh scaffold must expose incomplete work through specific plan findings', {
			expectedRule: rule,
			observedRules: checks.scaffold.rules,
		});
	}
	const genericAnchorFamily = buildAnchorFamily(scaffoldAssembly);
	checks.genericLayoutCandidates = {
		mode: genericAnchorFamily.policyStats?.mode || null,
		availableCandidates: genericAnchorFamily.candidates.length,
		anchorVariants: genericAnchorFamily.policyStats?.anchorVariants || 0,
	};
	assertFinding(
		findings,
		genericAnchorFamily.policyStats?.mode === 'generic-anchor-variants' && genericAnchorFamily.candidates.length >= 10,
		'WS10-generic-layout-variants',
		'layout planner must support enough generic anchorVariants for new project scaffolds instead of only AIHWDEBUGER-specific coordinate fields',
		checks.genericLayoutCandidates,
	);

	mkdirSync(GENERIC_RULE_DIR, { recursive: true });
	const genericContract = {
		schemaVersion: 1,
		projectId: 'workflow-smoke-generic-rules',
		status: 'test',
		intent: 'Generic project rule coverage smoke.',
		agentWorkflow: {
			freeDrawAllowed: false,
			authoritativeEditPath: 'project contract -> deterministic cells -> gates -> gated write-back',
			requiredEntrypoints: ['accept', 'accept:live', 'apply:gated'],
		},
		modules: [{
			id: 'sensor_frontend',
			title: 'Sensor Frontend',
			requiredParts: ['U99', 'R99'],
			requiredNets: ['SENSE_OUT', 'GND'],
			visualEvidence: 'sensor-frontend',
			drawingRules: ['orthogonal-wiring', 'real-net-labels'],
		}],
		interfaces: [],
		visualEvidenceRegions: ['global-sheet', 'sensor-frontend', 'title-template'],
		qualityPolicy: {
			severityMustBeZero: true,
			drcErrors: 0,
			drcWarnings: 0,
			drcInfo: 0,
			singleSheetNoNetPortsByDefault: true,
			fakeTextNetLabelsAllowed: false,
			wireNameLeftAlignMode: 6,
			wireNameRightAlignMode: 8,
		},
	};
	const genericAssembly = {
		schemaVersion: 1,
		projectId: genericContract.projectId,
		circuitPack: 'aihwdebugger',
		cellManifest: '_tmp_workflow_smoke/generic_rule_project/cell_manifest.json',
		anchors: { sensor_frontend: { x: 300, y: 600 } },
		layoutPolicy: {
			candidateSource: 'project_assembly.layoutPolicy',
			flow: 'left-to-right generic smoke',
			columns: [{ id: 'input', modules: ['sensor_frontend'] }],
			baseAnchors: { sensor_frontend: { x: 300, y: 600 } },
			anchorVariants: [{ id: 'shift', anchors: { sensor_frontend: { dx: 40, dy: 0 } } }],
		},
		modules: [{
			id: 'sensor_frontend',
			order: 10,
			registryModule: 'sensor_frontend',
			cell: 'genericSensorCell',
			anchor: 'sensor_frontend',
			refs: { U: 'U99', R: 'R99' },
			netArgs: {},
			nets: ['SENSE_OUT', 'GND'],
		}],
	};
	const genericManifest = {
		schemaVersion: 1,
		packId: 'aihwdebugger',
		cells: [{
			id: 'genericSensorCell',
			moduleType: 'sensor_frontend',
			refs: ['U', 'R'],
			netArgs: [],
			ports: ['SENSE_OUT', 'GND'],
			layoutIntent: 'generic project rule smoke cell',
			qualityRules: ['orthogonal-wiring', 'real-net-labels'],
		}],
	};
	writeFileSync(`${GENERIC_RULE_DIR}/project_contract.json`, JSON.stringify(genericContract, null, 2) + '\n', 'utf8');
	writeFileSync(`${GENERIC_RULE_DIR}/project_assembly.json`, JSON.stringify(genericAssembly, null, 2) + '\n', 'utf8');
	writeFileSync(`${GENERIC_RULE_DIR}/cell_manifest.json`, JSON.stringify(genericManifest, null, 2) + '\n', 'utf8');
	const genericRuleGate = spawnSync(process.execPath, ['engine/project_rule_gate.mjs'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_CONTRACT: `${GENERIC_RULE_DIR}/project_contract.json`,
			EASYEDA_PROJECT_ASSEMBLY: `${GENERIC_RULE_DIR}/project_assembly.json`,
			EASYEDA_PROJECT_RULE_REPORT: `${GENERIC_RULE_DIR}/project_rule_report.json`,
		},
		encoding: 'utf8',
	});
	const genericRuleReport = existsSync(`${GENERIC_RULE_DIR}/project_rule_report.json`) ? readJson(`${GENERIC_RULE_DIR}/project_rule_report.json`) : null;
	checks.genericProjectRules = {
		status: genericRuleGate.status,
		pass: genericRuleReport?.pass ?? null,
		rules: (genericRuleReport?.findings || []).map(f => f.rule),
	};
	assertFinding(
		findings,
		genericRuleGate.status === 0 && genericRuleReport?.pass === true,
		'WS21-project-rules-use-project-contract',
		'project rule gate must accept non-AIHWDEBUGER module ids when contract, assembly refs/nets, and selected cell manifest qualityRules cover the project',
		{
			status: genericRuleGate.status,
			stdout: genericRuleGate.stdout,
			stderr: genericRuleGate.stderr,
			report: checks.genericProjectRules,
		},
	);

	const customPackReport = writePackScaffold({ root: ROOT, packId: CUSTOM_PACK });
	const customSpec = buildMinimalSpec(CUSTOM_PACK);
	const customDir = `${TMP_DIR}/custom_project`;
	const customScaffold = writeScaffold({ outDir: customDir, spec: customSpec, pack: CUSTOM_PACK });
	const customPlan = buildGsdPlan({
		spec: readJson(`${customDir}/project_spec.json`),
		contract: readJson(`${customDir}/project_contract.json`),
		netlist: readJson(`${customDir}/project_netlist.json`),
		assembly: readJson(`${customDir}/project_assembly.json`),
		libraryManifest: readJson(`${customDir}/approved_library_manifest.json`),
		model: null,
		specPath: '_tmp_workflow_smoke/custom_project/project_spec.json',
	});
	checks.customPackScaffold = {
		packFiles: customPackReport.files,
		projectScaffoldPass: customScaffold.pass,
		planPass: customPlan.pass,
		rules: (customPlan.findings || []).map(f => f.rule),
	};
	const customPlanCli = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'plan', '_tmp_workflow_smoke/custom_project/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token },
		encoding: 'utf8',
	});
	const customPlanCliReport = existsSync(`${ROOT}/gsd_plan_report.json`) ? readJson(`${ROOT}/gsd_plan_report.json`) : null;
	checks.customPackCliPlan = {
		status: customPlanCli.status,
		pass: customPlanCliReport?.pass ?? null,
		rules: (customPlanCliReport?.findings || []).map(f => f.rule),
	};
	const applyContextReportPath = `${TMP_DIR}/apply_context_report.json`;
	const customApplyContext = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'apply', '--gated', '--context-only', '_tmp_workflow_smoke/custom_project/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_GSD_LOCK_TOKEN: LOCK.token,
			EASYEDA_APPLY_CONTEXT_ONLY: '1',
			EASYEDA_APPLY_REPORT: applyContextReportPath,
		},
		encoding: 'utf8',
	});
	const customApplyContextReport = existsSync(applyContextReportPath) ? readJson(applyContextReportPath) : null;
	checks.customApplyContext = {
		status: customApplyContext.status,
		pass: customApplyContextReport?.pass ?? null,
		mode: customApplyContextReport?.mode || null,
		spec: customApplyContextReport?.context?.spec || null,
		assemblyPath: customApplyContextReport?.context?.assemblyPath || null,
	};
	assertFinding(findings, existsSync(`${CUSTOM_PACK_DIR}/pack.mjs`) && existsSync(`${CUSTOM_PACK_DIR}/cell_manifest.json`), 'WS11-custom-pack-files', 'init workflow must be able to create a custom circuit pack scaffold', {
		packDir: CUSTOM_PACK_DIR,
	});
	assertFinding(findings, customPlan.pass === false, 'WS12-custom-pack-scaffold-not-ready', 'custom pack scaffold must fail plan until contract, library, and executable cells are implemented', {
		severity: customPlan.severity,
		firstFinding: customPlan.findings?.[0] || null,
	});
	assertFinding(findings, hasRule(customPlan, 'GP-LC3-approved-parts') && hasRule(customPlan, 'GP8-assembly-executable-module'), 'WS13-custom-pack-fails-explicitly', 'custom pack scaffold must fail with explicit library and executable assembly findings', {
		observedRules: checks.customPackScaffold.rules,
	});
	assertFinding(findings, (customPlanCliReport?.findings || []).some(f => f.rule === 'GP14-pack-implemented'), 'WS17-custom-pack-scaffold-only-rejected', 'custom pack scaffold must be rejected explicitly until pack.mjs is implemented beyond scaffoldOnly on the real CLI path', {
		observedRules: checks.customPackCliPlan.rules,
		status: customPlanCli.status,
	});
	assertFinding(
		findings,
		customApplyContext.status === 0
			&& customApplyContextReport?.mode === 'context-only'
			&& customApplyContextReport?.context?.assemblyPath === `${TMP_DIR}/custom_project/project_assembly.json`,
		'WS18-apply-context-bound',
		'CLI apply --gated must pass the selected spec context into the fail-closed apply gate instead of falling back to root project_assembly.json',
		{
			status: customApplyContext.status,
			stdout: customApplyContext.stdout,
			stderr: customApplyContext.stderr,
			report: checks.customApplyContext,
			expectedAssemblyPath: `${TMP_DIR}/custom_project/project_assembly.json`,
		},
	);
	const customFinalEvidenceReportPath = `${TMP_DIR}/custom_final_evidence_report.json`;
	const customFinalEvidence = spawnSync(process.execPath, ['engine/final_evidence_gate.mjs', '_tmp_workflow_smoke/custom_project/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_GSD_LOCK_TOKEN: LOCK.token,
			EASYEDA_FINAL_EVIDENCE_REPORT: customFinalEvidenceReportPath,
		},
		encoding: 'utf8',
	});
	const customFinalEvidenceReport = existsSync(customFinalEvidenceReportPath) ? readJson(customFinalEvidenceReportPath) : null;
	checks.customFinalEvidenceContext = {
		status: customFinalEvidence.status,
		pass: customFinalEvidenceReport?.pass ?? null,
		rules: (customFinalEvidenceReport?.findings || []).map(f => f.rule),
		contextProjectId: customFinalEvidenceReport?.context?.projectId || null,
	};
	assertFinding(
		findings,
		customFinalEvidence.status !== 0
			&& (customFinalEvidenceReport?.findings || []).some(f => f.rule === 'FE6-project-context-match' || f.rule === 'FE7-plan-spec-context-match' || f.rule === 'FE9-acceptance-context-match'),
		'WS19-final-evidence-context-bound',
		'final evidence gate must reject stale root-project PASS reports when invoked for a different project spec',
		{
			status: customFinalEvidence.status,
			stdout: customFinalEvidence.stdout,
			stderr: customFinalEvidence.stderr,
			report: checks.customFinalEvidenceContext,
		},
	);
	const repairContextDir = `${TMP_DIR}/repair_context`;
	mkdirSync(repairContextDir, { recursive: true });
	writeFileSync(`${repairContextDir}/acceptance_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		mode: 'local-only',
		context: {
			spec: '_tmp_workflow_smoke/custom_project/project_spec.json',
			specAbs: `${TMP_DIR}/custom_project/project_spec.json`,
			contractPath: `${TMP_DIR}/custom_project/project_contract.json`,
			netlistPath: `${TMP_DIR}/custom_project/project_netlist.json`,
			assemblyPath: `${TMP_DIR}/custom_project/project_assembly.json`,
			libraryManifestPath: `${TMP_DIR}/custom_project/approved_library_manifest.json`,
		},
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'ACCEPT-context-smoke', severity: 'hard', msg: 'external spec context smoke' }],
	}, null, 2), 'utf8');
	writeFileSync(`${repairContextDir}/final_evidence_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		mode: 'local-only',
		context: { spec: '_tmp_workflow_smoke/custom_project/project_spec.json', projectId: 'workflow_smoke_pack-project' },
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'FE9-acceptance-context-match', severity: 'hard', msg: 'external spec context smoke' }],
	}, null, 2), 'utf8');
	const customRepairActions = spawnSync(process.execPath, [`${ROOT}/engine/repair_actions.mjs`], {
		cwd: repairContextDir,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_WORKDIR: repairContextDir,
			EASYEDA_REPAIR_ACTIONS: `${repairContextDir}/repair_actions.json`,
		},
		encoding: 'utf8',
	});
	const customRepairReport = existsSync(`${repairContextDir}/repair_actions.json`) ? readJson(`${repairContextDir}/repair_actions.json`) : null;
	const customRepairCommands = (customRepairReport?.actions || []).map(a => a.nextCommand);
	checks.customRepairContext = {
		status: customRepairActions.status,
		actionCount: customRepairReport?.actionCount ?? null,
		commands: customRepairCommands,
	};
	assertFinding(
		findings,
		customRepairActions.status !== 0
			&& customRepairCommands.length > 0
			&& customRepairCommands.every(cmd => cmd === 'node bin/easyeda-gsd.mjs accept _tmp_workflow_smoke/custom_project/project_spec.json'),
		'WS20-repair-actions-context-bound',
		'repair actions for an external spec must rerun the context-aware GSD entrypoint instead of bare npm scripts that fall back to the root project',
		{
			status: customRepairActions.status,
			stdout: customRepairActions.stdout,
			stderr: customRepairActions.stderr,
			report: checks.customRepairContext,
		},
	);

	const restoreGenerate = runGsdGenerate({ root: ROOT, specPath: 'project_spec.json', command: ['engine/pipeline_fast.mjs'], draft: true });
	checks.restoreGenerate = {
		pass: restoreGenerate.status === 0,
		stage: restoreGenerate.report?.stage || null,
		assemblyPath: restoreGenerate.report?.generationContext?.assemblyPath || null,
	};
	assertFinding(findings, restoreGenerate.status === 0, 'WS10-restore-generate-pass', 'workflow smoke must restore normal GSD generate reports after negative checks', {
		status: restoreGenerate.status,
		stage: restoreGenerate.report?.stage || null,
		firstFinding: restoreGenerate.report?.findings?.[0] || null,
	});
	assertFinding(
		findings,
		restoreGenerate.report?.generationContext?.assemblyPath === `${ROOT}/project_assembly.json`,
		'WS14-generate-context-bound',
		'GSD generate must record and pass the active project assembly path into deterministic generation',
		checks.restoreGenerate,
	);

	const fullGenerate = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'generate', 'project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token },
		encoding: 'utf8',
	});
	const fullGenerateReport = existsSync(`${ROOT}/gsd_generate_report.json`) ? readJson(`${ROOT}/gsd_generate_report.json`) : null;
	checks.fullGenerateLayoutEvidence = {
		status: fullGenerate.status,
		pass: fullGenerateReport?.pass ?? null,
		draft: fullGenerateReport?.draft ?? null,
		layoutPlanner: fullGenerateReport?.template?.layoutPlanner ?? null,
		command: fullGenerateReport?.command || null,
	};
	assertFinding(
		findings,
		fullGenerate.status === 0
			&& fullGenerateReport?.pass === true
			&& fullGenerateReport?.draft === false
			&& fullGenerateReport?.template?.layoutPlanner === true,
		'WS23-public-generate-runs-layout-search',
		'public easyeda-gsd generate must produce full layout-search evidence by default; fast generation must be explicit draft mode',
		{
			status: fullGenerate.status,
			stdout: fullGenerate.stdout?.slice(0, 500),
			stderr: fullGenerate.stderr,
			report: checks.fullGenerateLayoutEvidence,
		},
	);

	const blockedConcurrent = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'plan', 'project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: '' },
		encoding: 'utf8',
	});
	checks.concurrentStatefulCommandBlocked = {
		pass: blockedConcurrent.status !== 0,
		status: blockedConcurrent.status,
		stderr: (blockedConcurrent.stderr || '').slice(0, 240),
	};
	assertFinding(
		findings,
		blockedConcurrent.status !== 0 && /already running/.test(blockedConcurrent.stderr || ''),
		'WS15-stateful-run-lock',
		'stateful GSD commands must not run concurrently because they share report artifacts and temporary workflow directories',
		checks.concurrentStatefulCommandBlocked,
	);
} catch (e) {
	hard(findings, 'WS0-unhandled-error', 'workflow smoke gate crashed', { error: e.message, stack: e.stack });
} finally {
	rmSync(TMP_DIR, { recursive: true, force: true });
	rmSync(CUSTOM_PACK_DIR, { recursive: true, force: true });
	try { syncPackRegistry(ROOT); } catch {}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	mode: 'local-only',
	root: resolve(ROOT),
	severity: { hard: findings.length, soft: 0, info: 0 },
	checks,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`workflow smoke ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
