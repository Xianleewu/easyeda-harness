import { CONFIG } from '../config.mjs';
import { shrinkRect, ptInRect, samePt } from '../model.mjs';

// C3 方向/镜像：导线从器件自身引脚进入了自身符号体（说明符号方向/镜像反了）
export function c3Orientation(m) {
	const F = [];
	for (const p of m.parts) {
		const r = shrinkRect(p.bbox, CONFIG.body.shrink);
		if (r.maxX <= r.minX || r.maxY <= r.minY) continue;
		const wrongPins = [];
		for (const pin of p.pins || []) {
			// 引脚越过哪条 bbox 边 => 该轴为出线主轴（更稳，避免竖排引脚误报）
			const over = [
				['L', p.bbox.minX - pin.x, [-1, 0]],
				['R', pin.x - p.bbox.maxX, [1, 0]],
				['T', p.bbox.minY - pin.y, [0, -1]],
				['B', pin.y - p.bbox.maxY, [0, 1]],
			].sort((a, b) => b[1] - a[1])[0];
			if (over[1] < -CONFIG.body.shrink) continue; // 引脚在体内部，方向不明确，跳过
			const [ox, oy] = over[2];
			let inward = false, intoBody = false;
			for (const s of m.segments) {
				let far = null;
				if (samePt(s.x1, s.y1, pin.x, pin.y)) far = [s.x2, s.y2];
				else if (samePt(s.x2, s.y2, pin.x, pin.y)) far = [s.x1, s.y1];
				if (!far) continue;
				const dot = (far[0] - pin.x) * ox + (far[1] - pin.y) * oy; // <0 => 沿主轴朝体内出线
				if (dot < -1e-6) inward = true;
				if (ptInRect(far[0], far[1], r)) intoBody = true;
			}
			if (intoBody || inward) wrongPins.push({ pin: pin.name, at: [pin.x, pin.y], intoBody });
		}
		if (wrongPins.length) {
			F.push({ rule: 'C3.1-mirror-suspect', severity: 'hard', category: 'orientation',
				msg: `${p.designator}(${p.name}) 有 ${wrongPins.length} 个引脚的导线朝符号体内侧出线，疑似镜像/旋转方向反了: ${wrongPins.map(w => w.pin).join(',')}`,
				where: { designator: p.designator, rotation: p.rotation, mirror: p.mirror, wrongPins } });
		}
	}
	return F;
}
