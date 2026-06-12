import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const MAX_DRC_INFO = Number(process.env.EASYEDA_MAX_DRC_INFO ?? 0);
const TARGET_WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';

const DRC_JS = `
async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function normalizeLevel(level) {
  const raw = String(level || '').toLowerCase();
  if (/fatal|致命|鑷村懡|è´å½/.test(raw)) return 'fatal';
  if (/error|错误|錯誤|閿欒|éè¯¯/.test(raw)) return 'error';
  if (/warn|警告|璀﹀憡|è­¦å/.test(raw)) return 'warning';
  if (/info|信息|淇℃伅|ä¿¡æ¯/.test(raw)) return 'info';
  return raw || 'unknown';
}
const strictPass = await eda.sch_Drc.check(true, true, true);
await sleep(1000);
const text = (globalThis.document && document.body && document.body.innerText) ? document.body.innerText : '';
const lines = text.split(/\\n+/).map(s => s.trim()).filter(Boolean);
const items = [];
for (const line of lines) {
  const m = line.match(/^\\[([^\\]]+)\\]\\s*[:：]?\\s*(.*)$/);
  if (!m || !m[2]) continue;
  items.push({ level: normalizeLevel(m[1]), rawLevel: m[1], msg: m[2] });
}
let fatal = 0, errors = 0, warnings = 0, info = 0;
for (const line of lines.slice().reverse()) {
  if (!/(complete|完成|å®æ|瀹屾垚)/i.test(line)) continue;
  const nums = [...line.matchAll(/(\\d+)/g)].map(m => Number(m[1]));
  if (nums.length >= 4) {
    const last4 = nums.slice(-4);
    fatal = last4[0] || 0;
    errors = last4[1] || 0;
    warnings = last4[2] || 0;
    info = last4[3] || 0;
    break;
  }
}
const warnItems = items.filter(x => x.level === 'warning').length;
const errItems = items.filter(x => x.level === 'fatal' || x.level === 'error').length;
if (warnItems) warnings = Math.max(warnings, warnItems);
if (errItems) errors = Math.max(errors, errItems);
return { strictPass: strictPass === true, errors: fatal + errors, warnings, info, items: items.slice(-120), counts: { fatal, errors, warnings, info } };
`;

export function pullDrc() {
	const ui = pullDrcFromUi();
	if (ui.ok) return ui;

	writeFileSync(DIR + '_drc_probe.js', DRC_JS + '\n');
	const args = [
		'-ExecutionPolicy', 'Bypass', '-File', `${DIR}run.ps1`,
		'-JsFile', `${DIR}_drc_probe.js`,
	];
	if (TARGET_WINDOW_ID) args.push('-WindowId', TARGET_WINDOW_ID);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: DIR });
	if (ps.status !== 0) {
		return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: ps.stderr || ps.stdout || 'DRC bridge failed' }] };
	}
	try {
		const outer = JSON.parse(ps.stdout);
		return { ok: true, ...outer.result };
	} catch {
		return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: 'DRC response parse failed' }] };
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pullStableDrc({ attempts = 3, delayMs = 5000, log = console.log } = {}) {
	let last = null;
	for (let i = 0; i < attempts; i++) {
		if (i > 0) await sleep(delayMs);
		const result = pullDrc();
		last = result;
		if (log) log(`DRC attempt ${i + 1}/${attempts}: errors=${result.errors ?? '?'} warnings=${result.warnings ?? '?'} info=${result.info ?? '?'}`);
		if (result.strictPass && !(result.errors || 0) && !(result.warnings || 0) && !(result.info || 0)) return result;
	}
	return last;
}

function parseCompletionText(text) {
	const raw = String(text || '');
	const rows = raw.split(/(?:\\n|\n|","|",")/).filter(x => /complete|完成|å®æ|瀹屾垚/i.test(x));
	const candidates = rows.length ? rows.reverse() : [raw];
	for (const candidate of candidates) {
		const nums = [...String(candidate).matchAll(/\d+/g)].map(m => Number(m[0]));
		if (nums.length >= 4) {
			const [fatal, errors, warnings, info] = nums.slice(-4);
			return { fatal, errors, warnings, info };
		}
	}
	return null;
}

function parseCompletionJson(json) {
	const lines = [];
	if (Array.isArray(json?.afterLines)) lines.push(...json.afterLines);
	if (Array.isArray(json?.visible)) {
		for (const v of json.visible) if (v && typeof v.text === 'string') lines.push(v.text);
	}
	for (const line of lines.slice().reverse()) {
		if (!/complete|完成|å®æ|瀹屾垚/i.test(String(line))) continue;
		const nums = [...String(line).matchAll(/\d+/g)].map(m => Number(m[0]));
		// Completion rows include a timestamp plus the four DRC totals.
		if (nums.length < 10) continue;
		const [fatal, errors, warnings, info] = nums.slice(-4);
		return { fatal, errors, warnings, info };
	}
	return null;
}

function normalizeDrcLevel(level) {
	const raw = String(level || '').toLowerCase();
	if (/fatal|致命|鑷村懡|è´å½/.test(raw)) return 'fatal';
	if (/error|错误|錯誤|閿欒|éè¯¯/.test(raw)) return 'error';
	if (/warn|警告|璀﹀憡|è­¦å/.test(raw)) return 'warning';
	if (/info|信息|淇℃伅|ä¿¡æ¯/.test(raw)) return 'info';
	return raw || 'unknown';
}

