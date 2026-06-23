// 裁判 harness:取证(桥)→ 打分(纯)→ 证据化报告。零特定电路内容(报告只含匿名规则+证据路径)。
import { scoreAll } from './commercial_rubric.mjs';

export function judgeBoard(model, { drc, shots = [] } = {}) {
	const s = scoreAll(model, { drc });
	const summary = `block 失败 ${s.blockFail} / flag 失败 ${s.flagFail} / 商用达标=${s.commercialPass}`;
	return { commercialPass: s.commercialPass, blockFail: s.blockFail, flagFail: s.flagFail, rules: s.rules, shots, summary };
}
