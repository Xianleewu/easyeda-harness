#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateSpecSchema } from '../contracts/spec_schema.mjs';
import { loadRepairLoopPlan } from '../workflows/repair_loop.mjs';
import { buildGsdPlan } from '../workflows/gsd_plan.mjs';
import { runGsdGenerate } from '../workflows/gsd_generate.mjs';

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
  init --pack aihwdebugger --out <file>
                               Write a minimal spec scaffold for the bundled pack.
  plan [spec]                  Validate current project contracts and print selected pack data.
  generate [spec]              Plan-gated deterministic generation without write-back.
  accept                       Run local acceptance gates.
  live-check                   Run live EasyEDA snapshot, image, DRC, and live shot checks.
  apply --gated                Write back through the fail-closed gated entrypoint.
  repair [--max-iterations N]  Write repair_loop_report.json from next_actions/repair_actions.
  report                       Summarize latest acceptance and repair artifacts.

Notes:
  - Do not free-draw in EasyEDA for delivery.
  - Local accept is not final delivery evidence; live-check is required before apply.
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

function writeInit(args) {
	const pack = optionValue(args, '--pack') || 'aihwdebugger';
	const out = optionValue(args, '--out');
	if (!out) {
		console.error('init requires --out <file>');
		process.exit(2);
	}
	if (pack !== 'aihwdebugger') {
		console.error(`unsupported pack: ${pack}`);
		process.exit(2);
	}
	const spec = readJson('project_spec.json');
	const target = resolve(ROOT, out).replace(/\\/g, '/');
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, JSON.stringify({ ...spec, circuitPack: pack }, null, 2) + '\n', 'utf8');
	log(`wrote ${target}`);
}

function plan(args) {
	const spec = args.find(a => !a.startsWith('-')) || 'project_spec.json';
	const specPath = resolve(ROOT, spec);
	if (!existsSync(specPath)) {
		console.error(`spec not found: ${spec}`);
		process.exit(2);
	}
	const specDoc = readJson(specPath);
	const assembly = readJson('project_assembly.json');
	const contract = readJson('project_contract.json');
	const netlist = readJson('project_netlist.json');
	const model = existsSync(`${ROOT}/full_model.json`) ? readJson('full_model.json') : null;
	const report = buildGsdPlan({ spec: specDoc, contract, netlist, assembly, model, specPath: spec });
	writeFileSync(`${ROOT}/gsd_plan_report.json`, JSON.stringify(report, null, 2), 'utf8');
	log(JSON.stringify(report, null, 2));
	log('report -> gsd_plan_report.json');
	process.exit(report.pass ? 0 : 1);
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
	const maxIterations = Number(optionValue(args, '--max-iterations') || 1);
	if (args.includes('--write')) {
		console.error('automatic write repair is not implemented yet; inspect repair_actions.json and edit deterministic sources explicitly');
		process.exit(2);
	}
	const repairFile = `${ROOT}/repair_actions.json`;
	if (!existsSync(repairFile)) runNode(['engine/repair_actions.mjs']);
	const plan = loadRepairLoopPlan(ROOT, { maxIterations });
	writeFileSync(`${ROOT}/repair_loop_report.json`, JSON.stringify(plan, null, 2), 'utf8');
	log(JSON.stringify(plan, null, 2));
	log('report -> repair_loop_report.json');
	process.exit(plan.pass ? 0 : 1);
}

function generate(args) {
	const spec = args.find(a => !a.startsWith('-')) || 'project_spec.json';
	const { report, status } = runGsdGenerate({ root: ROOT, specPath: spec });
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
		writeInit(args);
		break;
	case 'plan':
		plan(args);
		break;
	case 'generate':
		generate(args);
		break;
	case 'accept':
		runNode(['engine/acceptance_run.mjs']);
		break;
	case 'live-check':
		runNode(['engine/acceptance_run.mjs', '--live']);
		break;
	case 'apply':
		if (!args.includes('--gated')) {
			console.error('apply requires --gated');
			process.exit(2);
		}
		runNode(['engine/apply_gated.mjs']);
		break;
	case 'repair':
		repair(args);
		break;
	case 'report':
		report();
		break;
	default:
		console.error(`unknown command: ${cmd}`);
		usage();
		process.exit(2);
}
