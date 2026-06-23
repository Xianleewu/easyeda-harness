// 模块朝向工具(通用,零特定电路内容)。
//
// 用途:连接驱动摆放时,把模块【镜像/旋转】使其共享脚转向相邻的相连模块 → 跨模块连接变短 →
//       可被 direct_route 直连 → 标签汤变可见导线。本模块只做几何变换,保连通(脚与线端点同变换 → 仍重合)。
//
//   import { mirrorModuleX } from './module_orient.mjs';
//   mirrorModuleX(sub, cx);   // 原地水平镜像 sub(绕 x=cx):件/脚/线/标签 x → 2cx-x
//
// 连通不变性:任意点 (x,y) 与重合于它的另一点都映到同一新点 → 重合关系保持 → 电气连通不变。

// 水平镜像(绕 x=cx 翻 x)。alignMode 左右翻(6↔8)、rot 水平翻(0↔180)、component.mirror 翻。
export function mirrorModuleX(sub, cx) {
	const fx = x => 2 * cx - x;
	for (const c of (sub.components || [])) {
		if (c.x != null) c.x = fx(c.x);
		if (c.bbox) { const a = fx(c.bbox.minX), b = fx(c.bbox.maxX); c.bbox.minX = Math.min(a, b); c.bbox.maxX = Math.max(a, b); }
		for (const p of (c.pins || [])) { if (p.x != null) p.x = fx(p.x); if (p._ax != null) p._ax = fx(p._ax); }
		c.mirror = !c.mirror;
	}
	for (const w of (sub.wires || [])) w.line = w.line.map((v, i) => i % 2 === 0 ? fx(v) : v);
	for (const f of (sub.netflags || [])) {
		f.x = fx(f.x); if (f.textX != null) f.textX = fx(f.textX);
		if (f.alignMode === 6) f.alignMode = 8; else if (f.alignMode === 8) f.alignMode = 6;
		if (f.rot === 0) f.rot = 180; else if (f.rot === 180) f.rot = 0;
	}
	return sub;
}

// 求子模块所有件 bbox 的水平中心(镜像轴)。
export function moduleCenterX(sub) {
	let minX = 1e9, maxX = -1e9;
	for (const c of (sub.components || [])) if (c.bbox) { minX = Math.min(minX, c.bbox.minX); maxX = Math.max(maxX, c.bbox.maxX); }
	return isFinite(minX) ? (minX + maxX) / 2 : 0;
}
