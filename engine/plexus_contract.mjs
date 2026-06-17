// Plexus 合成契约 CLI:快照 → 抽取 → 角色 → 合成契约 + 自洽校验 → 报告(只读)。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract, contractQC } from './design_contract.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const REPORT = process.env.PLEXUS_CONTRACT_REPORT || `${ROOT}/plexus_contract_report.json`;

export function runPlexusContract() {
	if (!existsSync(LIVE)) {
		return { ok: false, error: `快照缺失：${LIVE}（先跑 plexus live:save / audit 拉快照）` };
	}
	const snap = JSON.parse(readFileSync(LIVE, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const roles = inferRoles(logical);
	const contract = synthesizeContract(roles, logical);
	const findings = contractQC(contract);
	return { ok: true, contract, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const r = runPlexusContract();
	if (!r.ok) { console.error(r.error); process.exit(2); }
	const hard = r.findings.filter(f => f.severity === 'hard');
	writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2), 'utf8');
	console.log(`Plexus 合成契约:列=${r.contract.columns.length} 模块=${r.contract.meta.moduleCount} 标签=${r.contract.labelColumns.length} hard=${hard.length}`);
	for (const f of hard) console.log(`  [hard] ${f.rule} ${f.message}`);
	console.log(`report -> ${REPORT}`);
	process.exit(hard.length ? 1 : 0);
}
