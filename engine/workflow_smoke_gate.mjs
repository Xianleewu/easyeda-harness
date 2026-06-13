import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGsdPlan } from '../workflows/gsd_plan.mjs';
import { runGsdGenerate } from '../workflows/gsd_generate.mjs';
import { writeScaffold } from '../workflows/gsd_scaffold.mjs';
import { buildMinimalSpec, syncPackRegistry, writePackScaffold } from '../workflows/pack_scaffold.mjs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const REPORT = process.env.EASYEDA_WORKFLOW_SMOKE_REPORT || `${ROOT}/workflow_smoke_report.json`;
const TMP_DIR = `${ROOT}/_tmp_workflow_smoke`;
const BAD_SPEC = `${TMP_DIR}/bad_project_spec.json`;
const SCAFFOLD_DIR = `${TMP_DIR}/scaffold`;
const BAD_MANIFEST = `${TMP_DIR}/bad_cell_manifest.json`;
const BAD_MANIFEST_ASSEMBLY = `${TMP_DIR}/bad_manifest_project_assembly.json`;
const CUSTOM_PACK = 'workflow_smoke_pack';
const CUSTOM_PACK_DIR = `${ROOT}/circuit_packs/${CUSTOM_PACK}`;

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

	writeFileSync(BAD_SPEC, JSON.stringify(badSpec, null, 2) + '\n', 'utf8');
	const fullModelPath = `${ROOT}/full_model.json`;
	const beforeFullModelMtime = fileMtimeMs(fullModelPath);
	const badGenerate = runGsdGenerate({
		root: ROOT,
		specPath: '_tmp_workflow_smoke/bad_project_spec.json',
		command: ['engine/pipeline_fast.mjs'],
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

	const restoreGenerate = runGsdGenerate({ root: ROOT, specPath: 'project_spec.json', command: ['engine/pipeline_fast.mjs'] });
	checks.restoreGenerate = {
		pass: restoreGenerate.status === 0,
		stage: restoreGenerate.report?.stage || null,
	};
	assertFinding(findings, restoreGenerate.status === 0, 'WS10-restore-generate-pass', 'workflow smoke must restore normal GSD generate reports after negative checks', {
		status: restoreGenerate.status,
		stage: restoreGenerate.report?.stage || null,
		firstFinding: restoreGenerate.report?.findings?.[0] || null,
	});
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
