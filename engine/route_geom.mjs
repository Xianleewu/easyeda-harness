/* 纯几何/图原语,供 net_router 用(零特定电路内容)。轴向段 a/b=[x,y]。 */

/* 段是否穿过任一 box 内部(端点贴边不算;margin 收防贴边误判)。 */
export function segThruBox(a, b, boxes, margin = 1) {
	const [x1, y1] = a, [x2, y2] = b;
	for (const r of boxes || []) {
		if (!r) continue;
		if (x1 === x2) {
			if (x1 > r.minX + margin && x1 < r.maxX - margin) {
				const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
				if (lo < r.maxY - margin && hi > r.minY + margin) return true;
			}
		} else if (y1 === y2) {
			if (y1 > r.minY + margin && y1 < r.maxY - margin) {
				const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
				if (lo < r.maxX - margin && hi > r.minX + margin) return true;
			}
		}
	}
	return false;
}

/* 段是否穿过任一点内部(端点不算;tol 容差)。用于避开异网脚。 */
export function segThruPoint(a, b, points, tol = 1) {
	const [x1, y1] = a, [x2, y2] = b;
	for (const p of points || []) {
		const px = p[0], py = p[1];
		if ((px === x1 && py === y1) || (px === x2 && py === y2)) continue;
		if (x1 === x2) { if (Math.abs(px - x1) <= tol && py > Math.min(y1, y2) + tol && py < Math.max(y1, y2) - tol) return true; }
		else if (y1 === y2) { if (Math.abs(py - y1) <= tol && px > Math.min(x1, x2) + tol && px < Math.max(x1, x2) - tol) return true; }
	}
	return false;
}

/* 两轴向段是否有公共点(相交/相接/重叠,inclusive)。 */
function segTouch(a1, b1, a2, b2) {
	const av = a1[0] === b1[0], ah = a1[1] === b1[1];
	const bv = a2[0] === b2[0], bh = a2[1] === b2[1];
	if ((av && bh) || (ah && bv)) {
		const v = av ? [a1, b1] : [a2, b2], h = av ? [a2, b2] : [a1, b1];
		const vx = v[0][0], vy0 = Math.min(v[0][1], v[1][1]), vy1 = Math.max(v[0][1], v[1][1]);
		const hy = h[0][1], hx0 = Math.min(h[0][0], h[1][0]), hx1 = Math.max(h[0][0], h[1][0]);
		return vx >= hx0 && vx <= hx1 && hy >= vy0 && hy <= vy1;
	}
	if (ah && bh) { if (a1[1] !== a2[1]) return false; const lo = Math.max(Math.min(a1[0], b1[0]), Math.min(a2[0], b2[0])), hi = Math.min(Math.max(a1[0], b1[0]), Math.max(a2[0], b2[0])); return hi >= lo; }
	if (av && bv) { if (a1[0] !== a2[0]) return false; const lo = Math.max(Math.min(a1[1], b1[1]), Math.min(a2[1], b2[1])), hi = Math.min(Math.max(a1[1], b1[1]), Math.max(a2[1], b2[1])); return hi >= lo; }
	return false;
}

/* 候选段(net)与已布线段集是否冲突:异网共享任一点(DR2 异网不交叉不相接)。 */
export function segConflict(a, b, net, segments) {
	for (const s of segments || []) {
		if ((s.net || '') === (net || '')) continue;
		if (segTouch(a, b, s.a, s.b)) return true;
	}
	return false;
}

/* Prim 最小生成树(曼哈顿),points=[{x,y}],返回边索引对 [[i,j],...](确定性:平局取小 j)。 */
export function mstEdges(points) {
	const n = (points || []).length; if (n < 2) return [];
	const inTree = new Array(n).fill(false); inTree[0] = true;
	const edges = [];
	for (let k = 1; k < n; k++) {
		let bi = -1, bj = -1, bd = Infinity;
		for (let i = 0; i < n; i++) {
			if (!inTree[i]) continue;
			for (let j = 0; j < n; j++) {
				if (inTree[j]) continue;
				const d = Math.abs(points[i].x - points[j].x) + Math.abs(points[i].y - points[j].y);
				if (d < bd || (d === bd && (bj < 0 || j < bj))) { bd = d; bi = i; bj = j; }
			}
		}
		if (bj < 0) break;
		inTree[bj] = true; edges.push([bi, bj]);
	}
	return edges;
}
