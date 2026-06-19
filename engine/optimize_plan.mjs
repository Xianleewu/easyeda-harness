// 把分类结果 + 决策合成动作计划（纯函数）
//
// 三个桶：
//   actions  可直接经 gated 写路径执行（删网标 / 加 NC / 重绑标准件）
//   flagged  需人工或后续布线解决，绝不自动猜（漏连补线需目标网）
//   pending  仍缺决策/缺 resolver 结果，等下一轮交互或查库
//
// decisions: { [ref]: 'nc' | 'wire' | 'skip' | { standardPart } }
//   悬空引脚 → 'nc'(加非连接标识) / 'wire'(确认漏连) / 'skip'(本轮不动)
//   器件标准化 → { standardPart } 由 resolver 查库或人工选型给出

const WIRE_NOTE = '确认漏连：需指定目标网/由布线解决，不自动猜';

export function buildPlan(classified, decisions = {}) {
	const actions = [];
	const flagged = [];
	const pending = [];

	for (const item of classified || []) {
		const { disposition, ref, kind, category, detail } = item;

		if (disposition === 'skip') continue;

		if (disposition === 'auto') {
			if (kind === 'delete-net-label') {
				actions.push({ kind, ref, op: 'delete-net-label', category });
			}
			continue;
		}

		if (disposition === 'ask') {
			const decision = decisions[ref];
			if (decision === 'nc') {
				actions.push({ kind, ref, op: 'add-noconnect', category });
			} else if (decision === 'wire') {
				flagged.push({ kind, ref, op: 'manual-connect-required', category, note: WIRE_NOTE });
			} else if (decision === 'skip') {
				/* 本轮不动 */
			} else {
				pending.push({ ...item });
			}
			continue;
		}

		if (disposition === 'resolve') {
			const decision = decisions[ref];
			if (decision && decision.standardPart) {
				actions.push({ kind, ref, op: 'rebind-device', category, detail, params: { standardPart: decision.standardPart } });
			} else {
				pending.push({ ...item });
			}
			continue;
		}
	}

	const summary = { actions: actions.length, flagged: flagged.length, pending: pending.length, total: actions.length + flagged.length + pending.length };
	return { actions, flagged, pending, summary };
}