export function parseDrcItemsFromText(text) {
	const raw = String(text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
	const re = /(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*)?\[([^\]]+)\]\s*[:：]?\s*([\s\S]*?)(?=(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*)?\[[^\]]+\]\s*[:：]?|$)/g;
	const items = [];
	for (const m of raw.matchAll(re)) {
		const rawLevel = String(m[1] || '').trim();
		const msg = String(m[2] || '').replace(/\s+/g, ' ').trim();
		if (!msg) continue;
		items.push({ level: normalizeDrcLevel(rawLevel), rawLevel, msg });
	}
	return items;
}

function parseDrcItemsFromJson(json) {
	const chunks = [];
	if (Array.isArray(json?.afterLines)) chunks.push(json.afterLines.join('\n'));
	if (Array.isArray(json?.visible)) {
		for (const v of json.visible) if (v && typeof v.text === 'string') chunks.push(v.text);
	}
	const seen = new Set();
	const out = [];
	for (const chunk of chunks) {
		for (const item of parseDrcItemsFromText(chunk)) {
			const k = `${item.level}|${item.msg}`;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(item);
		}
	}
	return out.slice(-120);
}

function pullDrcFromUi() {
	const out = DIR + 'drc_ui_probe.json';
	const args = [
		'-ExecutionPolicy', 'Bypass', '-File', `${DIR}run-save.ps1`,
		'-JsFile', `${DIR}_drc_click_warning.js`,
		'-OutFile', out,
	];
	if (TARGET_WINDOW_ID) args.push('-WindowId', TARGET_WINDOW_ID);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: DIR });
	if (ps.status !== 0) return pullDrcFromExistingUiText(ps.stderr || ps.stdout || 'DRC UI probe failed');
	try {
		const json = JSON.parse(readFileSync(out, 'utf8').replace(/^\uFEFF/, ''));
		const blob = JSON.stringify(json);
		const counts = parseCompletionJson(json) || parseCompletionText(blob);
		if (!counts) return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: 'DRC UI completion summary not found' }] };
		const items = parseDrcItemsFromJson(json);
		return {
			ok: true,
			strictPass: counts.fatal === 0 && counts.errors === 0 && counts.warnings === 0 && counts.info === 0,
			errors: counts.fatal + counts.errors,
			warnings: counts.warnings,
			info: counts.info,
			counts,
			items,
			source: 'ui',
		};
	} catch (e) {
		return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: e && e.message ? e.message : String(e) }] };
	}
}

function pullDrcFromExistingUiText(reason = '') {
	const js = DIR + '_drc_existing_ui.js';
	writeFileSync(js, `
const lines = (globalThis.document && document.body && document.body.innerText ? document.body.innerText : '')
  .split(/\\n+/).map(s => s.trim()).filter(Boolean);
return { lines: lines.slice(-160) };
`, 'utf8');
	const args = [
		'-ExecutionPolicy', 'Bypass', '-File', `${DIR}run.ps1`,
		'-JsFile', js,
	];
	if (TARGET_WINDOW_ID) args.push('-WindowId', TARGET_WINDOW_ID);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: DIR });
	if (ps.status !== 0) {
		return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: reason || ps.stderr || ps.stdout || 'DRC UI fallback failed' }] };
	}
	try {
		const outer = JSON.parse(ps.stdout);
		const lines = outer?.result?.lines || [];
		const counts = parseCompletionText(lines.join('\n'));
		if (!counts) return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: reason || 'DRC UI fallback summary not found' }] };
		const items = parseDrcItemsFromText(lines.join('\n'));
		return {
			ok: true,
			strictPass: counts.fatal === 0 && counts.errors === 0 && counts.warnings === 0 && counts.info === 0,
			errors: counts.fatal + counts.errors,
			warnings: counts.warnings,
			info: counts.info,
			counts,
			items,
			source: 'ui-fallback',
			fallbackReason: reason,
		};
	} catch (e) {
		return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', msg: e && e.message ? e.message : String(e) }] };
	}
}

export function drcQC(live = null) {
	const findings = [];
	const r = live || pullDrc();
	if (!r.ok) {
		findings.push({ rule: 'DRC-bridge', severity: 'hard', category: 'drc', msg: 'DRC bridge failed', where: r.items });
		return findings;
	}
	for (const it of (r.items || []).filter(x => ['fatal', 'error'].includes(normalizeDrcLevel(x.level))))
		findings.push({ rule: 'DRC-error', severity: 'hard', category: 'drc', msg: it.msg, where: it });
	for (const it of (r.items || []).filter(x => normalizeDrcLevel(x.level) === 'warning'))
		findings.push({ rule: 'DRC-warning', severity: 'hard', category: 'drc', msg: it.msg, where: it });
	if (r.errors > 0 && !findings.some(f => f.rule === 'DRC-error'))
		findings.push({ rule: 'DRC-error', severity: 'hard', category: 'drc', msg: `DRC errors=${r.errors}`, where: r });
	if (r.warnings > 0 && !findings.some(f => f.rule === 'DRC-warning'))
		findings.push({ rule: 'DRC-warning', severity: 'hard', category: 'drc', msg: `DRC warnings=${r.warnings}`, where: r });
	if ((r.info ?? 0) > MAX_DRC_INFO)
		findings.push({ rule: 'DRC-info-budget', severity: 'hard', category: 'drc',
			msg: `DRC info=${r.info} exceeds budget ${MAX_DRC_INFO}`, where: r });
	return findings;
}
