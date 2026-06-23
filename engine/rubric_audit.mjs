/* rubric_audit.mjs — 审计规则文档是否含特定电路偶合内容(零特定电路铁律守门)。 */
import { readFile } from 'node:fs/promises';

/* 通用指纹:具体器件型号、典型私有网名模式(大写+下划线+功能后缀)、已知 demo 名。 */
const FINGERPRINTS = [
	/\bAMS1117\b/i,
	/\bAO3400\w*/i,
	/\bESP32\w*/i,
	/\bESP8266\b/i,
	/\bRK3576\b/i,
	/\bRK806\w*/i,
	/\bvibe[-_]?buddy\b/i,
	/\baihwdebugger\b/i,
	/\bVCC3V3_\w+/,
	/\bVDD_CPU\w*/,
	/\bWIFI_SDIO_\w+/,
];

export function scanSpecificContent(text) {
	const hits = [];
	for (const re of FINGERPRINTS) {
		const m = String(text || '').match(re);
		if (m) hits.push(m[0]);
	}
	return hits;
}

export async function auditRuleDocs(paths) {
	const out = [];
	for (const p of paths) {
		const text = await readFile(p, 'utf8').catch(() => '');
		out.push({ file: p, hits: scanSpecificContent(text) });
	}
	return out;
}
