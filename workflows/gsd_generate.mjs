import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildGsdPlan } from './gsd_plan.mjs';
import { acquireRunLock } from './run_lock.mjs';

function readJson(root, rel) {
	const path = /^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/') ? rel : `${root}/${rel}`;
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function fileInfo(root, rel) {
	const path = `${root}/${rel}`;
	if (!existsSync(path)) return { exists: false };
	const stat = statSync(path);
	return { exists: true, size: stat.size, mtime: stat.mtime.toISOString() };
}

export function generateContext(root, specPath = 'project_spec.json') {
	const specAbs = resolve(root, specPath);
	const specDir = dirname(specAbs).replace(/\\/g, '/');
	const companion = name => existsSync(`${specDir}/${name}`) ? `${specDir}/${name}` : name;
	return {
		specAbs,
		specDir,
		specPath,
		contractPath: companion('project_contract.json'),
		netlistPath: companion('project_netlist.json'),
		assemblyPath: companion('project_assembly.json'),
		libraryManifestPath: companion('approved_library_manifest.json'),
	};
}

export function buildGeneratePlan(root, specPath = 'project_spec.json') {
	const context = generateContext(root, specPath);
	const spec = readJson(root, context.specAbs);
	const contract = readJson(root, context.contractPath);
	const netlist = readJson(root, context.netlistPath);
	const assembly = readJson(root, context.assemblyPath);
	const libraryManifest = readJson(root, context.libraryManifestPath);
	const model = existsSync(`${root}/full_model.json`) ? readJson(root, 'full_model.json') : null;
	return buildGsdPlan({ spec, contract, netlist, assembly, libraryManifest, model, specPath });
}

export function runGsdGenerate({ root, specPath = 'project_spec.json', command = ['engine/pipeline.mjs'], draft = false } = {}) {
	const started = Date.now();
	const lock = acquireRunLock(root);
	const context = generateContext(root, specPath);
	try {
		const plan = buildGeneratePlan(root, specPath);
		writeFileSync(`${root}/gsd_plan_report.json`, JSON.stringify(plan, null, 2), 'utf8');
		if (!plan.pass) {
			const report = {
				generatedAt: new Date().toISOString(),
				pass: false,
				spec: specPath,
				stage: 'plan',
				plan: { pass: plan.pass, severity: plan.severity, findings: plan.findings },
				severity: { hard: plan.severity.hard || 1, soft: 0, info: 0 },
				findings: plan.findings,
				durationMs: Date.now() - started,
			};
			writeFileSync(`${root}/gsd_generate_report.json`, JSON.stringify(report, null, 2), 'utf8');
			return { report, status: 1 };
		}

		const child = spawnSync(process.execPath, command, {
			cwd: root,
			stdio: 'inherit',
			shell: false,
			env: {
				...process.env,
				EASYEDA_GSD_LOCK_TOKEN: lock.token,
				EASYEDA_PROJECT_ASSEMBLY: context.assemblyPath,
				EASYEDA_PROJECT_CONTRACT: context.contractPath,
				EASYEDA_PROJECT_NETLIST: context.netlistPath,
				EASYEDA_APPROVED_LIBRARY_MANIFEST: context.libraryManifestPath,
			},
		});
		const reportJson = existsSync(`${root}/report.json`) ? readJson(root, 'report.json') : null;
		const generated = {
			fullModel: fileInfo(root, 'full_model.json'),
			report: fileInfo(root, 'report.json'),
		};
		const layoutEvidenceOk = draft || reportJson?.coverage?.layoutPlanner === true;
		const pass = child.status === 0 && reportJson?.pass === true && generated.fullModel.exists && layoutEvidenceOk;
		const report = {
			generatedAt: new Date().toISOString(),
			pass,
			spec: specPath,
			stage: 'generate',
			command: [process.execPath, ...command].join(' '),
			draft,
			layoutSearchRequired: !draft,
			projectId: plan.projectId,
			circuitPack: plan.circuitPack,
			generationContext: {
				specDir: context.specDir,
				assemblyPath: context.assemblyPath,
				contractPath: context.contractPath,
				netlistPath: context.netlistPath,
				libraryManifestPath: context.libraryManifestPath,
			},
			plan: { pass: plan.pass, severity: plan.severity },
			generated,
			template: reportJson ? {
				pass: reportJson.pass,
				severity: reportJson.severity,
				score: reportJson.score,
				mode: reportJson.mode,
				layoutPlanner: reportJson.coverage?.layoutPlanner === true,
			} : null,
			severity: { hard: pass ? 0 : 1, soft: 0, info: 0 },
			findings: pass ? [] : [{
				rule: 'GG1-generate-pass',
				severity: 'hard',
				category: 'gsd-generate',
				msg: 'deterministic generation must pass after a passing GSD plan',
				where: { status: child.status, reportPass: reportJson?.pass ?? null, fullModelExists: generated.fullModel.exists, layoutEvidenceOk },
			}],
			durationMs: Date.now() - started,
		};
		writeFileSync(`${root}/gsd_generate_report.json`, JSON.stringify(report, null, 2), 'utf8');
		return { report, status: pass ? 0 : 1 };
	} finally {
		lock.release();
	}
}
