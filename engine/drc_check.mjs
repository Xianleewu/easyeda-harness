import { writeFileSync } from 'node:fs';
import { pullStableDrc } from './drc_pull.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_DRC_REPORT || DIR + 'drc_report.json';

const result = await pullStableDrc({ attempts: 3, delayMs: 2500 });
const pass = result?.ok === true
	&& result?.strictPass === true
	&& !(result.errors || 0)
	&& !(result.warnings || 0)
	&& !(result.info || 0);

const report = {
	generatedAt: new Date().toISOString(),
	pass,
	severity: { hard: pass ? 0 : 1, soft: 0, info: 0 },
	drc: result,
};

writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(`drc ${pass ? 'PASS' : 'FAIL'} errors=${result?.errors ?? '?'} warnings=${result?.warnings ?? '?'} info=${result?.info ?? '?'}`);
console.log(`report -> ${OUT}`);
process.exitCode = pass ? 0 : 1;
