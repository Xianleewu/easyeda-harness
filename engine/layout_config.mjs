// 布局可调参数（harness 搜索空间，AI 无关）
export const layoutTune = {
	esc_gap: 18,
	stub_len: 40,
	label_row_gap: 20,
};

export function applyTune(actions) {
	for (const a of actions) {
		if (a.op !== 'tune' || !(a.key in layoutTune)) continue;
		layoutTune[a.key] = Math.max(8, Math.min(120, layoutTune[a.key] + a.delta));
	}
}

export function cloneTune() {
	return { ...layoutTune };
}
