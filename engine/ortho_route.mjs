// 正交点到点避障布线器(物理布线引擎基石)。
// Hanan 稀疏网格(端点 + 障碍边坐标)上跑带转弯惩罚的 Dijkstra:产出正交、避障、
// 少拐弯的干净路径。无解返回 null(不抛)。纯函数、确定性。
//
// 用途:把"每脚扇出网标"换成"连接引脚间的物理正交连线"(像工程师画图)。

const TURN = 30;   // 转弯惩罚(相对长度;偏好少拐弯的直路)

// 轴向线段是否穿过矩形内部(端点/贴边不算,与 geomQC segInRect 同口径)。
function segHitsRect(ax, ay, bx, by, r) {
	if (ax === bx) {
		const x = ax; if (x <= r.minX || x >= r.maxX) return false;
		const y0 = Math.min(ay, by), y1 = Math.max(ay, by); return y0 < r.maxY && y1 > r.minY;
	}
	const y = ay; if (y <= r.minY || y >= r.maxY) return false;
	const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx); return x0 < r.maxX && x1 > r.minX;
}
const segFree = (ax, ay, bx, by, obs) => !obs.some(r => segHitsRect(ax, ay, bx, by, r));

const uniqSorted = arr => [...new Set(arr)].sort((a, b) => a - b);

export function routePath(a, b, obstacles = [], opts = {}) {
	const obs = obstacles || [];
	const clr = Number.isFinite(opts.clearance) ? opts.clearance : 0;
	// Hanan 网格线:端点 + 障碍边(带净空,绕到障碍外侧)。
	const xs = uniqSorted([a[0], b[0], ...obs.flatMap(r => [r.minX - clr, r.maxX + clr])]);
	const ys = uniqSorted([a[1], b[1], ...obs.flatMap(r => [r.minY - clr, r.maxY + clr])]);
	const nx = xs.length, ny = ys.length;
	const xi = new Map(xs.map((v, i) => [v, i])), yi = new Map(ys.map((v, i) => [v, i]));
	const ax = xi.get(a[0]), ay = yi.get(a[1]), bx = xi.get(b[0]), by = yi.get(b[1]);
	if (ax == null || ay == null || bx == null || by == null) return null;

	const nodeId = (i, j) => j * nx + i;
	const N = nx * ny;
	// 状态:nodeId × 入向(0=H,1=V)。起点入向用 2(无).
	const cost = new Float64Array(N * 3).fill(Infinity);
	const prev = new Int32Array(N * 3).fill(-1);
	const sIdx = nodeId(ax, ay) * 3 + 2;
	cost[sIdx] = 0;
	// 简易 Dijkstra(网格小,用线性扫描选最小;状态数 = 3N)。
	const done = new Uint8Array(N * 3);
	const pq = [[0, sIdx]];
	const push = (c, s) => { pq.push([c, s]); };
	while (pq.length) {
		let mi = 0; for (let k = 1; k < pq.length; k++) if (pq[k][0] < pq[mi][0]) mi = k;
		const [c, s] = pq.splice(mi, 1)[0];
		if (done[s]) continue; done[s] = 1;
		const node = (s / 3) | 0;
		const i = node % nx, j = (node / nx) | 0;
		if (i === bx && j === by) break;
		const dirIn = s % 3;
		// 四邻
		const neigh = [[i + 1, j, 0], [i - 1, j, 0], [i, j + 1, 1], [i, j - 1, 1]];
		for (const [ni2, nj2, dir] of neigh) {
			if (ni2 < 0 || ni2 >= nx || nj2 < 0 || nj2 >= ny) continue;
			const x1 = xs[i], y1 = ys[j], x2 = xs[ni2], y2 = ys[nj2];
			if (!segFree(x1, y1, x2, y2, obs)) continue;
			const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
			const turn = (dirIn !== 2 && dirIn !== dir) ? TURN : 0;
			const ns = nodeId(ni2, nj2) * 3 + dir;
			const nc = c + len + turn;
			if (nc < cost[ns]) { cost[ns] = nc; prev[ns] = s; push(nc, ns); }
		}
	}
	// 取终点最优状态
	let best = -1, bc = Infinity;
	for (let d = 0; d < 3; d++) { const s = nodeId(bx, by) * 3 + d; if (cost[s] < bc) { bc = cost[s]; best = s; } }
	if (best < 0 || !Number.isFinite(bc)) return null;
	// 回溯
	const path = [];
	for (let s = best; s !== -1; s = prev[s]) { const node = (s / 3) | 0; path.push([xs[node % nx], ys[(node / nx) | 0]]); }
	path.reverse();
	// 合并共线点
	const out = [path[0]];
	for (let k = 1; k < path.length - 1; k++) {
		const [px, py] = out[out.length - 1], [cx, cy] = path[k], [nx2, ny2] = path[k + 1];
		const collinear = (px === cx && cx === nx2) || (py === cy && cy === ny2);
		if (!collinear) out.push(path[k]);
	}
	if (path.length > 1) out.push(path[path.length - 1]);
	return out;
}
