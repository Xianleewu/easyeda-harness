// 每个引脚必须有导线顶点精确落点（EDA 连通要求）
import { dedupeSegs } from './svg.mjs';

const TOL = 0.01;

function distPtSeg(px, py, a, b) {
	const ax = a[0], ay = a[1], bx = b[0], by = b[1];
	const dx = bx - ax, dy = by - ay;
	if (dx === 0 && dy === 0)
		return Math.hypot(px - ax, py - ay);
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
	const qx = ax + t * dx, qy = ay + t * dy;
	return Math.hypot(px - qx, py - qy);
}

function wireVerts(model) {
	const out = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i < l.length; i += 2) out.push([l[i], l[i + 1]]);
		for (const [a, b] of dedupeSegs(l)) {
			out.push(a, b);
		}
	}
	return out;
}

export function pinWireGapQC(model) {
	const findings = [];
	const verts = wireVerts(model);
	const nearVert = (px, py) => verts.some(([vx, vy]) =>
		Math.hypot(px - vx, py - vy) <= TOL);

	for (const c of model.components || []) {
		for (const p of c.pins || []) {
			if (p.noConnected) continue;
			if (nearVert(p.x, p.y)) continue;
			let best = Infinity;
			for (const w of model.wires || []) {
				for (const [a, b] of dedupeSegs(w.line || []))
					best = Math.min(best, distPtSeg(p.x, p.y, a, b));
			}
			findings.push({ rule: 'E3-pin-wire-gap', severity: 'hard', category: 'electrical',
				msg: `引脚 ${c.designator}.${p.num} 无导线落点 gap=${best.toFixed(2)}`,
				where: { ref: `${c.designator}.${p.num}`, x: p.x, y: p.y, gap: best } });
		}
	}
	return findings;
}
