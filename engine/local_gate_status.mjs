// 本地门禁状态(只读，CI/开发用)：当且仅当所有「本地」门禁通过时退出 0。
//
// 为什么需要它：`accept` 是 fail-closed 的——即使全部本地门禁通过，
// 只要缺少实时 EasyEDA 证据，`final:evidence` 与 `next:actions` 仍会失败，
// 于是 `accept` 返回非 0。这是刻意的交付安全语义，绝不能弱化。
// 本命令在不改动 accept/deliver/apply:gated 的前提下，给本地开发循环一个
// 诚实的绿灯信号：本地门禁全绿 = PASS（并明确标注最终交付仍需实时证据）。
//
// 它从不写源文件，也从不声称已交付。
import { existsSync, readFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_ACCEPT_REPORT || DIR + 'acceptance_report.json';

/* 这些 required 步骤天然依赖实时 EasyEDA 证据，在 local-only 模式下必失败 */
const LIVE_DEPENDENT_STEPS = new Set(['final:evidence', 'next:actions']);

function fail(code, msg) {
	console.error(msg);
	process.exit(code);
}

if (!existsSync(REPORT)) {
	fail(2, `local gate status: ${REPORT} not found. Run "npm run accept" (or "node bin/easyeda-plexus.mjs accept") first.`);
}

let acceptance;
try {
	acceptance = JSON.parse(readFileSync(REPORT, 'utf8').replace(/^﻿/, ''));
} catch (e) {
	fail(2, `local gate status: cannot parse ${REPORT}: ${e.message}`);
}

const steps = Array.isArray(acceptance.steps) ? acceptance.steps : [];
const mode = acceptance.mode || 'local-only';

/* full-with-live 模式下，本地状态等同于完整 accept 结果 */
if (mode !== 'local-only') {
	const ok = acceptance.pass === true;
	console.log(`local gate status: mode=${mode} -> mirrors acceptance ${ok ? 'PASS' : 'FAIL'}`);
	process.exit(ok ? 0 : 1);
}

const localFailed = steps
	.filter(s => s.required && !s.pass && !LIVE_DEPENDENT_STEPS.has(s.name))
	.map(s => s.name);
const liveDeferred = steps
	.filter(s => s.required && !s.pass && LIVE_DEPENDENT_STEPS.has(s.name))
	.map(s => s.name);
const localPass = localFailed.length === 0;

if (localPass) {
	console.log('local gate status: LOCAL GATES PASS '
		+ `(${steps.filter(s => s.required).length - liveDeferred.length} required local gates green)`);
	if (liveDeferred.length) {
		console.log(`note: final delivery still requires real EasyEDA live evidence; deferred fail-closed gates: ${liveDeferred.join(', ')}`);
		console.log('      run "node bin/easyeda-plexus.mjs live-check" then "deliver" once a live EasyEDA bridge is available.');
	}
	process.exit(0);
}

console.error(`local gate status: LOCAL GATES FAIL -> ${localFailed.join(', ')}`);
console.error('inspect repair_actions.json (edit targets) and next_actions.json, then re-run the failing gate.');
process.exit(1);
