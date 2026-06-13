#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateSpecSchema } from '../contracts/spec_schema.mjs';
import { loadRepairLoopPlan } from '../workflows/repair_loop.mjs';
import { buildGsdPlan } from '../workflows/gsd_plan.mjs';
import { runGsdGenerate } from '../workflows/gsd_generate.mjs';
import { writeScaffold } from '../workflows/gsd_scaffold.mjs';
import { buildMinimalSpec, validatePackId, writePackScaffold } from '../workflows/pack_scaffold.mjs';
import { circuitPackIds } from '../circuit_packs/registry.mjs';
import { acquireRunLock } from '../workflows/run_lock.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\\/g, '/');

function log(text = '') {
	console.log(text);
}

function usage() {
	log(`easyeda-gsd

Agent-neutral workflow wrapper for EasyEDA Harness.

Safe order:
  1. init/plan a structured project input
  2. generate deterministic model artifacts
  3. accept local gates
  4. live-check with EasyEDA bridge evidence
  5. apply --gated

Commands:
  help                         Show this help.
  init --pack <pack> --out <file-or-dir>
                               Write a spec file, or a full project + circuit-pack scaffold when <out> is a directory.
  plan [spec]                  Validate current project contracts and print selected pack data.
  generate [--fast] [spec]     Plan-gated deterministic generation without write-back; full layout search by default.
  accept [spec]                Run local acceptance gates for the selected spec context.
  live-check [spec]            Run live EasyEDA snapshot, image, DRC, and live shot checks.
  apply --gated [spec]         Write back through the fail-closed gated entrypoint for the selected spec context.
  repair [--max-iterations N]  Write repair_loop_report.json from next_actions/repair_actions.
  report                       Summarize latest acceptance and repair artifacts.

Notes:
  - Do not free-draw in EasyEDA for delivery.
  - Local accept is not final delivery evidence; live-check is required before apply.
  - Stateful commands share report artifacts and are protected by a workspace lock; run them serially.
  - Low-level writer scripts are debugging-only.`);
}

function runNode(args) {
	const child = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', shell: false, env: process.env });
	if (child.error) {
		console.error(child.error.message);
		process.exit(1);
	}
	process.exit(child.status ?? 1);
}

