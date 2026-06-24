/* 模型→「EDA 会怎么画」的忠实几何孪生(零特定电路)。从快照反解本地几何,按 model 新放置正算。
 * 输出与 bridge_windows.readGeometry 同形 → 直接喂 token_conformance.judgeTokens。 */
import { placePin, placeBBox, localOffset, inverseBBox } from './eda_transform.mjs';

export function twinPredict(model, snapshot) {
	const byDes = new Map((snapshot.components || []).map(c => [c.designator, c]));
	const components = [];
	for (const c of model.components || []) {
		const s = byDes.get(c.designator);
		if (!s) throw new Error(`twinPredict: 模型件 ${c.designator} 不在快照,无本地几何真源(fail-closed)`);
		const sr = s.rotation || 0, sm = s.mirror || false;
		/* 反解本地几何(快照捕获帧 → rot0/mirror-false 相对原点) */
		const localPins = (s.pins || []).map(p => { const [lx, ly] = localOffset(p.x, p.y, s.x, s.y, sr, sm); return { num: p.num, name: p.name, type: p.type, noConnected: !!p.noConnected, ldx: lx, ldy: ly }; });
		const localBody = s.bbox ? inverseBBox(s.bbox, s.x, s.y, sr, sm) : null;
		const localAttrs = (s.attrs || []).map(a => { const [lx, ly] = localOffset(a.x, a.y, s.x, s.y, sr, sm); const lb = a.bbox ? inverseBBox(a.bbox, s.x, s.y, sr, sm) : null; return { key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible, ldx: lx, ldy: ly, lbbox: lb }; });
		/* 按 model 新放置正算 */
		const rot = c.rotation || 0, mir = c.mirror || false;
		const pins = localPins.map(p => { const [gx, gy] = placePin(p.ldx, p.ldy, c.x, c.y, rot, mir); return { num: p.num, name: p.name, type: p.type, noConnected: p.noConnected, x: gx, y: gy }; });
		const bbox = localBody ? placeBBox(localBody, c.x, c.y, rot, mir) : null;
		const attrs = localAttrs.map(a => { const [gx, gy] = placePin(a.ldx, a.ldy, c.x, c.y, rot, mir); return { key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible, x: gx, y: gy, bbox: a.lbbox ? placeBBox(a.lbbox, c.x, c.y, rot, mir) : null }; });
		components.push({ designator: c.designator, x: c.x, y: c.y, rotation: rot, mirror: mir, bbox, pins, attrs });
	}
	return { components, wires: model.wires || [], netflags: model.netflags || [], texts: model.texts || [], rectangles: model.rectangles || [] };
}
