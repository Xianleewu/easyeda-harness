// Plexus 合成 CLI:快照 → 抽取 → 角色 → 契约 → 布局(带 logical)→ 几何/标签判决 → 报告(只读)。
// 把 extract→infer→synthesizeContract→planLayout 整条合成链跑在 live.json 上,
// 报告落地/跳过模块 + 组装模型几何/标签实况。只读,不写回工程文件。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { wireConnectivity } from './wire_connectivity.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const REPORT = process.env.PLEXUS_SYNTHESIZE_REPORT || `${ROOT}/plexus_synthesize_report.json`;

export function runPlexusSynthesize() {
	if (!existsSync(LIVE)) {
		return { ok: false, error: `快照缺失：${LIVE}（先跑 plexus live:save / audit 拉快照）` };
	}
	const snap = JSON.parse(readFileSync(LIVE, 'utf8').replace(/^﻿/, ''));
	const logical = extractLogical(snap);
	const roles = inferRoles(logical);
	const contract = synthesizeContract(roles, logical);
	const byDes = new Map((snap.components || []).map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });
	const g = geomQC(r.model);
	const g5 = geomQC(r.model, { grid: 5 });   // 真实件多在 5-栅:grid=5 的 offgrid 反映合成几何真实清白度
	const labelHard = labelQC(r.model).filter(f => f.severity === 'hard').length;
	const faith = synthesisFaithfulness({ logical, contract, model: r.model });
	const faithHard = faith.filter(f => f.severity === 'hard');
	const conn = wireConnectivity({ model: r.model, logical });
	const connHard = conn.filter(f => f.severity === 'hard');

	const skipByReason = {};
	for (const s of r.skipped) skipByReason[s.reason] = (skipByReason[s.reason] || 0) + 1;

	return {
		ok: true,
		controller: roles.controller,
		modules: contract.modules.length,
		placed: r.placed.length,
		skipped: r.skipped.length,
		skipByReason,
		model: { components: r.model.components.length, wires: r.model.wires.length, flags: r.model.netflags.length },
		geom: { overlaps: g.overlaps.length, wireThruComp: g.wireThruComp.length, wireThruPin: g.wireThruPin.length, offgrid: g.offgrid, offgrid5: g5.offgrid, crossings: g.crossings, collinear: g.collinear },
		labelHard,
		faithHard: faithHard.length,
		faithFindings: faithHard.slice(0, 8),
		connHard: connHard.length,
		connFindings: connHard.slice(0, 8),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = runPlexusSynthesize();
	if (!out.ok) { console.error(out.error); process.exit(2); }
	// 硬判:重叠/线穿件/线压外部脚/异网交叉/共线异网短路/标签硬伤/跨模块连通丢失/导线连通断为 0 才过门(offgrid 暂列软)。
	const hard = out.geom.overlaps + out.geom.wireThruComp + out.geom.wireThruPin + out.geom.crossings + out.geom.collinear + out.labelHard + out.faithHard + out.connHard;
	writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ...out }, null, 2), 'utf8');
	console.log(`Plexus 合成:placed=${out.placed}/${out.modules} wires=${out.model.wires} flags=${out.model.flags}`
		+ ` | geom overlaps=${out.geom.overlaps} wireThruComp=${out.geom.wireThruComp} wireThruPin=${out.geom.wireThruPin} crossings=${out.geom.crossings} collinear=${out.geom.collinear} labelHard=${out.labelHard} faithHard=${out.faithHard} connHard=${out.connHard}`
		+ ` | offgrid=${out.geom.offgrid}@10栅 ${out.geom.offgrid5}@5栅(器件原生栅)`);
	console.log(`report -> ${REPORT}`);
	process.exit(hard ? 1 : 0);
}
