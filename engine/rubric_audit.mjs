/* rubric_audit.mjs — 审计规则文档是否含特定电路偶合内容(零特定电路铁律守门)。 */
import { readFile } from 'node:fs/promises';

/* 用上下文和词形识别项目字面量，不在公共工具里维护项目或料号黑名单。 */
const FINGERPRINTS = [
	/\b(?:device|part|model)\s*[:=]?\s*([A-Z][A-Z0-9.-]*\d{2,}[A-Z0-9.-]*)\b/gi,
	/\bnet\s*[:=]?\s*([A-Z][A-Z0-9]*_[A-Z0-9_]{3,})\b/g,
	/\bproject\s*[:=]\s*([A-Za-z][A-Za-z0-9_-]{3,})\b/gi,
];

export function scanSpecificContent(text) {
	const hits = [];
	for (const re of FINGERPRINTS) {
		re.lastIndex = 0;
		for (const m of String(text || '').matchAll(re)) hits.push(m[1] || m[0]);
	}
	return [...new Set(hits)];
}

export async function auditRuleDocs(paths) {
	const out = [];
	for (const p of paths) {
		const text = await readFile(p, 'utf8').catch(() => '');
		out.push({ file: p, hits: scanSpecificContent(text) });
	}
	return out;
}
