import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGsdPlan } from '../workflows/gsd_plan.mjs';
import { runGsdGenerate } from '../workflows/gsd_generate.mjs';
import { writeScaffold } from '../workflows/gsd_scaffold.mjs';
import { buildMinimalSpec, syncPackRegistry, writePackScaffold } from '../workflows/pack_scaffold.mjs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';
import { buildAnchorFamily } from './layout_planner.mjs';
import { measureProjectColumnRhythm } from './sheet_output_gate.mjs';
import { computeStructureMetricsFromSnapshot } from './structure_metrics.mjs';
import { auditPageComposition } from './page_composition.mjs';
import { inferModuleRegions } from './sheet_renderer.mjs';
import { auditCommercialArchitecture } from './commercial_architecture.mjs';
import { auditSystemIntent } from './system_intent_gate.mjs';
import { autoDesignReview } from './design_score.mjs';
import { auditDocumentStyle, buildDocumentLayer } from '../harness/document_style.mjs';
import { buildModel } from '../harness/model.mjs';
import { runRules } from '../harness/rule_registry.mjs';
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
const BAD_BUILDER_PACK = 'workflow_bad_builder_pack';
const BAD_BUILDER_PACK_DIR = `${ROOT}/circuit_packs/${BAD_BUILDER_PACK}`;
const NO_WRITER_PACK = 'workflow_no_writer_pack';
const NO_WRITER_PACK_DIR = `${ROOT}/circuit_packs/${NO_WRITER_PACK}`;

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

