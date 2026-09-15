/* 共享几何:从快照件【反解】本地几何(rot0/mirror-false 基准),并按新放置【正算】全局几何。
 * eda_twin(预测裁判几何)与 structured_layout(构造布局)共用此模块 —— 保证"放置后几何"
 * 两边逐位一致,零漂移。复用 eda_transform 的实测变换原语(placePin/placeBBox/localOffset/inverseBBox)。
 * 零特定电路内容。 */
import { placePin, placeBBox, localOffset, inverseBBox } from './eda_transform.mjs';

/* 快照件 → 本地几何。s 含 x,y,rotation,mirror,bbox,pins[{num,name,type,x,y,noConnected}],
 * attrs[{key,value,keyVisible,valueVisible,x,y,bbox}]。返回 {localPins, localBody, localAttrs}。 */
export function localGeom(s) {
	const sr = s.rotation || 0, sm = s.mirror || false;
	const localPins = (s.pins || []).map(p => {
		const [lx, ly] = localOffset(p.x, p.y, s.x, s.y, sr, sm);
		return { num: p.num, name: p.name, type: p.type, noConnected: !!p.noConnected, ldx: lx, ldy: ly };
	});
	const localBody = s.bbox ? inverseBBox(s.bbox, s.x, s.y, sr, sm) : null;
	const localAttrs = (s.attrs || []).map(a => {
		const [lx, ly] = localOffset(a.x, a.y, s.x, s.y, sr, sm);
		const lb = a.bbox ? inverseBBox(a.bbox, s.x, s.y, sr, sm) : null;
		return {
			key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible,
			ldx: lx, ldy: ly, lbbox: lb,
		};
	});
	return { localPins, localBody, localAttrs };
}

/* 本地几何 + 放置 (x,y,rotation,mirror) → 全局 {pins, bbox, attrs}(attr 在默认放置位)。 */
export function placeGeom(lg, x, y, rotation = 0, mirror = false) {
	const rot = rotation || 0, mir = mirror || false;
	/* 旋转算术会引入浮点噪声(如 130→129.99999999999977),EDA 坐标本为整数 → 脚坐标取整,
	 * 使 T-GRID(脚 %grid)按真实整数判,不被 FP 噪声误伤。 */
	const pins = lg.localPins.map(p => {
		const [gx, gy] = placePin(p.ldx, p.ldy, x, y, rot, mir);
		return { num: p.num, name: p.name, type: p.type, noConnected: p.noConnected, x: Math.round(gx), y: Math.round(gy) };
	});
	const bbox = lg.localBody ? placeBBox(lg.localBody, x, y, rot, mir) : null;
	const attrs = lg.localAttrs.map(a => {
		const [gx, gy] = placePin(a.ldx, a.ldy, x, y, rot, mir);
		/* 文本标注 bbox【不随件旋转】(实测:同一 attr 在 rot0/rot90 的 w/h 不变、始终水平;只有件体 bbox 旋转 w/h 交换)。
		 * → 保持本地 w/h,仅让 bbox 中心随件旋转/镜像移动到放置位(否则旋转件的 Name 被预测成竖条、漏判横向重叠)。 */
		let bb = null;
		if (a.lbbox) {
			const w = a.lbbox.maxX - a.lbbox.minX, h = a.lbbox.maxY - a.lbbox.minY;
			const lcx = (a.lbbox.minX + a.lbbox.maxX) / 2, lcy = (a.lbbox.minY + a.lbbox.maxY) / 2;
			const [pcx, pcy] = placePin(lcx, lcy, x, y, rot, mir);
			bb = { minX: pcx - w / 2, minY: pcy - h / 2, maxX: pcx + w / 2, maxY: pcy + h / 2 };
		}
		return { key: a.key, value: a.value, keyVisible: a.keyVisible, valueVisible: a.valueVisible, x: gx, y: gy, bbox: bb };
	});
	return { pins, bbox, attrs };
}
