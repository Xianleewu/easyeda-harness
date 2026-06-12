import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel } from './model.mjs';
import { HARNESS_RULES, runRules } from './rule_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const SNAP = process.argv[2] || DIR + 'snapshot.json';
const OUT = process.argv[3] || DIR + 'report.json';

const snap = JSON.parse(readFileSync(SNAP, 'utf8').replace(/^\uFEFF/, ''));
const model = buildModel(snap);

const findings = runRules(model, HARNESS_RULES);

const bySev = { hard: 0, soft: 0, info: 0 };
const byCat = {};
const byRule = {};
for (const f of findings) {
	bySev[f.severity] = (bySev[f.severity] || 0) + 1;
	byCat[f.category] = (byCat[f.category] || 0) + 1;
	byRule[f.rule] = (byRule[f.rule] || 0) + 1;
}

const score = Math.max(0, 100 - bySev.hard * 3 - bySev.soft * 1);
const pass = bySev.hard === 0 && bySev.soft === 0 && bySev.info === 0;

const report = {
	project: model.project,
	generatedAt: new Date().toISOString(),
	stats: {
		segments: model.segments.length,
		parts: model.parts.length,
		netflags: model.netflags.length,
		netports: model.netports.length,
		texts: model.texts.length,
		wireGroups: model.groups.length,
	},
	score,
	pass,
	severity: bySev,
	byCategory: byCat,
	byRule,
	findings,
};
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

const bar = '-'.repeat(58);
console.log(bar);
console.log(`Schematic Harness | ${model.project} | Score ${score}/100 | ${pass ? 'PASS' : 'FAIL'}`);
console.log(bar);
console.log(`parts=${model.parts.length} segments=${model.segments.length} netGroups=${model.groups.length} netflags=${model.netflags.length}`);
console.log(`HARD=${bySev.hard} SOFT=${bySev.soft} INFO=${bySev.info}`);
console.log('-- by category --');
for (const c of Object.keys(byCat)) console.log(`  ${c.padEnd(12)} ${byCat[c]}`);
console.log('-- by rule --');
for (const r of Object.keys(byRule).sort()) console.log(`  ${r.padEnd(26)} ${byRule[r]}`);
console.log(bar);
console.log(`full report -> ${OUT}`);
process.exit(pass ? 0 : 1);
