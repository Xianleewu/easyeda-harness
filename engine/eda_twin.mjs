/* 模型→「EDA 会怎么画」的忠实几何孪生(零特定电路)。从快照反解本地几何,按 model 新放置正算。
 * 输出与 bridge_windows.readGeometry 同形 → 直接喂 token_conformance.judgeTokens。
 * 反解/正算复用 local_geom(与 structured_layout 共用同一几何 → 构造与裁判逐位一致)。 */
import { fillVisibleAttrBBoxes } from './eda_transform.mjs';
import { localGeom, placeGeom } from './local_geom.mjs';

export function twinPredict(model, snapshot) {
	/* 快照 attr bbox 缺失时先兜底填充(Fix2),使 DR4/DR5 检查有数据可查。
	 * TODO(calibration): 估算 bbox 待 live 标定钉死字宽公式 */
	const filledComponents = fillVisibleAttrBBoxes(snapshot.components);
	const byDes = new Map((filledComponents || []).map(c => [c.designator, c]));
	const components = [];
	for (const c of model.components || []) {
		const s = byDes.get(c.designator);
		if (!s) throw new Error(`twinPredict: 模型件 ${c.designator} 不在快照,无本地几何真源(fail-closed)`);
		const lg = localGeom(s);
		const g = placeGeom(lg, c.x, c.y, c.rotation || 0, c.mirror || false);
		const attrs = g.attrs.map(a => {
			let x = a.x, y = a.y, bbox = a.bbox, value = a.value, valueVisible = a.valueVisible;
			/* 模型件若显式设了该标注位置(placeAnnotations 同侧件外),用它——deliver 经 setDocumentSource
			 * 能真设标注 attr x/y/value(已实证),故这是忠实预测;bbox 随位置同量平移(保字宽) */
			const m = (c.attrs || []).find(z => z.key === a.key);
			const sourceAttr = (s.attrs || []).find(z => z.key === a.key);
			/* model 给定人读值(无源件 Name 由"={Value}"填实值)→ twin 用之(投递侧 source_deliver 同样发 model value),否则尺子判 formula 永不过 */
			const valOverridden = m && m.value != null && m.value !== '' && m.value !== value;
			if (m && m.value != null && m.value !== '') value = m.value;
			if (m && m.valueVisible) valueVisible = true;
			if ((a.key === 'Designator' || a.key === 'Name') && m && Number.isFinite(m.x) && Number.isFinite(m.y)) {
				/* Source delivery changes an ATTR's own x/y but preserves its rotation.  A
				 * component rotation therefore must not rotate an explicitly positioned
				 * annotation's width/height.  Read those dimensions from the captured
				 * source annotation, which is the live renderer's measured truth. */
				const measured = sourceAttr?.bbox;
				const w = measured ? measured.maxX - measured.minX : bbox ? bbox.maxX - bbox.minX : 0;
				const h = measured ? measured.maxY - measured.minY : bbox ? bbox.maxY - bbox.minY : 0;
				x = m.x; y = m.y;
				if (bbox || measured) bbox = { minX: m.x, minY: m.y, maxX: m.x + w, maxY: m.y + h };
			}
			/* ★值被【真值】覆盖(≠快照"={Value}"占位)→ 字框宽按真值字数重算(快照宽是占位符宽,不重算 twin
			 *   宽度比 live 宽近一倍 → 假撞/假穿);左缘锚定不动,只改右缘。CW=live 标定组件 attr 字符宽(22uF=16/4,
			 *   100nF=20/5,C24=13/3 → ~4.2)。仅覆盖时重算 → 不动合成夹具/未改值 attr。 */
			if (valOverridden && bbox) {
				const ATTR_CW = 4.2;
				bbox = { ...bbox, maxX: bbox.minX + Math.max(1, String(value).length) * ATTR_CW };
			}
			return { key: a.key, value, keyVisible: a.keyVisible, valueVisible, x, y, bbox };
		});
		components.push({ designator: c.designator, x: c.x, y: c.y, rotation: c.rotation || 0, mirror: c.mirror || false, bbox: g.bbox, pins: g.pins, attrs });
	}
	return {
		components, wires: model.wires || [], netflags: model.netflags || [],
		texts: model.texts || [], rectangles: model.rectangles || [],
		moduleRegions: model.moduleRegions || [], cellRegions: model.cellRegions || [],
	};
}
