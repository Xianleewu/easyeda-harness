// Deterministic layout pipeline: plan -> assemble -> validate.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadPartLib } from './assemble.mjs';
import { planLayout } from './layout_planner.mjs';
import { HARNESS_RULES } from '../harness/rule_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const PART_LIB = process.env.EASYEDA_PART_LIB || DIR + 'snap2.json';
const OUT_MODEL = process.env.EASYEDA_MODEL_OUT || DIR + 'full_model.json';
const OUT_REPORT = process.env.EASYEDA_REPORT_OUT || DIR + 'report.json';
const LAYOUT_REPORT = process.env.EASYEDA_LAYOUT_REPORT_OUT || DIR + 'layout_planner_report.json';

const { snap } = loadPartLib(PART_LIB);
const layoutPlan = await planLayout({ modelOut: OUT_MODEL, reportOut: LAYOUT_REPORT });
const model = JSON.parse(readFileSync(OUT_MODEL, 'utf8').replace(/^\uFEFF/, ''));
writeFileSync(OUT_MODEL, JSON.stringify(model));

const result = {
	score: layoutPlan.best.template?.pass ? 100 : 0,
	pass: layoutPlan.best.template?.pass === true,
	bySev: layoutPlan.best.template?.severity || { hard: 1, soft: 0, info: 0 },
	findings: layoutPlan.best.template?.findings || [],
};
const byRule = {};
for (const f of result.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;

const report = {
	project: snap.project || 'AIHWDEBUGER',
	generatedAt: new Date().toISOString(),
	mode: 'template-compose',
	stats: { parts: model.components.length, wires: model.wires.length, netflags: model.netflags.length, texts: (model.texts || []).length, rectangles: (model.rectangles || []).length },
	coverage: {
		engineValidate: true,
		fullHarnessRules: true,
		harnessRuleCount: HARNESS_RULES.length,
		layoutPlanner: true,
	},
	layoutPlanner: {
		pass: layoutPlan.best.pass,
		score: layoutPlan.best.score,
		totalCandidates: layoutPlan.totalCandidates,
		availableCandidates: layoutPlan.availableCandidates,
		maxCandidates: layoutPlan.maxCandidates,
		finalists: layoutPlan.finalists,
		timingMs: layoutPlan.timingMs,
		best: {
			pass: layoutPlan.best.pass,
			score: layoutPlan.best.score,
			anchors: layoutPlan.best.anchors,
			template: layoutPlan.best.template,
			structure: layoutPlan.best.structure,
			architecture: layoutPlan.best.architecture,
			systemIntent: layoutPlan.best.systemIntent,
			sheetOutput: layoutPlan.best.sheetOutput,
			pageComposition: layoutPlan.best.pageComposition,
			design: layoutPlan.best.design,
		},
	},
	score: result.score,
	pass: result.pass && layoutPlan.best.pass,
	severity: result.bySev,
	byRule,
	findings: result.findings,
};
writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

console.log('─'.repeat(58));
console.log(`Template Harness | Score ${result.score}/100 | ${result.pass ? 'PASS' : 'FAIL'}`);
console.log(`parts=${model.components.length} wires=${model.wires.length} flags=${model.netflags.length}`);
console.log(`coverage=engine+full-harness rules=${HARNESS_RULES.length}`);
console.log(`HARD=${result.bySev.hard} SOFT=${result.bySev.soft} INFO=${result.bySev.info}`);
if (layoutPlan.timingMs) console.log(`layoutMs=${layoutPlan.timingMs.total} quick=${layoutPlan.timingMs.quick} finalists=${layoutPlan.timingMs.finalists}`);
if (result.findings.length) {
	console.log('— findings —');
	for (const f of result.findings.slice(0, 20)) console.log(`  [${f.severity}] ${f.rule}: ${f.msg}`);
}
console.log(`report -> ${OUT_REPORT}`);
process.exit(report.pass ? 0 : 1);
