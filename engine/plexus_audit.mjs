// Plexus 六支柱设计语言审计编排：快照 → 抽取 → 角色 → 六支柱 → 报告。
// 对任意已连接原理图(live.json)给出机械、可量的设计语言遵守度判决。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { auditPillars } from './design_pillars.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const REPORT = process.env.PLEXUS_AUDIT_REPORT || `${ROOT}/plexus_audit_report.json`;

export function runPlexusAudit() {
	if (!existsSync(LIVE)) {
		return { ok: false, error: `快照缺失：${LIVE}（先跑 plexus live:save / live:audit 拉快照）` };
	}
	const snap = JSON.parse(readFileSync(LIVE, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const roles = inferRoles(logical);
	const audit = auditPillars(snap, { geom: geomQC(snap), labels: labelQC(snap), roles, logical });
	return { ok: true, controller: roles.controller, logical: logical.stats, modules: roles.modules.length, audit };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const r = runPlexusAudit();
	if (!r.ok) { console.error(r.error); process.exit(2); }
	const out = { generatedAt: new Date().toISOString(), ...r };
	writeFileSync(REPORT, JSON.stringify(out, null, 2), 'utf8');
	console.log(`Plexus 六支柱审计: ${r.audit.verdict}  ${r.audit.totalScore}/${r.audit.maxScore}  控制器=${r.controller}  模块=${r.modules}`);
	for (const p of r.audit.pillars) {
		const s = p.score == null ? ' -' : `${p.score}/4`;
		console.log(`  [${p.verdict.padEnd(7)}] ${s}  ${p.name}${p.findings.length ? ' — ' + p.findings.join('; ') : ''}`);
	}
	console.log(`report -> ${REPORT}`);
	process.exit(r.audit.verdict === 'APPROVED' ? 0 : 1);
}