function readJson(rel) {
	const path = /^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/') ? rel : `${ROOT}/${rel}`;
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function optionValue(args, name) {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
}

function acquireCliLock() {
	try {
		return acquireRunLock(ROOT);
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}

function writeInit(args) {
	const lock = acquireCliLock();
	try {
		const pack = validatePackId(optionValue(args, '--pack') || 'aihwdebugger');
		const out = optionValue(args, '--out');
		if (!out) {
			console.error('init requires --out <file>');
			return 2;
		}
		const spec = pack === 'aihwdebugger' && circuitPackIds().includes('aihwdebugger')
			? readJson('project_spec.json')
			: buildMinimalSpec(pack);
		const packScaffold = circuitPackIds().includes(pack) ? null : writePackScaffold({ root: ROOT, packId: pack });
		const target = resolve(ROOT, out).replace(/\\/g, '/');
		if (!/\.[A-Za-z0-9]+$/.test(target)) {
			const scaffold = writeScaffold({ outDir: target, spec, pack });
			log(JSON.stringify({ pack: packScaffold, project: scaffold }, null, 2));
			log(`${target}/gsd_scaffold_report.json`);
			return 0;
		}
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, JSON.stringify({ ...spec, circuitPack: pack }, null, 2) + '\n', 'utf8');
		if (packScaffold) log(JSON.stringify({ pack: packScaffold }, null, 2));
		log(`wrote ${target}`);
		return 0;
	} finally {
		lock.release();
	}
}

function companionPath(specAbs, name) {
	const specDir = dirname(specAbs).replace(/\\/g, '/');
	const local = `${specDir}/${name}`;
	return existsSync(local) ? local : name;
}

function plan(args) {
	const lock = acquireCliLock();
	try {
		const spec = args.find(a => !a.startsWith('-')) || 'project_spec.json';
		const specPath = resolve(ROOT, spec);
		if (!existsSync(specPath)) {
			console.error(`spec not found: ${spec}`);
			return 2;
		}
		const specDoc = readJson(specPath);
		const assembly = readJson(companionPath(specPath, 'project_assembly.json'));
		const contract = readJson(companionPath(specPath, 'project_contract.json'));
		const netlist = readJson(companionPath(specPath, 'project_netlist.json'));
		const libraryManifest = readJson(companionPath(specPath, 'approved_library_manifest.json'));
		const model = existsSync(`${ROOT}/full_model.json`) ? readJson('full_model.json') : null;
		const report = buildGsdPlan({ spec: specDoc, contract, netlist, assembly, libraryManifest, model, specPath: spec });
		writeFileSync(`${ROOT}/gsd_plan_report.json`, JSON.stringify(report, null, 2), 'utf8');
		log(JSON.stringify(report, null, 2));
		log('report -> gsd_plan_report.json');
		return report.pass ? 0 : 1;
	} finally {
		lock.release();
	}
}

function report() {
	const files = [
		'acceptance_report.json',
		'cell_manifest_report.json',
		'project_contract_report.json',
		'project_netlist_report.json',
		'project_assembly_report.json',
		'project_layout_report.json',
		'project_visual_report.json',
		'repair_actions.json',
		'next_actions.json',
	];
	const summary = {};
	for (const file of files) {
		if (!existsSync(`${ROOT}/${file}`)) {
			summary[file] = { status: 'missing' };
			continue;
		}
		const data = readJson(file);
		summary[file] = {
			pass: data.pass ?? null,
			severity: data.severity || null,
			actionCount: data.actionCount ?? data.actions?.length ?? null,
		};
	}
	log(JSON.stringify(summary, null, 2));
}

function repair(args) {
	const lock = acquireCliLock();
	try {
		const maxIterations = Number(optionValue(args, '--max-iterations') || 1);
		if (args.includes('--write')) {
			console.error('automatic write repair is not implemented yet; inspect repair_actions.json and edit deterministic sources explicitly');
			return 2;
		}
		const repairFile = `${ROOT}/repair_actions.json`;
		if (!existsSync(repairFile)) {
			const child = spawnSync(process.execPath, ['engine/repair_actions.mjs'], { cwd: ROOT, stdio: 'inherit', shell: false, env: { ...process.env, EASYEDA_GSD_LOCK_TOKEN: lock.token } });
			if (child.error) console.error(child.error.message);
			if (child.status !== 0) return child.status ?? 1;
		}
		const plan = loadRepairLoopPlan(ROOT, { maxIterations });
		writeFileSync(`${ROOT}/repair_loop_report.json`, JSON.stringify(plan, null, 2), 'utf8');
		log(JSON.stringify(plan, null, 2));
		log('report -> repair_loop_report.json');
		return plan.pass ? 0 : 1;
	} finally {
		lock.release();
	}
}

function generate(args) {
	const spec = args.find(a => !a.startsWith('-')) || 'project_spec.json';
	const fast = args.includes('--fast');
	const command = fast ? ['engine/pipeline_fast.mjs'] : ['engine/pipeline.mjs'];
	const { report, status } = runGsdGenerate({ root: ROOT, specPath: spec, command, draft: fast });
	log(JSON.stringify(report, null, 2));
	log('report -> gsd_generate_report.json');
	process.exit(status);
}

const [cmd = 'help', ...args] = process.argv.slice(2);

switch (cmd) {
	case 'help':
	case '--help':
	case '-h':
		usage();
		break;
	case 'init':
		process.exit(writeInit(args));
		break;
	case 'plan':
		process.exit(plan(args));
		break;
	case 'generate':
		generate(args);
		break;
	case 'accept':
		runNode(['engine/acceptance_run.mjs', ...args]);
		break;
	case 'live-check':
		runNode(['engine/acceptance_run.mjs', '--live', ...args]);
		break;
	case 'apply':
		if (!args.includes('--gated')) {
			console.error('apply requires --gated');
			process.exit(2);
		}
		runNode(['engine/apply_gated.mjs', ...args.filter(arg => arg !== '--gated')]);
		break;
	case 'repair':
		process.exit(repair(args));
		break;
	case 'report':
		report();
		break;
	default:
		console.error(`unknown command: ${cmd}`);
		usage();
		process.exit(2);
}
