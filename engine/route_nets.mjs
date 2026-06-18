// 多网顺序避障布线(物理布线引擎):每条网避开器件体 + 前序已布线(转薄障碍),
// 减少异网交叉;布不通则 path=null(回退网标)。贪心顺序、确定性、纯函数。
//
// 局限(已知):贪心无 rip-up,后序网可能被前序堵死而回退;net 排序影响结果。
// 这是物理布线的可用一刀;后续可加按"最短/最受限优先"排序与 rip-up/reroute。
import { routePath } from './ortho_route.mjs';

// 一条已布线路径的各段 → 薄障碍矩形(净空 w),供后续网避让。
function pathToObstacles(path, w) {
	const obs = [];
	for (let i = 1; i < path.length; i++) {
		const [ax, ay] = path[i - 1], [bx, by] = path[i];
		obs.push({ minX: Math.min(ax, bx) - w, minY: Math.min(ay, by) - w, maxX: Math.max(ax, bx) + w, maxY: Math.max(ay, by) + w });
	}
	return obs;
}

export function routeNets(nets, obstacles = [], opts = {}) {
	const baseObs = obstacles || [];
	const wireClr = Number.isFinite(opts.wireClearance) ? opts.wireClearance : 2;
	const dynamic = [];   // 累积已布线障碍
	const out = [];
	for (const net of nets) {
		const path = routePath(net.a, net.b, [...baseObs, ...dynamic], opts);
		out.push({ ...net, path: path || null });
		if (path) dynamic.push(...pathToObstacles(path, wireClr));
	}
	return out;
}
