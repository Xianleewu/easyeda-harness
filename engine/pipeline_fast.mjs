import { readFileSync, writeFileSync } from 'node:fs';
import { assemble, loadPartLib, loadProjectAssembly } from './assemble.mjs';
import { validateTemplate } from './validate.mjs';
import { HARNESS_RULES } from '../harness/rule_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const PART_LIB = process.env.EASYEDA_PART_LIB || DIR + 'snap2.json';
const OUT_MODEL = process.env.EASYEDA_MODEL_OUT || DIR + 'full_model.json';
const OUT_REPORT = process.env.EASYEDA_REPORT_OUT || DIR + 'report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function defaultAnchors() {
	const assembly = loadProjectAssembly();
	if (process.env.EASYEDA_FAST_REUSE_ANCHORS === '1') {
		try {
			const rep = readJson(OUT_REPORT);
			const a = rep.layoutPlanner?.best?.anchors;
			if (a) return a;
		} catch {}
	}
	return assembly.anchors || {};
}

const started = performance.now();
const { snap, byDes } = loadPartLib(PART_LIB);
const anchors = defaultAnchors();
const model = assemble(byDes, anchors);
writeFileSync(OUT_MODEL, JSON.stringify(model));
const result = validateTemplate(model, snap);
const byRule = {};
for (const f of result.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
const report = {
	project: snap.project || 'AIHWDEBUGER',
	generatedAt: new Date().toISOString(),
	mode: 'template-fast',
	stats: {
		parts: model.components.length,
		wires: model.wires.length,
		netflags: model.netflags.length,
		texts: (model.texts || []).length,
		rectangles: (model.rectangles || []).length,
	},
	coverage: {
		engineValidate: true,
		fullHarnessRules: true,
		harnessRuleCount: HARNESS_RULES.length,
		layoutPlanner: false,
	},
	layoutPlanner: {
		pass: true,
		score: null,
		totalCandidates: 1,
		best: { anchors },
	},
	score: result.score,
	pass: result.pass,
	severity: result.bySev,
	byRule,
	findings: result.findings,
	elapsedMs: Math.round(performance.now() - started),
};
writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

console.log('─'.repeat(58));
console.log(`Fast Template Harness | Score ${result.score}/100 | ${result.pass ? 'PASS' : 'FAIL'} | ${report.elapsedMs}ms`);
console.log(`parts=${model.components.length} wires=${model.wires.length} flags=${model.netflags.length}`);
console.log(`coverage=engine+full-harness rules=${HARNESS_RULES.length} layoutSearch=skipped`);
console.log(`HARD=${result.bySev.hard} SOFT=${result.bySev.soft} INFO=${result.bySev.info}`);
if (result.findings.length) {
	console.log('— findings —');
	for (const f of result.findings.slice(0, 20)) console.log(`  [${f.severity}] ${f.rule}: ${f.msg}`);
}
console.log(`report -> ${OUT_REPORT}`);
process.exit(result.pass ? 0 : 1);
