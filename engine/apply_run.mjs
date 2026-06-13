import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { executeJsFile } from './bridge_client.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const FORCE = process.argv.includes('--force') || process.argv.includes('--Force');
const WINDOW_ID = process.env.EASYEDA_WINDOW_ID || valueAfter('--window-id') || valueAfter('--WindowId') || '';
const MAX_ATTEMPTS = Number(process.env.EASYEDA_APPLY_MAX_ATTEMPTS || 3);

function valueAfter(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

if (process.env.EASYEDA_APPLY_RUN_AUTHORIZED !== '1') {
	console.error('Manual apply_run.mjs is blocked. Use node engine/apply_gated.mjs so the full acceptance gate is enforced.');
	process.exit(1);
}
if (!FORCE) {
	console.error('apply_run.mjs requires an internal --force from apply_gated.mjs after acceptance gate approval.');
	process.exit(1);
}

function chunkNames(patternPrefix) {
	return readdirSync(DIR)
		.filter(name => name.startsWith(patternPrefix) && name.endsWith('.js'))
		.sort((a, b) => numericSuffix(a) - numericSuffix(b));
}

function numericSuffix(name) {
	const m = basename(name, '.js').match(/(\d+)$/);
	return m ? Number(m[1]) : 0;
}

const order = [
	'af_delparts.js',
	...chunkNames('af_move_parts_'),
	'af_nc.js',
	'af_del.js',
	...chunkNames('af_wires_'),
	...chunkNames('af_flags_'),
	...chunkNames('af_ports_'),
	'af_docs.js',
	'af_zoom.js',
];

function isTimeout(err) {
	return /timed out|timeout|aborted|Request .* timed out/i.test(err?.message || String(err || ''));
}

for (const f of order) {
	const jsFile = join(DIR, f);
	if (!existsSync(jsFile)) throw new Error(`apply step missing: ${f}`);
	let ok = false;
	let lastErr = null;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		console.log(attempt === 1 ? `>> ${f}` : `>> ${f} retry ${attempt}/${MAX_ATTEMPTS}`);
		try {
			const { result } = await executeJsFile(jsFile, { windowId: WINDOW_ID, timeoutMs: 120000 });
			if (result != null) console.log(JSON.stringify(result));
			ok = true;
			break;
		} catch (err) {
			lastErr = err;
			if (!isTimeout(err) || attempt >= MAX_ATTEMPTS) break;
			await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 1000));
		}
	}
	if (!ok) throw new Error(`apply step failed: ${f}\n${lastErr?.message || lastErr}`);
}
