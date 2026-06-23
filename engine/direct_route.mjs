// 邻近 2 脚信号网用【L 形直连走线】替代逃逸标签(通用,零特定电路内容)。
//
// 问题:generate 路径把每个跨簇信号都做成网名标签(脚→标签),器件间无可见直连导线 = "标签汤"、
//       看着像没连上、且标签撑大模块 bbox 致散布。
// 方案:布局后,对【纯 2 脚信号网】(点对点,无内联无源件),若两脚足够近(≤maxDist)且 L 形直连
//       不穿任何器件 bbox → 删两侧逃逸标签+桩线,改画一条 pin→pin 的 L 形直连导线。
//       远距 / 多脚 / 穿障的网【保留标签】(商用远距连接标准)。减标签 + 加导线 + 缩模块,三赢。
//
//   import { directRouteClose } from './direct_route.mjs';
//   const r = directRouteClose(model, logical.nets, { maxDist: 260 });   // 原地改 model.wires/netflags
//   // r = { converted, candidates }
//
// 脚位用 _ax/_ay(EDA 实际脚位);只在 L 形两段都不穿 bbox 时转(否则保留标签,宁缺勿乱)。

export function directRouteClose(model, logicalNets, opts = {}) {
	const MAXD = opts.maxDist ?? 260;
	const boxes = (model.components || []).map(c => c.bbox).filter(Boolean);
	const pinPos = new Map();
	for (const c of (model.components || [])) for (const p of (c.pins || [])) if (p.x != null) pinPos.set(`${c.designator}.${p.num}`, { x: p._ax ?? p.x, y: p._ay ?? p.y });
	const M = 1;
	const inBox = (x, y) => boxes.some(b => x > b.minX + M && x < b.maxX - M && y > b.minY + M && y < b.maxY - M);
	const segBad = (x1, y1, x2, y2) => {
		for (const b of boxes) {
			if (x1 === x2) { if (x1 > b.minX + M && x1 < b.maxX - M) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); if (lo < b.maxY - M && hi > b.minY + M) return true; } }
			else { if (y1 > b.minY + M && y1 < b.maxY - M) { const lo = Math.min(x1, x2), hi = Math.max(x1, x2); if (lo < b.maxX - M && hi > b.minX + M) return true; } }
		}
		return false;
	};
	const lroute = (a, b) => {
		if (a.x === b.x || a.y === b.y) return segBad(a.x, a.y, b.x, b.y) ? null : [a.x, a.y, b.x, b.y];
		for (const c of [[b.x, a.y], [a.x, b.y]]) {   // H 先 / V 先
			if (!inBox(c[0], c[1]) && !segBad(a.x, a.y, c[0], c[1]) && !segBad(c[0], c[1], b.x, b.y)) return [a.x, a.y, c[0], c[1], b.x, b.y];
		}
		return null;
	};
	let converted = 0, candidates = 0;
	for (const net of (logicalNets || [])) {
		if (net.class !== 'signal') continue;
		const pins = (net.pins || []).filter(r => pinPos.has(r));
		if (pins.length !== 2) continue;   // 纯点对点(无内联无源件:net.pins 就两端)
		const a = pinPos.get(pins[0]), b = pinPos.get(pins[1]);
		if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > MAXD) continue;
		candidates++;
		const route = lroute(a, b);
		if (!route) continue;
		// 删该网的逃逸标签 + 桩线(纯 2 脚网这些就是两侧逃逸),改加一条直连
		model.netflags = (model.netflags || []).filter(f => f.net !== net.name);
		model.wires = (model.wires || []).filter(w => w.net !== net.name);
		model.wires.push({ net: net.name, line: route });
		converted++;
	}
	return { converted, candidates };
}
