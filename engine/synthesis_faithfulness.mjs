// 合成忠实度(纯函数):验证合成模型对输入快照的跨模块电气连通保全。
//
// 几何/标签门只验产物"形态干净"(正交、无穿体、无标签互压),不验"是否还连得对"。
// 本检查补这一缺失轴:合成把跨模块连通表示为「同名网标」(EDA 网名连通),所以
// 每个跨模块信号网(其 placed 脚落在 ≥2 个契约模块)必须在输出有 ≥2 个同名网标,
// 否则跨模块靠同名标签重连的连通在产物里材质缺失 → 电气不忠实(门干净但接错)。
//
// 范围之外(不误报):
//   - 单端网(placed 集仅 1 个脚):无跨模块连通可丢。
//   - 模块内网(placed 脚全在同一模块):靠模块内物理线/同名标签,非跨模块重连范畴。
//   - 电源/地网:走 power/gnd 符号,不在信号标签口径。

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));

export function synthesisFaithfulness({ logical, contract, model } = {}) {
	if (!logical || !Array.isArray(logical.nets)) throw new TypeError('synthesisFaithfulness: logical.nets required');
	if (!contract || !Array.isArray(contract.modules)) throw new TypeError('synthesisFaithfulness: contract.modules required');
	if (!model || !Array.isArray(model.components)) throw new TypeError('synthesisFaithfulness: model.components required');

	const placed = new Set(model.components.map(c => c.designator));
	const modOfRef = new Map();
	for (const m of contract.modules) for (const ref of (m.parts || [])) modOfRef.set(ref, m.id);
	const labelCount = new Map();
	for (const f of (model.netflags || [])) if (f.net) labelCount.set(f.net, (labelCount.get(f.net) || 0) + 1);

	const findings = [];
	for (const net of logical.nets) {
		if (net.class !== 'signal') continue;
		const placedRefs = [...new Set((net.pins || []).map(refOfPin))].filter(r => placed.has(r));
		if (placedRefs.length < 2) continue;                              // 单端→无连通可丢
		const mods = new Set(placedRefs.map(r => modOfRef.get(r)).filter(Boolean));
		if (mods.size < 2) continue;                                      // 模块内→非跨模块范畴
		const got = labelCount.get(net.name) || 0;
		if (got < 2) {
			findings.push({
				rule: 'F1-cross-module-unreconnectable', severity: 'hard', category: 'faithfulness',
				msg: `跨模块信号网 ${net.name} 落在 ${mods.size} 模块,输出仅 ${got} 网标(<2,无法靠同名重连)`,
				where: { net: net.name, modules: mods.size, labels: got },
			});
		}
	}
	return findings;
}
