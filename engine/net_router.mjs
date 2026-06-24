/* 真·正交网络路由器(零特定电路内容)。分级寻路 + 多脚 MST + union-find 连通保全。 */
import { segThruBox, segThruPoint, segConflict, mstEdges } from './route_geom.mjs';

/*
 * 候选顶点数组每段是否干净:正交 + 不穿件体 + 不穿异网脚 + 不与异网线冲突。
 */
function pathClean(line, net, ctx) {
	for (let i = 0; i + 3 < line.length; i += 2) {
		const a = [line[i], line[i + 1]], b = [line[i + 2], line[i + 3]];
		if (a[0] !== b[0] && a[1] !== b[1]) return false;
		if (segThruBox(a, b, ctx.boxes)) return false;
		if (segThruPoint(a, b, ctx.otherPins)) return false;
		if (segConflict(a, b, net, ctx.occupancy)) return false;
	}
	return true;
}

/*
 * 分级:direct → L → Z(竖中线多 x 位 + 横中线多 y 位,含偏移=绕行)。返回 line[] 或 null。
 */
export function routeEdge(a, b, net, ctx, opts = {}) {
	const maxSpan = opts.maxSpan ?? 600, maxBends = opts.maxBends ?? 2;
	if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > maxSpan) return null;
	const ok = line => pathClean(line, net, ctx) ? line : null;
	if (a.x === b.x || a.y === b.y) { const p = ok([a.x, a.y, b.x, b.y]); if (p) return p; }
	for (const c of [[b.x, a.y], [a.x, b.y]]) { const p = ok([a.x, a.y, c[0], c[1], b.x, b.y]); if (p) return p; }
	if (maxBends >= 2) {
		const mid = (u, v) => Math.round((u + v) / 2);
		const xs = [mid(a.x, b.x), a.x + 60, a.x - 60, b.x + 60, b.x - 60, a.x + 120, a.x - 120];
		for (const mx of xs) { const p = ok([a.x, a.y, mx, a.y, mx, b.y, b.x, b.y]); if (p) return p; }
		const ys = [mid(a.y, b.y), a.y + 60, a.y - 60, b.y + 60, b.y - 60, a.y + 120, a.y - 120];
		for (const my of ys) { const p = ok([a.x, a.y, a.x, my, b.x, my, b.x, b.y]); if (p) return p; }
	}
	return null;
}
