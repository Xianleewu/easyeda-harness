import { executeCode } from './bridge_client.mjs';

const MAX_DRC_INFO = Number(process.env.EASYEDA_MAX_DRC_INFO ?? 0);
const TARGET_WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';

const DRC_JS = `
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeLevel(level) {
  const raw = String(level || '').toLowerCase();
  if (/fatal|致命/.test(raw)) return 'fatal';
  if (/error|错误|錯誤/.test(raw)) return 'error';
  if (/warn|警告/.test(raw)) return 'warning';
  if (/info|信息/.test(raw)) return 'info';
  return raw || 'unknown';
}
function lastRunLines(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/开始设计规则检查|start.*design.*rule.*check/i.test(lines[i])) return lines.slice(i);
  }
  return lines;
}
function parseCompletion(lines) {
  for (const line of lines.slice().reverse()) {
    if (!/(complete|完成设计规则检查)/i.test(line)) continue;
    const nums = [...line.matchAll(/\\d+/g)].map(m => Number(m[0]));
    if (nums.length >= 4) {
      const [fatal, errors, warnings, info] = nums.slice(-4);
      return { fatal, errors, warnings, info };
    }
  }
  return null;
}
function parseItems(lines) {
  const out = [];
  for (const line of lines) {
    if (/开始设计规则检查|完成设计规则检查|start.*design.*rule.*check|complete.*design.*rule.*check/i.test(line)) continue;
    const m = line.match(/^\\[([^\\]]+)\\]\\s*[:：]?\\s*(.*)$/);
    if (!m || !m[2]) continue;
    out.push({ level: normalizeLevel(m[1]), rawLevel: m[1], msg: m[2] });
  }
  return out;
}
const strictPass = await eda.sch_Drc.check(true, true, true);
await sleep(2200);
const text = (globalThis.document && document.body && document.body.innerText) ? document.body.innerText : '';
const lines = lastRunLines(text.split(/\\n+/).map(s => s.trim()).filter(Boolean));
const counts = parseCompletion(lines);
if (!counts) return { ok: false, errors: 1, warnings: 0, info: 0, strictPass: false, counts: null, items: [{ level: 'error', msg: 'DRC completion summary not found' }], source: 'direct-check' };
const items = parseItems(lines).slice(-120);
const itemErrors = items.filter(x => x.level === 'fatal' || x.level === 'error').length;
const itemWarnings = items.filter(x => x.level === 'warning').length;
return {
  ok: true,
  strictPass: strictPass === true && counts.fatal === 0 && counts.errors === 0 && counts.warnings === 0 && counts.info === 0,
  errors: Math.max(counts.fatal + counts.errors, itemErrors),
  warnings: Math.max(counts.warnings, itemWarnings),
  info: counts.info,
  counts,
  items,
  source: 'direct-check'
};
`;

export async function pullDrc() {
	try {
		const { result } = await executeCode(DRC_JS, { windowId: TARGET_WINDOW_ID, timeoutMs: 120000 });
		return result;
	} catch (e) {
		return { ok: false, strictPass: false, errors: 1, warnings: 0, info: 0, items: [{ level: 'error', msg: e?.message || 'DRC bridge failed' }], source: 'bridge-error' };
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export async function pullStableDrc({ attempts = 3, delayMs = 5000, log = console.log } = {}) {
	let last = null;
	for (let i = 0; i < attempts; i++) {
		if (i > 0) await sleep(delayMs);
		const result = await pullDrc();
		last = result;
		if (log) log(`DRC attempt ${i + 1}/${attempts}: errors=${result.errors ?? '?'} warnings=${result.warnings ?? '?'} info=${result.info ?? '?'}`);
		if (result.strictPass && !(result.errors || 0) && !(result.warnings || 0) && !(result.info || 0)) return result;
	}
	return last;
}

function normalizeDrcLevel(level) {
	const raw = String(level || '').toLowerCase();
	if (/fatal|致命/.test(raw)) return 'fatal';
	if (/error|错误|錯誤/.test(raw)) return 'error';
	if (/warn|警告/.test(raw)) return 'warning';
	if (/info|信息/.test(raw)) return 'info';
	return raw || 'unknown';
}

export function drcQC(live = null) {
	const findings = [];
	const r = live;
	if (!r) {
		findings.push({ rule: 'DRC-result-required', severity: 'hard', category: 'drc', msg: 'DRC QC requires a pulled DRC result', where: {} });
		return findings;
	}
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