function buildPlanForFiles({ spec, contract, netlist, assembly, libraryManifest, specPath, assemblyPath = '' }) {
	const modelPath = `${ROOT}/full_model.json`;
	const model = existsSync(modelPath) ? readJson(modelPath) : null;
	const partLibPath = `${ROOT}/snap2.json`;
	const partLibSnapshot = existsSync(partLibPath) ? readJson(partLibPath) : null;
	return buildGsdPlan({ spec, contract, netlist, assembly, libraryManifest, partLibSnapshot, model, specPath, assemblyPath, partLibPath });
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
	const applyGatedSource = readFileSync(`${ROOT}/engine/apply_gated.mjs`, 'utf8');

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
	checks.applyGatedUsesSelectedWriter = {
		hasResolver: /resolveApplyWriter/.test(applyGatedSource),
		hasWriterGenerateCall: /runApplyWriterGenerate\(\)/.test(applyGatedSource),
		hasWriterRunCall: /runApplyWriterRun\(\)/.test(applyGatedSource),
		hardcodedApplyFullExec: /execSync\(['"`]node engine\/apply_full\.mjs/.test(applyGatedSource),
		hardcodedApplyRunArgs: /\['"`]engine\/apply_run\.mjs['"`], ['"`]--force['"`]/.test(applyGatedSource),
	};
	assertFinding(
		findings,
		checks.applyGatedUsesSelectedWriter.hasResolver
			&& checks.applyGatedUsesSelectedWriter.hasWriterGenerateCall
			&& checks.applyGatedUsesSelectedWriter.hasWriterRunCall
			&& !checks.applyGatedUsesSelectedWriter.hardcodedApplyFullExec
			&& !checks.applyGatedUsesSelectedWriter.hardcodedApplyRunArgs,
		'WS54-apply-gated-uses-selected-pack-writer',
		'apply:gated must execute the selected circuit pack writer entrypoints instead of hardcoding the bundled AIHWDEBUGER writer',
		checks.applyGatedUsesSelectedWriter,
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

	const duplicatePartContract = clone(contract);
	if (duplicatePartContract.modules?.[0] && duplicatePartContract.modules?.[1]) {
		const firstPart = duplicatePartContract.modules[0].requiredParts?.[0];
		duplicatePartContract.modules[1].requiredParts = [...(duplicatePartContract.modules[1].requiredParts || []), firstPart];
	}
	const duplicatePartPlan = buildPlanForFiles({
		spec,
		contract: duplicatePartContract,
		netlist,
		assembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/duplicate_required_part_project_spec.json',
	});
	checks.contractPartsOwnedOnce = {
		pass: !duplicatePartPlan.pass && hasRule(duplicatePartPlan, 'PC28-required-part-owned-once'),
		rules: (duplicatePartPlan.findings || []).map(f => f.rule),
		firstFinding: duplicatePartPlan.findings?.[0] || null,
	};
	assertFinding(findings, checks.contractPartsOwnedOnce.pass, 'WS35-contract-required-parts-owned-once', 'GSD plan must reject project contracts that assign the same physical designator to more than one module', {
		observedRules: checks.contractPartsOwnedOnce.rules,
		firstFinding: checks.contractPartsOwnedOnce.firstFinding,
	});

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

	const missingColumnCoverageAssembly = clone(assembly);
	missingColumnCoverageAssembly.layoutPolicy.columns = clone(assembly.layoutPolicy.columns).map((column, index) => index === 0
		? { ...column, modules: [] }
		: column);
	const missingColumnCoveragePlan = buildPlanForFiles({
		spec,
		contract,
		netlist,
		assembly: missingColumnCoverageAssembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/missing_column_coverage_project_spec.json',
	});
	checks.layoutColumnsCoverModules = {
		pass: !missingColumnCoveragePlan.pass && hasRule(missingColumnCoveragePlan, 'GP23-layout-column-covers-modules'),
		rules: (missingColumnCoveragePlan.findings || []).map(f => f.rule),
	};
	assertFinding(findings, checks.layoutColumnsCoverModules.pass, 'WS33-layout-columns-cover-modules', 'GSD plan must reject layout policies whose columns do not cover every assembly module before generation', {
		observedRules: checks.layoutColumnsCoverModules.rules,
	});

	const reversedColumnsAssembly = clone(assembly);
	reversedColumnsAssembly.layoutPolicy.columns = clone(assembly.layoutPolicy.columns).reverse();
	const reversedColumnsPlan = buildPlanForFiles({
		spec,
		contract,
		netlist,
		assembly: reversedColumnsAssembly,
		libraryManifest,
		specPath: '_tmp_workflow_smoke/reversed_columns_project_spec.json',
	});
	checks.layoutColumnsFollowAnchorOrder = {
		pass: !reversedColumnsPlan.pass && hasRule(reversedColumnsPlan, 'GP25-layout-column-x-order'),
		rules: (reversedColumnsPlan.findings || []).map(f => f.rule),
		firstFinding: reversedColumnsPlan.findings?.[0] || null,
	};
	assertFinding(findings, checks.layoutColumnsFollowAnchorOrder.pass, 'WS34-layout-columns-follow-anchor-order', 'GSD plan must reject layout policies whose declared reading-flow columns contradict module anchor X order', {
		observedRules: checks.layoutColumnsFollowAnchorOrder.rules,
		firstFinding: checks.layoutColumnsFollowAnchorOrder.firstFinding,
	});

	const duplicateRefAssembly = clone(assembly);
	if (duplicateRefAssembly.modules?.[0] && duplicateRefAssembly.modules?.[1]) {
		const firstRef = Object.values(duplicateRefAssembly.modules[0].refs || {})[0];
		const firstRole = Object.keys(duplicateRefAssembly.modules[1].refs || {})[0];
		if (firstRef && firstRole) duplicateRefAssembly.modules[1].refs[firstRole] = firstRef;
	}
	writeFileSync(`${TMP_DIR}/duplicate_ref_assembly.json`, JSON.stringify(duplicateRefAssembly, null, 2) + '\n', 'utf8');
	const duplicateRefGate = spawnSync(process.execPath, ['engine/project_assembly_gate.mjs'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_ASSEMBLY: `${TMP_DIR}/duplicate_ref_assembly.json`,
			EASYEDA_PROJECT_ASSEMBLY_REPORT: `${TMP_DIR}/duplicate_ref_assembly_report.json`,
		},
		encoding: 'utf8',
	});
	const duplicateRefReport = existsSync(`${TMP_DIR}/duplicate_ref_assembly_report.json`) ? readJson(`${TMP_DIR}/duplicate_ref_assembly_report.json`) : null;
	checks.assemblyRefsOwnedOnce = {
		status: duplicateRefGate.status,
		pass: duplicateRefReport?.pass ?? null,
		rules: (duplicateRefReport?.findings || []).map(f => f.rule),
		firstFinding: duplicateRefReport?.findings?.[0] || null,
	};
	assertFinding(findings, duplicateRefGate.status !== 0 && (duplicateRefReport?.findings || []).some(f => f.rule === 'PA21-ref-owned-once'), 'WS36-assembly-refs-owned-once', 'project assembly gate must reject refs that map the same physical designator into more than one module', {
		report: checks.assemblyRefsOwnedOnce,
	});

	const externalStructureAssemblyPath = `${TMP_DIR}/external_structure_assembly.json`;
	writeFileSync(externalStructureAssemblyPath, JSON.stringify({
		projectId: 'workflow-smoke-external-structure',
		modules: [{
			id: 'sensor_frontend',
			registryModule: 'sensor_frontend',
			refs: { U: 'U99', R: 'R99' },
		}],
		layoutPolicy: {
			columns: [{ id: 'input', modules: ['sensor_frontend'] }],
		},
	}, null, 2) + '\n', 'utf8');
	const oldProjectAssembly = process.env.EASYEDA_PROJECT_ASSEMBLY;
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	const externalStructure = computeStructureMetricsFromSnapshot({
		project: 'workflow-smoke-external-structure',
		components: [
			{ designator: 'U99', bbox: { minX: 100, minY: 100, maxX: 140, maxY: 140 }, pins: [] },
			{ designator: 'R99', bbox: { minX: 170, minY: 105, maxX: 190, maxY: 135 }, pins: [] },
		],
		wires: [],
		netflags: [],
	});
	if (oldProjectAssembly === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssembly;
	checks.structureUsesProjectAssemblyModules = {
		source: externalStructure.moduleRegistry?.source || null,
		modules: externalStructure.moduleRegistry?.modules ?? null,
		moduleNames: (externalStructure.modules || []).map(mod => mod.name),
	};
	assertFinding(
		findings,
		checks.structureUsesProjectAssemblyModules.source === externalStructureAssemblyPath
			&& checks.structureUsesProjectAssemblyModules.modules === 1
			&& checks.structureUsesProjectAssemblyModules.moduleNames.includes('sensor_frontend'),
		'WS37-structure-uses-project-assembly-modules',
		'structure metrics must derive module regions from the active project_assembly.json instead of the bundled AIHWDEBUGER module registry',
		checks.structureUsesProjectAssemblyModules,
	);

	const oldProjectAssemblyForVisual = process.env.EASYEDA_PROJECT_ASSEMBLY;
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	const externalVisualSnap = {
		project: 'workflow-smoke-external-visual',
		components: [
			{ designator: 'U99', bbox: { minX: 100, minY: 100, maxX: 140, maxY: 140 }, pins: [] },
			{ designator: 'R99', bbox: { minX: 170, minY: 105, maxX: 190, maxY: 135 }, pins: [] },
		],
		wires: [],
		netflags: [],
	};
	const externalPage = auditPageComposition(externalVisualSnap);
	const externalRegions = inferModuleRegions(externalVisualSnap);
	if (oldProjectAssemblyForVisual === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssemblyForVisual;
	checks.visualUsesProjectAssemblyModules = {
		pageRegistry: externalPage.moduleRegistry || null,
		pageModules: externalPage.metrics?.moduleBoxes?.map(mod => mod.name) || [],
		regionNames: externalRegions.map(region => region.name),
	};
	assertFinding(
		findings,
		checks.visualUsesProjectAssemblyModules.pageRegistry?.source === externalStructureAssemblyPath
			&& checks.visualUsesProjectAssemblyModules.pageModules.length === 1
			&& checks.visualUsesProjectAssemblyModules.pageModules.includes('sensor_frontend')
			&& checks.visualUsesProjectAssemblyModules.regionNames.length === 1
			&& checks.visualUsesProjectAssemblyModules.regionNames.includes('sensor_frontend'),
		'WS38-visual-uses-project-assembly-modules',
		'page composition and sheet module regions must derive visual evidence regions from active project_assembly.json instead of the bundled AIHWDEBUGER module registry',
		checks.visualUsesProjectAssemblyModules,
	);

	const oldProjectAssemblyForIntent = process.env.EASYEDA_PROJECT_ASSEMBLY;
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	const externalIntentSnap = {
		...externalVisualSnap,
		texts: [{ role: 'module-title', module: 'sensor_frontend', content: 'SENSOR FRONTEND' }],
	};
	const externalArchitecture = auditCommercialArchitecture(externalIntentSnap);
	const externalIntent = auditSystemIntent(externalIntentSnap);
	if (oldProjectAssemblyForIntent === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssemblyForIntent;
	checks.genericIntentUsesProjectAssemblyModules = {
		architecture: {
			pass: externalArchitecture.pass,
			mode: externalArchitecture.stats?.moduleRegistry?.mode || null,
			modules: externalArchitecture.stats?.moduleRegistry?.modules ?? null,
			hard: externalArchitecture.severity?.hard ?? null,
			firstFinding: externalArchitecture.findings?.[0] || null,
		},
		systemIntent: {
			pass: externalIntent.pass,
			mode: externalIntent.stats?.moduleRegistry?.mode || null,
			modules: externalIntent.stats?.moduleRegistry?.modules ?? null,
			hard: externalIntent.severity?.hard ?? null,
			firstFinding: externalIntent.findings?.[0] || null,
		},
	};
	assertFinding(
		findings,
		checks.genericIntentUsesProjectAssemblyModules.architecture.pass === true
			&& checks.genericIntentUsesProjectAssemblyModules.architecture.mode === 'generic-project-rules'
			&& checks.genericIntentUsesProjectAssemblyModules.architecture.modules === 1
			&& checks.genericIntentUsesProjectAssemblyModules.systemIntent.pass === true
			&& checks.genericIntentUsesProjectAssemblyModules.systemIntent.mode === 'generic-project-rules'
			&& checks.genericIntentUsesProjectAssemblyModules.systemIntent.modules === 1,
		'WS39-generic-intent-uses-project-assembly-modules',
		'commercial architecture and system intent audits must use generic project rules for non-AIHWDEBUGER assemblies instead of fixed USB/ESP32/relay assumptions',
		checks.genericIntentUsesProjectAssemblyModules,
	);

	const oldProjectAssemblyForDocumentStyle = process.env.EASYEDA_PROJECT_ASSEMBLY;
	const oldProjectContractForDocumentStyle = process.env.EASYEDA_PROJECT_CONTRACT;
	const externalDocumentContractPath = `${TMP_DIR}/external_document_contract.json`;
	writeFileSync(externalDocumentContractPath, JSON.stringify({
		projectId: 'workflow-smoke-external-structure',
		modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', visualEvidence: 'sensor-frontend' }],
		visualEvidenceRegions: ['global-sheet', 'sensor-frontend', 'title-template'],
	}, null, 2) + '\n', 'utf8');
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	process.env.EASYEDA_PROJECT_CONTRACT = externalDocumentContractPath;
	const externalDocumentLayer = buildDocumentLayer(externalVisualSnap);
	const externalDocumentStyle = auditDocumentStyle({
		...externalVisualSnap,
		...externalDocumentLayer,
	});
	if (oldProjectAssemblyForDocumentStyle === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssemblyForDocumentStyle;
	if (oldProjectContractForDocumentStyle === undefined) delete process.env.EASYEDA_PROJECT_CONTRACT;
	else process.env.EASYEDA_PROJECT_CONTRACT = oldProjectContractForDocumentStyle;
	checks.documentStyleUsesProjectAssemblyModules = {
		pass: externalDocumentStyle.pass,
		source: externalDocumentStyle.stats?.moduleRegistry?.source || null,
		modules: externalDocumentStyle.stats?.moduleRegistry?.modules ?? null,
		moduleTitles: externalDocumentStyle.stats?.moduleTitles ?? null,
		hard: externalDocumentStyle.severity?.hard ?? null,
		firstFinding: externalDocumentStyle.findings?.[0] || null,
	};
	assertFinding(
		findings,
		checks.documentStyleUsesProjectAssemblyModules.pass === true
			&& checks.documentStyleUsesProjectAssemblyModules.source === externalStructureAssemblyPath
			&& checks.documentStyleUsesProjectAssemblyModules.modules === 1,
		'WS40-document-style-uses-project-assembly-modules',
		'document style generation and audit must use project assembly and contract titles for non-AIHWDEBUGER modules instead of requiring bundled module titles',
		checks.documentStyleUsesProjectAssemblyModules,
	);

	const externalVisualCropSnapPath = `${TMP_DIR}/external_visual_snapshot.json`;
	const externalVisualCropReportPath = `${TMP_DIR}/external_visual_review_report.json`;
	const externalVisualCropOut = `${TMP_DIR}/external_visual_crops/`;
	writeFileSync(externalVisualCropSnapPath, JSON.stringify({
		projectId: 'workflow-smoke-external-structure',
		components: [
			{ designator: 'U99', value: 'IC', bbox: { minX: 100, minY: 100, maxX: 160, maxY: 160 }, pins: [
				{ num: '1', name: 'IN', x: 100, y: 130 },
				{ num: '2', name: 'OUT', x: 160, y: 130 },
			] },
			{ designator: 'R99', value: '10k', bbox: { minX: 210, minY: 115, maxX: 250, maxY: 145 }, pins: [
				{ num: '1', name: '1', x: 210, y: 130 },
				{ num: '2', name: '2', x: 250, y: 130 },
			] },
		],
		wires: [{ id: 'W99', net: 'SENSE_OUT', line: [160, 130, 210, 130] }],
		netflags: [{ net: 'SENSE_OUT', kind: 'sig', x: 250, y: 130, bbox: { minX: 250, minY: 120, maxX: 320, maxY: 138 } }],
		texts: [{ content: 'Schematic1', bbox: { minX: 330, minY: 40, maxX: 430, maxY: 70 } }],
	}, null, 2) + '\n', 'utf8');
	const externalVisualCrop = spawnSync(process.execPath, ['engine/visual_crops.mjs'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_ASSEMBLY: externalStructureAssemblyPath,
			EASYEDA_PROJECT_CONTRACT: externalDocumentContractPath,
			EASYEDA_VISUAL_SNAP: externalVisualCropSnapPath,
			EASYEDA_VISUAL_REPORT: externalVisualCropReportPath,
			EASYEDA_VISUAL_CROPS_OUT: externalVisualCropOut,
		},
		encoding: 'utf8',
	});
	const externalVisualCropReport = existsSync(externalVisualCropReportPath) ? readJson(externalVisualCropReportPath) : null;
	checks.visualCropsUseContractEvidence = {
		status: externalVisualCrop.status,
		pass: externalVisualCropReport?.pass ?? null,
		screenshots: externalVisualCropReport?.screenshots ?? null,
		available: (externalVisualCropReport?.regions || []).map(r => r.evidenceId),
		findings: (externalVisualCropReport?.findings || []).map(f => f.rule),
		stderr: externalVisualCrop.stderr,
	};
	assertFinding(
		findings,
		externalVisualCrop.status === 0
			&& externalVisualCropReport?.pass === true
			&& (externalVisualCropReport?.regions || []).some(r => r.evidenceId === 'sensor-frontend')
			&& !(externalVisualCropReport?.regions || []).some(r => r.evidenceId === 'usb'),
		'WS41-visual-crops-use-contract-evidence',
		'offline visual crops must be generated from the active project contract evidence regions instead of fixed AIHWDEBUGER crop names',
		checks.visualCropsUseContractEvidence,
	);

	const externalLiveRegionsReportPath = `${TMP_DIR}/external_live_regions_report.json`;
	const externalLiveRegions = spawnSync(process.execPath, ['engine/live_shots.mjs', '--regions-only'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_ASSEMBLY: externalStructureAssemblyPath,
			EASYEDA_PROJECT_CONTRACT: externalDocumentContractPath,
			EASYEDA_LIVE_SNAP: externalVisualCropSnapPath,
			EASYEDA_LIVE_SHOTS_REPORT: externalLiveRegionsReportPath,
			EASYEDA_LIVE_SHOTS_OUT: `${TMP_DIR}/external_live_regions/`,
		},
		encoding: 'utf8',
	});
	const externalLiveRegionsReport = existsSync(externalLiveRegionsReportPath) ? readJson(externalLiveRegionsReportPath) : null;
	checks.liveShotsUseContractEvidence = {
		status: externalLiveRegions.status,
		pass: externalLiveRegionsReport?.pass ?? null,
		planned: (externalLiveRegionsReport?.plannedRegions || []).map(r => r.evidenceId || r.name),
		findings: (externalLiveRegionsReport?.findings || []).map(f => f.rule),
		stderr: externalLiveRegions.stderr,
	};
	assertFinding(
		findings,
		externalLiveRegions.status === 0
			&& externalLiveRegionsReport?.pass === true
			&& (externalLiveRegionsReport?.plannedRegions || []).some(r => r.evidenceId === 'sensor-frontend')
			&& !(externalLiveRegionsReport?.plannedRegions || []).some(r => r.name === '01_usb' || r.evidenceId === 'usb'),
		'WS44-live-shots-use-contract-evidence',
		'live EasyEDA shot regions must be planned from the active project contract evidence regions instead of fixed AIHWDEBUGER crop names',
		checks.liveShotsUseContractEvidence,
	);

	const finalLiveEvidenceDir = `${TMP_DIR}/final_live_evidence_project`;
	mkdirSync(finalLiveEvidenceDir, { recursive: true });
	const finalLiveSpec = {
		schemaVersion: 1,
		projectId: 'workflow-smoke-final-live-evidence',
		intent: 'Final live evidence coverage smoke.',
		circuitPack: 'aihwdebugger',
		modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'GND'] }],
		interfaces: [],
	};
	const finalLiveContract = {
		...readJson(externalDocumentContractPath),
		projectId: finalLiveSpec.projectId,
	};
	writeFileSync(`${finalLiveEvidenceDir}/project_spec.json`, JSON.stringify(finalLiveSpec, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/project_contract.json`, JSON.stringify(finalLiveContract, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/project_netlist.json`, JSON.stringify({ schemaVersion: 1, projectId: finalLiveSpec.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'GND', requiredPins: [] }] }, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/project_assembly.json`, JSON.stringify({ ...readJson(externalStructureAssemblyPath), projectId: finalLiveSpec.projectId }, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/approved_library_manifest.json`, JSON.stringify({ purpose: 'final live evidence smoke', parts: {} }, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/project_library_snapshot.json`, JSON.stringify({ project: finalLiveSpec.projectId, components: [] }, null, 2) + '\n', 'utf8');
	writeFileSync(`${finalLiveEvidenceDir}/snap2.json`, JSON.stringify({ project: finalLiveSpec.projectId, components: [] }, null, 2) + '\n', 'utf8');
	const passReport = projectId => ({ generatedAt: new Date().toISOString(), pass: true, projectId, severity: { hard: 0, soft: 0, info: 0 }, findings: [] });
	for (const [name, data] of Object.entries({
		workflow_smoke_report: passReport(finalLiveSpec.projectId),
		gsd_plan_report: { ...passReport(finalLiveSpec.projectId), spec: 'project_spec.json' },
		gsd_generate_report: { ...passReport(finalLiveSpec.projectId), spec: 'project_spec.json' },
		next_actions: { ...passReport(finalLiveSpec.projectId), actions: [] },
		repair_actions: { ...passReport(finalLiveSpec.projectId), actions: [] },
		action_schema_report: passReport(finalLiveSpec.projectId),
		project_contract_report: passReport(finalLiveSpec.projectId),
		project_library_report: passReport(finalLiveSpec.projectId),
		project_netlist_report: passReport(finalLiveSpec.projectId),
		project_layout_report: passReport(finalLiveSpec.projectId),
		project_visual_report: passReport(finalLiveSpec.projectId),
		report: { ...passReport(finalLiveSpec.projectId), coverage: { layoutPlanner: true } },
		acceptance_report: {
			...passReport(finalLiveSpec.projectId),
			context: {
				specAbs: `${finalLiveEvidenceDir}/project_spec.json`,
				contractPath: `${finalLiveEvidenceDir}/project_contract.json`,
				netlistPath: `${finalLiveEvidenceDir}/project_netlist.json`,
				assemblyPath: `${finalLiveEvidenceDir}/project_assembly.json`,
				libraryManifestPath: `${finalLiveEvidenceDir}/approved_library_manifest.json`,
				partLibPath: `${finalLiveEvidenceDir}/snap2.json`,
			},
		},
		project_live_model_report: passReport(finalLiveSpec.projectId),
		drc_report: { ...passReport(finalLiveSpec.projectId), drc: { strictPass: true, errors: 0, warnings: 0, info: 0 } },
		live_shots_report: { ...passReport(finalLiveSpec.projectId), screenshots: 2, fallbackDiagnosticOnly: false, regions: [
			{ region: '00_global_sheet', evidenceId: 'global-sheet', pass: true },
			{ region: '02_title_template', evidenceId: 'title-template', pass: true },
		] },
	})) {
		writeFileSync(`${finalLiveEvidenceDir}/${name}.json`, JSON.stringify(data, null, 2) + '\n', 'utf8');
	}
	writeFileSync(`${finalLiveEvidenceDir}/live_canvas.png`, Buffer.from('89504e470d0a1a0a', 'hex'));
	writeFileSync(`${finalLiveEvidenceDir}/live.json`, '{}\n', 'utf8');
	const finalEvidenceMissingLive = spawnSync(process.execPath, [`${ROOT}/engine/final_evidence_gate.mjs`, '--live', 'project_spec.json'], {
		cwd: finalLiveEvidenceDir,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_FINAL_EVIDENCE_REPORT: `${finalLiveEvidenceDir}/final_evidence_report.json`,
			EASYEDA_EVIDENCE_MAX_AGE_MS: '0',
		},
		encoding: 'utf8',
	});
	const finalEvidenceMissingLiveReport = existsSync(`${finalLiveEvidenceDir}/final_evidence_report.json`) ? readJson(`${finalLiveEvidenceDir}/final_evidence_report.json`) : null;
	checks.finalEvidenceRequiresLiveContractEvidence = {
		status: finalEvidenceMissingLive.status,
		pass: finalEvidenceMissingLiveReport?.pass ?? null,
		rules: (finalEvidenceMissingLiveReport?.findings || []).map(f => f.rule),
		firstFinding: finalEvidenceMissingLiveReport?.findings?.[0] || null,
	};
	assertFinding(
		findings,
		finalEvidenceMissingLive.status !== 0 && hasRule(finalEvidenceMissingLiveReport, 'FE10-live-shot-contract-evidence'),
		'WS45-final-evidence-requires-live-contract-evidence',
		'final live evidence must reject live_shots_report.json when it passes but omits a visual evidence region required by the active project contract',
		checks.finalEvidenceRequiresLiveContractEvidence,
	);

	const oldProjectAssemblyForHarnessRules = process.env.EASYEDA_PROJECT_ASSEMBLY;
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	const externalRuleFindings = runRules(buildModel({
		projectId: 'workflow-smoke-external-structure',
		components: [
			{ designator: 'U99', value: 'IC', bbox: { minX: 100, minY: 100, maxX: 160, maxY: 160 }, pins: [
				{ num: '1', name: 'IN', x: 100, y: 130 },
				{ num: '2', name: 'OUT', x: 160, y: 130 },
			] },
			{ designator: 'R99', value: '10k', bbox: { minX: 210, minY: 115, maxX: 250, maxY: 145 }, pins: [
				{ num: '1', name: '1', x: 210, y: 130 },
				{ num: '2', name: '2', x: 250, y: 130 },
			] },
		],
		wires: [{ id: 'W99', net: 'SENSE_OUT', line: [160, 130, 210, 130] }],
		netflags: [{ net: 'SENSE_OUT', kind: 'sig', x: 250, y: 130, bbox: { minX: 250, minY: 120, maxX: 320, maxY: 138 } }],
	}));
	if (oldProjectAssemblyForHarnessRules === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssemblyForHarnessRules;
	checks.harnessRulesUseProjectAssemblyModules = {
		findings: externalRuleFindings.map(f => f.rule),
		defaultRequiredPartFindings: externalRuleFindings.filter(f => f.rule === 'C10.1-required-part-missing' || f.rule === 'C10.2-unexpected-part').map(f => f.where),
	};
	assertFinding(
		findings,
		checks.harnessRulesUseProjectAssemblyModules.defaultRequiredPartFindings.length === 0,
		'WS42-harness-rules-use-project-assembly-modules',
		'core harness rules must derive required parts and module boxes from active project_assembly.json instead of the bundled AIHWDEBUGER module registry',
		checks.harnessRulesUseProjectAssemblyModules,
	);

	const oldProjectAssemblyForDesignScore = process.env.EASYEDA_PROJECT_ASSEMBLY;
	process.env.EASYEDA_PROJECT_ASSEMBLY = externalStructureAssemblyPath;
	const externalDesignScore = autoDesignReview({
		projectId: 'workflow-smoke-external-structure',
		components: [
			{ designator: 'U99', value: 'IC', bbox: { minX: 100, minY: 100, maxX: 160, maxY: 160 }, pins: [] },
			{ designator: 'R99', value: '10k', bbox: { minX: 210, minY: 115, maxX: 250, maxY: 145 }, pins: [] },
		],
		wires: [],
		netflags: [],
	});
	if (oldProjectAssemblyForDesignScore === undefined) delete process.env.EASYEDA_PROJECT_ASSEMBLY;
	else process.env.EASYEDA_PROJECT_ASSEMBLY = oldProjectAssemblyForDesignScore;
	checks.genericDesignScoreIgnoresBundledStory = {
		pass: externalDesignScore.pass,
		score: externalDesignScore.score,
		mode: externalDesignScore.stats?.moduleRegistry?.mode || null,
		dimensions: externalDesignScore.dimensions.map(d => d.id),
	};
	assertFinding(
		findings,
		checks.genericDesignScoreIgnoresBundledStory.mode === 'generic-project-score'
			&& !checks.genericDesignScoreIgnoresBundledStory.dimensions.includes('system-reading-flow')
			&& !checks.genericDesignScoreIgnoresBundledStory.dimensions.includes('repeated-channel-grammar')
			&& !checks.genericDesignScoreIgnoresBundledStory.dimensions.includes('module-grid-rhythm'),
		'WS43-generic-design-score-ignores-bundled-story',
		'auto design score for external projects must use generic project dimensions instead of USB/MCU/relay reference-story penalties',
		checks.genericDesignScoreIgnoresBundledStory,
	);

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
		'project_library_snapshot.json',
		'gsd_scaffold_report.json',
	];
	const missingScaffoldFiles = scaffoldFiles.filter(name => !existsSync(`${SCAFFOLD_DIR}/${name}`));
	const scaffoldSpec = readJson(`${SCAFFOLD_DIR}/project_spec.json`);
	const scaffoldContract = readJson(`${SCAFFOLD_DIR}/project_contract.json`);
	const scaffoldNetlist = readJson(`${SCAFFOLD_DIR}/project_netlist.json`);
	const scaffoldAssembly = readJson(`${SCAFFOLD_DIR}/project_assembly.json`);
	const scaffoldLibrary = readJson(`${SCAFFOLD_DIR}/approved_library_manifest.json`);
	const scaffoldLibrarySnapshot = readJson(`${SCAFFOLD_DIR}/project_library_snapshot.json`);
	const scaffoldPlan = buildGsdPlan({
		spec: scaffoldSpec,
		contract: scaffoldContract,
		netlist: scaffoldNetlist,
		assembly: scaffoldAssembly,
		libraryManifest: scaffoldLibrary,
		partLibSnapshot: scaffoldLibrarySnapshot,
		model: null,
		specPath: '_tmp_workflow_smoke/scaffold/project_spec.json',
		assemblyPath: `${SCAFFOLD_DIR}/project_assembly.json`,
		partLibPath: `${SCAFFOLD_DIR}/project_library_snapshot.json`,
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
	const unknownDrawingRuleContract = clone(genericContract);
	unknownDrawingRuleContract.modules[0].drawingRules = [
		...unknownDrawingRuleContract.modules[0].drawingRules,
		'pretty-but-not-executable',
	];
	const unknownDrawingRuleManifest = clone(genericManifest);
	unknownDrawingRuleManifest.requiredQualityRules = ['orthogonal-wiring', 'real-net-labels', 'pretty-but-not-executable'];
	unknownDrawingRuleManifest.cells[0].qualityRules = ['orthogonal-wiring', 'real-net-labels', 'pretty-but-not-executable'];
	const unknownDrawingRulePlan = buildGsdPlan({
		spec: {
			schemaVersion: 1,
			projectId: genericContract.projectId,
			intent: 'Unknown drawing rule smoke.',
			circuitPack: 'aihwdebugger',
			modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'GND'] }],
			interfaces: [],
		},
		contract: unknownDrawingRuleContract,
		netlist: { schemaVersion: 1, projectId: genericContract.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'GND', requiredPins: [] }] },
		assembly: genericAssembly,
		libraryManifest: {
			purpose: 'Unknown drawing rule smoke.',
			parts: {
				U99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'U99', value: 'IC', addIntoBom: true, addIntoPcb: true },
				R99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'R99', value: '10k', addIntoBom: true, addIntoPcb: true },
			},
		},
		partLibSnapshot: { project: genericContract.projectId, components: [{ designator: 'U99' }, { designator: 'R99' }] },
		model: null,
		specPath: '_tmp_workflow_smoke/unknown_drawing_rule/project_spec.json',
		assemblyPath: `${GENERIC_RULE_DIR}/project_assembly.json`,
		partLibPath: '_tmp_workflow_smoke/unknown_drawing_rule/project_library_snapshot.json',
	});
	writeFileSync(`${GENERIC_RULE_DIR}/unknown_rule_contract.json`, JSON.stringify(unknownDrawingRuleContract, null, 2) + '\n', 'utf8');
	writeFileSync(`${GENERIC_RULE_DIR}/unknown_rule_manifest.json`, JSON.stringify(unknownDrawingRuleManifest, null, 2) + '\n', 'utf8');
	writeFileSync(`${GENERIC_RULE_DIR}/unknown_rule_assembly.json`, JSON.stringify({
		...genericAssembly,
		cellManifest: '_tmp_workflow_smoke/generic_rule_project/unknown_rule_manifest.json',
	}, null, 2) + '\n', 'utf8');
	const unknownDrawingRuleGate = spawnSync(process.execPath, ['engine/project_rule_gate.mjs'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_PROJECT_CONTRACT: `${GENERIC_RULE_DIR}/unknown_rule_contract.json`,
			EASYEDA_PROJECT_ASSEMBLY: `${GENERIC_RULE_DIR}/unknown_rule_assembly.json`,
			EASYEDA_PROJECT_RULE_REPORT: `${GENERIC_RULE_DIR}/unknown_rule_project_rule_report.json`,
		},
		encoding: 'utf8',
	});
	const unknownDrawingRuleReport = existsSync(`${GENERIC_RULE_DIR}/unknown_rule_project_rule_report.json`)
		? readJson(`${GENERIC_RULE_DIR}/unknown_rule_project_rule_report.json`)
		: null;
	checks.unknownDrawingRulesRejected = {
		planPass: unknownDrawingRulePlan.pass,
		planRules: (unknownDrawingRulePlan.findings || []).map(f => f.rule),
		gateStatus: unknownDrawingRuleGate.status,
		gateRules: (unknownDrawingRuleReport?.findings || []).map(f => f.rule),
	};
	assertFinding(
		findings,
		unknownDrawingRulePlan.pass === false
			&& hasRule(unknownDrawingRulePlan, 'GP-DR1-drawing-rule-known')
			&& unknownDrawingRuleGate.status !== 0
			&& (unknownDrawingRuleReport?.findings || []).some(f => f.rule === 'PR-DR1-drawing-rule-known'),
		'WS47-drawing-rules-bind-to-executable-rules',
		'contract drawingRules and manifest qualityRules must map to executable harness rules instead of passing as unchecked prose strings',
		checks.unknownDrawingRulesRejected,
	);

	const genericColumnRegistry = {
		source: `${GENERIC_RULE_DIR}/project_assembly.json`,
		assembly: {
			projectId: 'workflow-smoke-generic-sheet',
			circuitPack: CUSTOM_PACK,
			layoutPolicy: {
				columns: [
					{ id: 'sensor', modules: ['sensor_frontend'] },
					{ id: 'processor', modules: ['processor_core'] },
					{ id: 'output', modules: ['load_output'] },
				],
			},
		},
		modules: [
			{ id: 'sensor_frontend', name: 'sensor_frontend', refs: ['U99'] },
			{ id: 'processor_core', name: 'processor_core', refs: ['U100'] },
			{ id: 'load_output', name: 'load_output', refs: ['Q99'] },
		],
	};
	const genericSheetRhythm = measureProjectColumnRhythm({
		moduleRegions: [
			{ name: 'sensor_frontend', box: { minX: 100, minY: 100, maxX: 190, maxY: 190 } },
			{ name: 'processor_core', box: { minX: 270, minY: 100, maxX: 360, maxY: 190 } },
			{ name: 'load_output', box: { minX: 445, minY: 100, maxX: 535, maxY: 190 } },
		],
	}, genericColumnRegistry);
	const reversedGenericSheetRhythm = measureProjectColumnRhythm({
		moduleRegions: [
			{ name: 'sensor_frontend', box: { minX: 445, minY: 100, maxX: 535, maxY: 190 } },
			{ name: 'processor_core', box: { minX: 270, minY: 100, maxX: 360, maxY: 190 } },
			{ name: 'load_output', box: { minX: 100, minY: 100, maxX: 190, maxY: 190 } },
		],
	}, genericColumnRegistry);
	checks.genericSheetOutputColumns = {
		mode: genericSheetRhythm?.mode || null,
		source: genericSheetRhythm?.source || null,
		modules: genericSheetRhythm?.modules || [],
		reversedPairs: genericSheetRhythm?.reversedPairs || [],
		reversedFailurePairs: reversedGenericSheetRhythm?.reversedPairs || [],
		usesBundledNames: (genericSheetRhythm?.modules || []).some(name => ['usb', 'ldo', 'mcu', 'pmos', 'relay1', 'relay2'].includes(name)),
	};
	assertFinding(
		findings,
		genericSheetRhythm?.mode === 'project-columns'
			&& genericSheetRhythm?.missingModules.length === 0
			&& genericSheetRhythm?.unknownColumnModules.length === 0
			&& genericSheetRhythm?.reversedPairs.length === 0
			&& reversedGenericSheetRhythm?.reversedPairs.length > 0
			&& checks.genericSheetOutputColumns.usesBundledNames === false,
		'WS46-sheet-output-uses-project-columns',
		'sheet-output review rhythm for external projects must use project_assembly.json layoutPolicy.columns instead of fixed USB/MCU/relay module names',
		checks.genericSheetOutputColumns,
	);

	const badBuilderPackId = BAD_BUILDER_PACK;
	const badBuilderPackDir = BAD_BUILDER_PACK_DIR;
	mkdirSync(badBuilderPackDir, { recursive: true });
	writeFileSync(`${badBuilderPackDir}/pack.mjs`, `export const fallbackAnchors = {};
export const cellBuilders = {
\tbadCell() {
\t\treturn {
\t\t\tplace: { U99: { x: 100, y: 100, rot: 0, mirror: false } },
\t\t\twires: [{ net: 'UNDECLARED', line: [100, 100, 130, 140] }],
\t\t\tflags: [{ kind: 'sig', content: 'TEXT_ONLY' }],
\t\t};
\t},
};
export function normalizeLibrarySnapshot(snap) { return snap; }
export const pack = { id: '${badBuilderPackId}', fallbackAnchors, cellBuilders, normalizeLibrarySnapshot };
`, 'utf8');
	writeFileSync(`${badBuilderPackDir}/cell_manifest.json`, JSON.stringify({
		schemaVersion: 1,
		packId: badBuilderPackId,
		purpose: 'Bad builder smoke manifest.',
		requiredQualityRules: [
			'orthogonal-wiring',
			'real-net-labels',
			'text-clearance',
			'module-box-isolation',
			'no-fake-net-text',
			'no-unnecessary-net-ports',
		],
		cells: [{
			id: 'badCell',
			moduleType: 'bad_builder_smoke',
			refs: ['U'],
			netArgs: [],
			ports: ['SENSE_OUT', 'GND'],
			layoutIntent: 'deliberately invalid builder output',
			qualityRules: [
				'orthogonal-wiring',
				'real-net-labels',
				'text-clearance',
				'module-box-isolation',
				'no-fake-net-text',
				'no-unnecessary-net-ports',
			],
		}],
	}, null, 2) + '\n', 'utf8');
	syncPackRegistry(ROOT);
	const badBuilderSpec = {
		schemaVersion: 1,
		projectId: 'workflow-bad-builder',
		intent: 'Bad builder contract smoke.',
		circuitPack: badBuilderPackId,
		modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'GND'] }],
		interfaces: [],
	};
	const badBuilderContract = {
		...genericContract,
		projectId: badBuilderSpec.projectId,
		modules: [{
			...genericContract.modules[0],
			requiredParts: ['U99'],
			drawingRules: [
				'orthogonal-wiring',
				'real-net-labels',
				'text-clearance',
				'module-box-isolation',
				'no-fake-net-text',
				'no-unnecessary-net-ports',
			],
		}],
	};
	const badBuilderAssembly = {
		...genericAssembly,
		projectId: badBuilderSpec.projectId,
		circuitPack: badBuilderPackId,
		cellManifest: `../../circuit_packs/${badBuilderPackId}/cell_manifest.json`,
		layoutPolicy: {
			...genericAssembly.layoutPolicy,
			xProfiles: [{ sensorX: 300 }],
		},
		modules: [{
			...genericAssembly.modules[0],
			cell: 'badCell',
			refs: { U: 'U99' },
			nets: ['SENSE_OUT', 'GND'],
		}],
	};
	const badBuilderDir = `${TMP_DIR}/bad_builder`;
	mkdirSync(badBuilderDir, { recursive: true });
	writeFileSync(`${badBuilderDir}/project_spec.json`, JSON.stringify(badBuilderSpec, null, 2) + '\n', 'utf8');
	writeFileSync(`${badBuilderDir}/project_contract.json`, JSON.stringify(badBuilderContract, null, 2) + '\n', 'utf8');
	writeFileSync(`${badBuilderDir}/project_netlist.json`, JSON.stringify({ schemaVersion: 1, projectId: badBuilderSpec.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'GND', requiredPins: [] }] }, null, 2) + '\n', 'utf8');
	writeFileSync(`${badBuilderDir}/project_assembly.json`, JSON.stringify(badBuilderAssembly, null, 2) + '\n', 'utf8');
	writeFileSync(`${badBuilderDir}/approved_library_manifest.json`, JSON.stringify({
		purpose: 'Bad builder contract smoke.',
		parts: { U99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'U99', value: 'IC', addIntoBom: true, addIntoPcb: true } },
	}, null, 2) + '\n', 'utf8');
	writeFileSync(`${badBuilderDir}/project_library_snapshot.json`, JSON.stringify({ project: badBuilderSpec.projectId, components: [{ designator: 'U99', x: 0, y: 0, rotation: 0, mirror: false, bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, pins: [] }] }, null, 2) + '\n', 'utf8');
	const badBuilderPlanCli = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'plan', '_tmp_workflow_smoke/bad_builder/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token },
		encoding: 'utf8',
	});
	const badBuilderPlan = existsSync(`${ROOT}/gsd_plan_report.json`) ? readJson(`${ROOT}/gsd_plan_report.json`) : null;
	checks.badBuilderDryRunRejected = {
		status: badBuilderPlanCli.status,
		pass: badBuilderPlan?.pass ?? null,
		rules: (badBuilderPlan?.findings || []).map(f => f.rule),
		firstFinding: badBuilderPlan?.findings?.[0] || null,
	};
	assertFinding(
		findings,
		badBuilderPlanCli.status !== 0
			&& badBuilderPlan?.pass === false
			&& hasRule(badBuilderPlan, 'CB8-wire-orthogonal')
			&& hasRule(badBuilderPlan, 'CB10-flag-shape')
			&& hasRule(badBuilderPlan, 'CB13-output-nets-declared'),
		'WS48-cell-builder-output-contract',
		'GSD plan must dry-run implemented cell builders and reject non-orthogonal wires, fake labels, or undeclared output nets before generation',
		checks.badBuilderDryRunRejected,
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
		partLibSnapshot: readJson(`${customDir}/project_library_snapshot.json`),
		model: null,
		specPath: '_tmp_workflow_smoke/custom_project/project_spec.json',
		assemblyPath: `${customDir}/project_assembly.json`,
		partLibPath: `${customDir}/project_library_snapshot.json`,
	});
	checks.customPackScaffold = {
		packFiles: customPackReport.files,
		projectScaffoldPass: customScaffold.pass,
		planPass: customPlan.pass,
		rules: (customPlan.findings || []).map(f => f.rule),
		hasApplyWriterTemplate: existsSync(`${CUSTOM_PACK_DIR}/apply_writer.mjs`),
		hasApplyRunTemplate: existsSync(`${CUSTOM_PACK_DIR}/apply_run.mjs`),
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
		modelEvidence: customPlanCliReport?.modelEvidence || null,
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
		applyWriterPass: customApplyContextReport?.applyWriter?.pass ?? null,
		applyWriterRules: (customApplyContextReport?.applyWriter?.findings || []).map(f => f.rule),
	};
	mkdirSync(NO_WRITER_PACK_DIR, { recursive: true });
	writeFileSync(`${NO_WRITER_PACK_DIR}/pack.mjs`, `export const fallbackAnchors = {};
export const cellBuilders = {
\tsensorCell() {
\t\treturn {
\t\t\tplace: { U99: { x: 100, y: 100, rot: 0, mirror: false } },
\t\t\twires: [{ net: 'SENSE_OUT', line: [100, 100, 140, 100] }],
\t\t\tflags: [{ kind: 'sig', net: 'SENSE_OUT', x: 140, y: 100, textX: 140, textY: 100, rot: 0, alignMode: 8 }],
\t\t};
\t},
};
export function normalizeLibrarySnapshot(snap) { return snap; }
export const pack = { id: '${NO_WRITER_PACK}', fallbackAnchors, cellBuilders, normalizeLibrarySnapshot };
`, 'utf8');
	writeFileSync(`${NO_WRITER_PACK_DIR}/cell_manifest.json`, JSON.stringify({
		schemaVersion: 1,
		packId: NO_WRITER_PACK,
		purpose: 'No writer pack smoke manifest.',
		requiredQualityRules: [
			'orthogonal-wiring',
			'real-net-labels',
			'text-clearance',
			'module-box-isolation',
			'no-fake-net-text',
			'no-unnecessary-net-ports',
		],
		cells: [{
			id: 'sensorCell',
			moduleType: 'sensor_frontend',
			refs: ['U'],
			netArgs: [],
			ports: ['SENSE_OUT'],
			layoutIntent: 'valid tiny deterministic sensor cell without apply writer',
			qualityRules: [
				'orthogonal-wiring',
				'real-net-labels',
				'text-clearance',
				'module-box-isolation',
				'no-fake-net-text',
				'no-unnecessary-net-ports',
			],
		}],
	}, null, 2) + '\n', 'utf8');
	syncPackRegistry(ROOT);
	const noWriterDir = `${TMP_DIR}/no_writer_project`;
	mkdirSync(noWriterDir, { recursive: true });
	const noWriterSpec = {
		schemaVersion: 1,
		projectId: 'workflow-no-writer',
		intent: 'No writer apply gate smoke.',
		circuitPack: NO_WRITER_PACK,
		modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT'] }],
		interfaces: [],
	};
	const noWriterContract = {
		...genericContract,
		projectId: noWriterSpec.projectId,
		modules: [{
			...genericContract.modules[0],
			requiredParts: ['U99'],
			requiredNets: ['SENSE_OUT'],
		}],
		qualityPolicy: { ...genericContract.qualityPolicy },
	};
	const noWriterAssembly = {
		...genericAssembly,
		projectId: noWriterSpec.projectId,
		circuitPack: NO_WRITER_PACK,
		cellManifest: `../../circuit_packs/${NO_WRITER_PACK}/cell_manifest.json`,
		layoutPolicy: {
			...genericAssembly.layoutPolicy,
			xProfiles: [{ sensorX: 300 }],
		},
		modules: [{
			...genericAssembly.modules[0],
			cell: 'sensorCell',
			refs: { U: 'U99' },
			nets: ['SENSE_OUT'],
		}],
	};
	writeFileSync(`${noWriterDir}/project_spec.json`, JSON.stringify(noWriterSpec, null, 2) + '\n', 'utf8');
	writeFileSync(`${noWriterDir}/project_contract.json`, JSON.stringify(noWriterContract, null, 2) + '\n', 'utf8');
	writeFileSync(`${noWriterDir}/project_netlist.json`, JSON.stringify({ schemaVersion: 1, projectId: noWriterSpec.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }] }, null, 2) + '\n', 'utf8');
	writeFileSync(`${noWriterDir}/project_assembly.json`, JSON.stringify(noWriterAssembly, null, 2) + '\n', 'utf8');
	writeFileSync(`${noWriterDir}/approved_library_manifest.json`, JSON.stringify({ purpose: 'No writer smoke library.', parts: { U99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'U99', value: 'IC', addIntoBom: true, addIntoPcb: true } } }, null, 2) + '\n', 'utf8');
	writeFileSync(`${noWriterDir}/project_library_snapshot.json`, JSON.stringify({ project: noWriterSpec.projectId, components: [{ designator: 'U99', x: 0, y: 0, rotation: 0, mirror: false, bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, pins: [] }] }, null, 2) + '\n', 'utf8');
	const noWriterApplyReportPath = `${TMP_DIR}/no_writer_apply_report.json`;
	const noWriterApply = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'apply', '--gated', '_tmp_workflow_smoke/no_writer_project/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_GSD_LOCK_TOKEN: LOCK.token,
			EASYEDA_APPLY_REPORT: noWriterApplyReportPath,
		},
		encoding: 'utf8',
	});
	const noWriterApplyReport = existsSync(noWriterApplyReportPath) ? readJson(noWriterApplyReportPath) : null;
	checks.noWriterApplyBlocked = {
		status: noWriterApply.status,
		pass: noWriterApplyReport?.pass ?? null,
		mode: noWriterApplyReport?.mode || null,
		rules: (noWriterApplyReport?.findings || []).map(f => f.rule),
		writerPass: noWriterApplyReport?.applyWriter?.pass ?? null,
	};
	assertFinding(
		findings,
		noWriterApply.status !== 0
			&& noWriterApplyReport?.mode === 'preflight'
			&& noWriterApplyReport?.applyWriter?.pass === false
			&& (noWriterApplyReport?.findings || []).some(f => f.rule === 'AW1-pack-writer-declared'),
		'WS49-external-apply-requires-pack-writer',
		'apply:gated must fail closed for external circuit packs that do not explicitly declare a write-back writer instead of reusing the bundled AIHWDEBUGER writer',
		{
			status: noWriterApply.status,
			stdout: noWriterApply.stdout,
			stderr: noWriterApply.stderr,
			report: checks.noWriterApplyBlocked,
		},
	);
	assertFinding(
		findings,
		existsSync(`${CUSTOM_PACK_DIR}/pack.mjs`)
			&& existsSync(`${CUSTOM_PACK_DIR}/cell_manifest.json`)
			&& existsSync(`${CUSTOM_PACK_DIR}/apply_writer.mjs`)
			&& existsSync(`${CUSTOM_PACK_DIR}/apply_run.mjs`),
		'WS11-custom-pack-files',
		'init workflow must be able to create a custom circuit pack scaffold with deterministic cells and writer entrypoint templates',
		{
		packDir: CUSTOM_PACK_DIR,
		},
	);
	assertFinding(
		findings,
		checks.customPackScaffold.hasApplyWriterTemplate
			&& checks.customPackScaffold.hasApplyRunTemplate,
		'WS52-pack-scaffold-includes-writer-template',
		'custom circuit pack scaffold must include apply writer templates so agents know where external EasyEDA write-back must be implemented',
		checks.customPackScaffold,
	);
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
		customPlanCliReport?.modelEvidence?.path === `${customDir}/full_model.json`
			&& customPlanCliReport?.modelEvidence?.used === false
			&& customPlanCliReport?.modelEvidence?.skippedReason === 'missing',
		'WS31-external-spec-model-evidence-is-local',
		'external project plans must not use the repository root full_model.json as model evidence; only a full_model.json beside the active spec may be used',
		{
			expectedModelPath: `${customDir}/full_model.json`,
			report: checks.customPackCliPlan,
		},
	);

	const completeGenericContract = clone(genericContract);
	if (completeGenericContract.modules?.[0]) {
		completeGenericContract.modules[0].drawingRules = [
			'orthogonal-wiring',
			'real-net-labels',
			'text-clearance',
			'module-box-isolation',
			'no-fake-net-text',
			'no-unnecessary-net-ports',
		];
	}
	const missingPartSnapshotPlan = buildGsdPlan({
		spec: {
			schemaVersion: 1,
			projectId: genericContract.projectId,
			intent: 'Part library snapshot coverage smoke.',
			circuitPack: 'aihwdebugger',
			modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'GND'] }],
			interfaces: [],
		},
		contract: completeGenericContract,
		netlist: { schemaVersion: 1, projectId: genericContract.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'GND', requiredPins: [] }] },
		assembly: {
			...genericAssembly,
			modules: [{ ...genericAssembly.modules[0], cell: 'usbCell' }],
			layoutPolicy: {
				...genericAssembly.layoutPolicy,
				xProfiles: [{ sensorX: 300 }],
			},
		},
		libraryManifest: { purpose: 'Part library snapshot coverage smoke.', parts: { U99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'U99', value: 'IC', addIntoBom: true, addIntoPcb: true }, R99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'R99', value: '10k', addIntoBom: true, addIntoPcb: true } } },
		partLibSnapshot: { project: genericContract.projectId, components: [{ designator: 'U99' }] },
		model: null,
		specPath: '_tmp_workflow_smoke/missing_part_snapshot/project_spec.json',
		assemblyPath: `${GENERIC_RULE_DIR}/project_assembly.json`,
		partLibPath: '_tmp_workflow_smoke/missing_part_snapshot/project_library_snapshot.json',
	});
	checks.partLibrarySnapshotRequiredParts = {
		pass: missingPartSnapshotPlan.pass,
		rules: (missingPartSnapshotPlan.findings || []).map(f => f.rule),
		firstFinding: missingPartSnapshotPlan.findings?.[0] || null,
	};
	assertFinding(
		findings,
		hasRule(missingPartSnapshotPlan, 'GP18-part-lib-required-part'),
		'WS30-part-library-snapshot-covers-required-parts',
		'GSD plan must reject projects whose active library snapshot does not contain every contract requiredPart used for deterministic generation',
		checks.partLibrarySnapshotRequiredParts,
	);

	const portBindingContract = {
		...completeGenericContract,
		modules: [{
			...completeGenericContract.modules[0],
			requiredParts: ['SW99', 'R99'],
			requiredNets: ['SENSE_OUT', 'SYS_3V3', 'GND'],
		}],
	};
	const missingPortBindingPlan = buildGsdPlan({
		spec: {
			schemaVersion: 1,
			projectId: genericContract.projectId,
			intent: 'Cell port binding smoke.',
			circuitPack: 'aihwdebugger',
			modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'SYS_3V3', 'GND'] }],
			interfaces: [],
		},
		contract: portBindingContract,
		netlist: { schemaVersion: 1, projectId: genericContract.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'SYS_3V3', requiredPins: [] }, { name: 'GND', requiredPins: [] }] },
		assembly: {
			...genericAssembly,
			cellManifest: 'circuit_packs/aihwdebugger/cell_manifest.json',
			modules: [{
				...genericAssembly.modules[0],
				cell: 'buttonCell',
				refs: { SW: 'SW99', Rpu: 'R99' },
				netArgs: { SIG: 'SENSE_OUT' },
				nets: ['SENSE_OUT', 'SYS_3V3'],
			}],
			layoutPolicy: {
				...genericAssembly.layoutPolicy,
				xProfiles: [{ sensorX: 300 }],
			},
		},
		libraryManifest: { purpose: 'Cell port binding smoke.', parts: { SW99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'SW99', value: 'SW', addIntoBom: true, addIntoPcb: true }, R99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'R99', value: '10k', addIntoBom: true, addIntoPcb: true } } },
		partLibSnapshot: { project: genericContract.projectId, components: [{ designator: 'SW99' }, { designator: 'R99' }] },
		model: null,
		specPath: '_tmp_workflow_smoke/missing_port_binding/project_spec.json',
		assemblyPath: `${ROOT}/project_assembly.json`,
		partLibPath: '_tmp_workflow_smoke/missing_port_binding/project_library_snapshot.json',
	});
	checks.cellPortsBoundToAssemblyNets = {
		pass: missingPortBindingPlan.pass,
		rules: (missingPortBindingPlan.findings || []).map(f => f.rule),
		firstFinding: missingPortBindingPlan.findings?.[0] || null,
	};
	assertFinding(
		findings,
		hasRule(missingPortBindingPlan, 'GP19-cell-port-bound'),
		'WS32-cell-ports-bound-to-assembly-nets',
		'GSD plan must reject deterministic cell manifests whose declared electrical ports are not bound to concrete assembly nets before generation',
		checks.cellPortsBoundToAssemblyNets,
	);

	const orphanSpecDir = `${TMP_DIR}/orphan_spec`;
	mkdirSync(orphanSpecDir, { recursive: true });
	writeFileSync(`${orphanSpecDir}/project_spec.json`, JSON.stringify(customSpec, null, 2) + '\n', 'utf8');
	const orphanPlanCli = spawnSync(process.execPath, ['bin/easyeda-gsd.mjs', 'plan', '_tmp_workflow_smoke/orphan_spec/project_spec.json'], {
		cwd: ROOT,
		stdio: 'pipe',
		shell: false,
		env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: LOCK.token },
		encoding: 'utf8',
	});
	const orphanPlanReport = existsSync(`${ROOT}/gsd_plan_report.json`) ? readJson(`${ROOT}/gsd_plan_report.json`) : null;
	checks.externalSpecRequiresCompanions = {
		status: orphanPlanCli.status,
		pass: orphanPlanReport?.pass ?? null,
		rules: (orphanPlanReport?.findings || []).map(f => f.rule),
	};
	assertFinding(
		findings,
		orphanPlanCli.status !== 0
			&& ['GP0-project_contract-file', 'GP0-project_netlist-file', 'GP0-project_assembly-file', 'GP0-approved_library_manifest-file', 'GP0-project_library_snapshot-file'].every(rule => hasRule(orphanPlanReport, rule)),
		'WS26-external-spec-requires-companions',
		'external project specs must not fall back to root project contracts; missing companion files must be explicit plan failures',
		{
			status: orphanPlanCli.status,
			stdout: orphanPlanCli.stdout,
			stderr: orphanPlanCli.stderr,
			report: checks.externalSpecRequiresCompanions,
		},
	);

	const relativeManifestDir = `${TMP_DIR}/relative_manifest_project`;
	mkdirSync(`${relativeManifestDir}/local_pack`, { recursive: true });
	const relativeManifestAssembly = {
		...genericAssembly,
		cellManifest: 'local_pack/cell_manifest.json',
		layoutPolicy: {
			...genericAssembly.layoutPolicy,
			xProfiles: [{ sensorX: 300 }],
		},
	};
	const relativeManifest = {
		schemaVersion: 1,
		packId: 'aihwdebugger',
		requiredQualityRules: ['orthogonal-wiring', 'real-net-labels'],
		cells: [{
			id: 'localOnlyCell',
			moduleType: 'sensor_frontend',
			refs: ['U', 'R'],
			netArgs: [],
			ports: ['SENSE_OUT', 'GND'],
			layoutIntent: 'relative manifest path smoke',
			qualityRules: ['orthogonal-wiring', 'real-net-labels'],
		}],
	};
	writeFileSync(`${relativeManifestDir}/project_assembly.json`, JSON.stringify(relativeManifestAssembly, null, 2) + '\n', 'utf8');
	writeFileSync(`${relativeManifestDir}/local_pack/cell_manifest.json`, JSON.stringify(relativeManifest, null, 2) + '\n', 'utf8');
	const relativeManifestContract = clone(genericContract);
	if (relativeManifestContract.modules?.[0]) {
		relativeManifestContract.modules[0].drawingRules = [
			'orthogonal-wiring',
			'real-net-labels',
			'text-clearance',
			'module-box-isolation',
			'no-fake-net-text',
			'no-unnecessary-net-ports',
		];
	}
	const genericSpecForRelativeManifest = {
		schemaVersion: 1,
		projectId: genericContract.projectId,
		intent: 'Relative cell manifest path smoke.',
		circuitPack: 'aihwdebugger',
		modules: [{ id: 'sensor_frontend', title: 'Sensor Frontend', requiredNets: ['SENSE_OUT', 'GND'] }],
		interfaces: [],
	};
	const relativeManifestPlan = buildGsdPlan({
		spec: genericSpecForRelativeManifest,
		contract: relativeManifestContract,
		netlist: { schemaVersion: 1, projectId: genericContract.projectId, nets: [{ name: 'SENSE_OUT', requiredPins: [] }, { name: 'GND', requiredPins: [] }] },
		assembly: relativeManifestAssembly,
		libraryManifest: {
			generatedFrom: 'workflow smoke',
			purpose: 'Relative manifest path smoke library bindings.',
			parts: {
				U99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'U99', value: 'IC', addIntoBom: true, addIntoPcb: true },
				R99: { Symbol: 'S', Device: 'D', Footprint: 'F', name: 'R99', value: '10k', addIntoBom: true, addIntoPcb: true },
			},
		},
		partLibSnapshot: {
			project: genericContract.projectId,
			components: [{ designator: 'U99' }, { designator: 'R99' }],
		},
		model: null,
		specPath: '_tmp_workflow_smoke/relative_manifest_project/project_spec.json',
		assemblyPath: `${relativeManifestDir}/project_assembly.json`,
		partLibPath: `${relativeManifestDir}/project_library_snapshot.json`,
	});
	checks.relativeCellManifestUsesAssemblyDir = {
		pass: relativeManifestPlan.pass,
		rules: (relativeManifestPlan.findings || []).map(f => f.rule),
		firstFinding: relativeManifestPlan.findings?.[0] || null,
	};
	assertFinding(
		findings,
		hasRule(relativeManifestPlan, 'GP16-assembly-cell-declared')
			&& (relativeManifestPlan.findings || []).some(f => f.where?.manifestPath === `${relativeManifestDir}/local_pack/cell_manifest.json`),
		'WS27-relative-cell-manifest-uses-assembly-dir',
		'relative cellManifest paths in external project_assembly.json must resolve beside that assembly file instead of the repository root',
		checks.relativeCellManifestUsesAssemblyDir,
	);
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
	assertFinding(
		findings,
		customApplyContextReport?.applyWriter?.pass === false
			&& (customApplyContextReport?.applyWriter?.findings || []).some(f => f.rule === 'AW6-writer-scaffold-only'),
		'WS53-pack-writer-scaffold-fails-closed',
		'custom circuit pack writer templates must be visible in apply context but blocked until the scaffoldOnly writer is implemented',
		checks.customApplyContext,
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
	writeFileSync(`${repairContextDir}/cell_manifest_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		packId: CUSTOM_PACK,
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'CM11-builder-exists', severity: 'hard', msg: 'cell builder missing in custom pack' }],
	}, null, 2), 'utf8');
	writeFileSync(`${repairContextDir}/gsd_plan_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		spec: '_tmp_workflow_smoke/custom_project/project_spec.json',
		circuitPack: CUSTOM_PACK,
		severity: { hard: 2, soft: 0, info: 0 },
		findings: [
			{ rule: 'GP-DR1-drawing-rule-known', severity: 'hard', msg: 'unknown drawing rule smoke', where: { drawingRule: 'pretty-but-not-executable' } },
			{ rule: 'CB8-wire-orthogonal', severity: 'hard', msg: 'cell builder diagonal wire smoke', where: { module: 'sensor_frontend', cell: 'sensorCell' } },
		],
	}, null, 2), 'utf8');
	writeFileSync(`${repairContextDir}/project_rule_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		projectId: 'workflow_smoke_pack-project',
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'PR-DR1-drawing-rule-known', severity: 'hard', msg: 'unknown project drawing rule smoke', where: { drawingRule: 'pretty-but-not-executable' } }],
	}, null, 2), 'utf8');
	writeFileSync(`${repairContextDir}/apply_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		mode: 'preflight',
		writeBack: false,
		applyWriter: {
			pass: false,
			mode: 'external-pack-writer',
			writer: null,
			severity: { hard: 1, soft: 0, info: 0 },
			findings: [{ rule: 'AW1-pack-writer-declared', severity: 'hard', msg: 'external pack writer missing smoke', where: { circuitPack: CUSTOM_PACK } }],
		},
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'AW1-pack-writer-declared', severity: 'hard', msg: 'external pack writer missing smoke', where: { circuitPack: CUSTOM_PACK } }],
	}, null, 2), 'utf8');
	writeFileSync(`${repairContextDir}/final_evidence_report.json`, JSON.stringify({
		generatedAt: new Date().toISOString(),
		pass: false,
		mode: 'local-only',
		context: { spec: '_tmp_workflow_smoke/custom_project/project_spec.json', projectId: 'workflow_smoke_pack-project' },
		severity: { hard: 1, soft: 0, info: 0 },
		findings: [{ rule: 'FE9-acceptance-context-match', severity: 'hard', msg: 'external spec context smoke' }],
	}, null, 2), 'utf8');
	writeFileSync(`${TMP_DIR}/custom_project/project_assembly.json`, JSON.stringify({
		...readJson(`${customDir}/project_assembly.json`),
		circuitPack: CUSTOM_PACK,
	}, null, 2) + '\n', 'utf8');
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
	const customRepairText = existsSync(`${repairContextDir}/repair_actions.json`) ? readFileSync(`${repairContextDir}/repair_actions.json`, 'utf8') : '';
	checks.customRepairContext = {
		status: customRepairActions.status,
		actionCount: customRepairReport?.actionCount ?? null,
		commands: customRepairCommands,
		circuitPack: customRepairReport?.context?.circuitPack || null,
		hasPackPlaceholder: customRepairText.includes('<pack>'),
		hasConcretePackPath: customRepairText.includes(`circuit_packs/${CUSTOM_PACK}/pack.mjs`),
		areas: (customRepairReport?.actions || []).map(a => a.area),
		hasDrawingRuleAction: (customRepairReport?.actions || []).some(a => a.area === 'drawing-rule-bindings' && (a.editFiles || []).includes('contracts/drawing_rule_registry.mjs')),
		hasCellBuilderAction: (customRepairReport?.actions || []).some(a => a.area === 'cell-builder-output' && (a.editFiles || []).includes(`circuit_packs/${CUSTOM_PACK}/pack.mjs`)),
		hasApplyWriterAction: (customRepairReport?.actions || []).some(a => a.area === 'apply-writer' && (a.editFiles || []).includes(`circuit_packs/${CUSTOM_PACK}/pack.mjs`) && /apply --gated --context-only/.test(a.nextCommand || '')),
	};
	assertFinding(
		findings,
		customRepairActions.status !== 0
			&& customRepairCommands.length > 0
			&& customRepairCommands.every(cmd => [
				'node bin/easyeda-gsd.mjs plan _tmp_workflow_smoke/custom_project/project_spec.json',
				'node bin/easyeda-gsd.mjs accept _tmp_workflow_smoke/custom_project/project_spec.json',
				'node bin/easyeda-gsd.mjs apply --gated --context-only _tmp_workflow_smoke/custom_project/project_spec.json',
			].includes(cmd)),
		'WS20-repair-actions-context-bound',
		'repair actions for an external spec must rerun the context-aware GSD entrypoint instead of bare npm scripts that fall back to the root project',
		{
			status: customRepairActions.status,
			stdout: customRepairActions.stdout,
			stderr: customRepairActions.stderr,
			report: checks.customRepairContext,
		},
	);
	assertFinding(
		findings,
		checks.customRepairContext.circuitPack === CUSTOM_PACK
			&& checks.customRepairContext.hasPackPlaceholder === false
			&& checks.customRepairContext.hasConcretePackPath === true,
		'WS28-repair-actions-resolve-pack-placeholder',
		'repair actions for external projects must resolve <pack> placeholders to the active circuit pack id',
		checks.customRepairContext,
	);
	assertFinding(
		findings,
		checks.customRepairContext.hasDrawingRuleAction
			&& checks.customRepairContext.hasCellBuilderAction
			&& checks.customRepairContext.hasApplyWriterAction,
		'WS50-repair-actions-cover-executable-failure-classes',
		'repair actions must map drawing-rule, cell-builder, and apply-writer failures to concrete deterministic source files and context-aware rerun commands',
		checks.customRepairContext,
	);

	const customNextActions = spawnSync(process.execPath, [`${ROOT}/engine/next_actions.mjs`], {
		cwd: repairContextDir,
		stdio: 'pipe',
		shell: false,
		env: {
			...process.env,
			EASYEDA_WORKDIR: repairContextDir,
			EASYEDA_NEXT_ACTIONS: `${repairContextDir}/next_actions.json`,
		},
		encoding: 'utf8',
	});
	const customNextReport = existsSync(`${repairContextDir}/next_actions.json`) ? readJson(`${repairContextDir}/next_actions.json`) : null;
	const customNextText = existsSync(`${repairContextDir}/next_actions.json`) ? readFileSync(`${repairContextDir}/next_actions.json`, 'utf8') : '';
	checks.customNextActionsPackTargets = {
		status: customNextActions.status,
		actionCount: (customNextReport?.actions || []).length,
		circuitPack: customNextReport?.context?.circuitPack || null,
		hasPackPlaceholder: customNextText.includes('<pack>'),
		hasConcretePackPath: customNextText.includes(`circuit_packs/${CUSTOM_PACK}/pack.mjs`),
		areas: (customNextReport?.actions || []).map(a => a.area),
		hasDrawingRuleAction: (customNextReport?.actions || []).some(a => a.area === 'drawing-rule-bindings' && (a.suggestedFix?.files || []).includes('contracts/drawing_rule_registry.mjs')),
		hasApplyWriterAction: (customNextReport?.actions || []).some(a => a.area === 'apply-writer' && /apply --gated --context-only/.test(a.nextCommand || a.suggestedFix?.command || '')),
	};
	assertFinding(
		findings,
		customNextActions.status !== 0
			&& checks.customNextActionsPackTargets.circuitPack === CUSTOM_PACK
			&& checks.customNextActionsPackTargets.hasPackPlaceholder === false
			&& checks.customNextActionsPackTargets.hasConcretePackPath === true,
		'WS29-next-actions-resolve-pack-placeholder',
		'next actions for external projects must resolve <pack> placeholders before handing instructions to an agent',
		{
			status: customNextActions.status,
			stdout: customNextActions.stdout,
			stderr: customNextActions.stderr,
			report: checks.customNextActionsPackTargets,
		},
	);
	assertFinding(
		findings,
		checks.customNextActionsPackTargets.hasDrawingRuleAction
			&& checks.customNextActionsPackTargets.hasApplyWriterAction,
		'WS51-next-actions-cover-executable-failure-classes',
		'next actions must expose drawing-rule and apply-writer repair targets directly to agents instead of hiding them behind generic acceptance failure',
		checks.customNextActionsPackTargets,
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
	rmSync(BAD_BUILDER_PACK_DIR, { recursive: true, force: true });
	rmSync(NO_WRITER_PACK_DIR, { recursive: true, force: true });
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
