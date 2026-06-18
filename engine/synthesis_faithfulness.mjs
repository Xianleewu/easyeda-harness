// 合成忠实度(纯函数):验证合成模型对输入快照的跨模块电气连通保全。
//
// 几何/标签门只验产物"形态干净"(正交、无穿体、无标签互压),不验"是否还连得对"。
// 本检查补这一缺失轴:合成把跨模块连通表示为「同名网标」(EDA 网名连通)。
// 跨度按**契约模块成员**界定(非已落地集),故能抓住"模块被跳过导致连通丢失":
//   1. 跨模块信号网(脚落在 ≥2 契约模块)若有触及的模块被 planner 跳过(parts 不在
//      model.components)→ 连通在产物里断裂(F2-cross-module-module-skipped)。
//   2. 全部落地时,输出同名网标数须 ≥ 触及的模块数(逐模块各一,≥2),否则某模块界面
//      缺标签、无法逐模块按名重连(F1-cross-module-unreconnectable)。
//
// 适用全部网类:信号靠 sig 网标、电源/地靠 power/gnd 符号,都是同名连通——每个触及
// 模块的界面脚都须产 ≥1 个同名标签/符号,否则该模块脚悬空(电源/地的"全局同名"也要
// 每个模块脚各有一个符号才连得上)。真实 50/50 实测电源/地扩入零误报。
// 范围之外(不误报):
//   - 单模块网(脚全在同一契约模块):靠模块内物理线/同名标签,非跨模块重连范畴。
//   残留限界:标签按网名计数,不验"逐标签确切附着到对应模块"(见 review I3;需 flat
//   model 给标签打模块标签,属后续);"标签数≥模块数"是逐模块覆盖的必要条件。

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));

export function synthesisFaithfulness({ logical, contract, model } = {}) {
	if (!logical || !Array.isArray(logical.nets)) throw new TypeError('synthesisFaithfulness: logical.nets required');
	if (!contract || !Array.isArray(contract.modules)) throw new TypeError('synthesisFaithfulness: contract.modules required');
	if (!model || !Array.isArray(model.components)) throw new TypeError('synthesisFaithfulness: model.components required');

	const placed = new Set(model.components.map(c => c.designator));
	const modOfRef = new Map();
	const modPlaced = new Map();   // 模块落地 = 其全部 parts 都在 model.components
	for (const m of contract.modules) {
		modPlaced.set(m.id, (m.parts || []).every(r => placed.has(r)));
		for (const ref of (m.parts || [])) modOfRef.set(ref, m.id);
	}
	const labelCount = new Map();
	for (const f of (model.netflags || [])) if (f.net) labelCount.set(f.net, (labelCount.get(f.net) || 0) + 1);

	const findings = [];
	for (const net of logical.nets) {
		if (!net.name) continue;
		// 跨度按契约成员(含被跳过模块的脚),才能抓住"模块跳过 → 连通丢失"。
		const refs = [...new Set((net.pins || []).map(refOfPin))].filter(r => modOfRef.has(r));
		const mods = new Set(refs.map(r => modOfRef.get(r)));
		if (mods.size < 2) continue;                                      // 单模块→非跨模块范畴
		const skipped = [...mods].filter(id => !modPlaced.get(id));
		if (skipped.length) {
			findings.push({
				rule: 'F2-cross-module-module-skipped', severity: 'hard', category: 'faithfulness',
				msg: `跨模块网 ${net.name}(${net.class}) 触及模块 ${skipped.join(',')} 被跳过 → 连通丢失`,
				where: { net: net.name, class: net.class, skipped },
			});
			continue;
		}
		const got = labelCount.get(net.name) || 0;
		if (got < mods.size) {
			findings.push({
				rule: 'F1-cross-module-unreconnectable', severity: 'hard', category: 'faithfulness',
				msg: `跨模块网 ${net.name}(${net.class}) 落在 ${mods.size} 模块,输出仅 ${got} 标签/符号(<模块数,某界面缺标签无法逐模块重连)`,
				where: { net: net.name, class: net.class, modules: mods.size, labels: got },
			});
		}
	}
	return findings;
}
