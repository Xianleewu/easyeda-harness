/* 钉死孪生:对照 twinPredict 预测几何 与 真 EDA readGeometry。纯对照逻辑(live 投递/读由 live_loop+控制者跑)。 */
import { geomQC } from './geom_qc.mjs';

function maxCornerErr(a, b) {
	if (!a || !b) return Infinity;
	return Math.max(Math.abs(a.minX - b.minX), Math.abs(a.minY - b.minY), Math.abs(a.maxX - b.maxX), Math.abs(a.maxY - b.maxY));
}

export function compareGeom(predicted, actual, opts = {}) {
	const tol = opts.tol ?? 2;
	const aByDes = new Map((actual.components || []).map(c => [c.designator, c]));
	let maxPinErr = 0, maxBBoxErr = 0, maxAttrErr = 0;
	for (const p of predicted.components || []) {
		const a = aByDes.get(p.designator); if (!a) { maxBBoxErr = Infinity; continue; }
		maxBBoxErr = Math.max(maxBBoxErr, maxCornerErr(p.bbox, a.bbox));
		const aPin = new Map((a.pins || []).map(q => [q.num, q]));
		for (const q of (p.pins || [])) { const r = aPin.get(q.num); if (r) maxPinErr = Math.max(maxPinErr, Math.hypot(q.x - r.x, q.y - r.y)); }
		const aAttr = new Map((a.attrs || []).map(x => [x.key, x]));
		for (const x of (p.attrs || [])) { const r = aAttr.get(x.key); if (r && x.bbox && r.bbox) maxAttrErr = Math.max(maxAttrErr, maxCornerErr(x.bbox, r.bbox)); }
	}
	/* tier2 偏离数差(用 geomQC 的几个计数代表;judge 级别由调用方按需扩) */
	const gp = geomQC(predicted), ga = geomQC(actual);
	const tokenDiff = { overlaps: Math.abs((gp.overlaps || []).length - (ga.overlaps || []).length), crossings: Math.abs((gp.crossings || 0) - (ga.crossings || 0)) };
	const conform = maxPinErr <= tol && maxBBoxErr <= tol && maxAttrErr <= tol && tokenDiff.overlaps === 0 && tokenDiff.crossings === 0;
	return { maxPinErr: +maxPinErr.toFixed(2), maxBBoxErr: maxBBoxErr === Infinity ? Infinity : +maxBBoxErr.toFixed(2), maxAttrErr: +maxAttrErr.toFixed(2), tokenDiff, conform };
}
