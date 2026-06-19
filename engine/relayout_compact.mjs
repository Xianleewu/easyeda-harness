// 原地重布局：连通聚类 + 货架打包，把散落的连通块紧凑化（纯几何）。
//
// 策略：器件间物理直连的 wire 很少，模块主要靠命名网(标签)互连 → 命名网与位置
// 无关，故把"物理直连块"作为刚性组整体平移，逻辑连接不破。打包成紧凑行，消灭空白。

const TOL = 1;
const round = v => Math.round(v);

function compBox(c) {
	if (c.bbox) return c.bbox;
	return { minX: c.x, minY: c.y, maxX: c.x, maxY: c.y };
}

function unionBox(boxes) {
	const v = boxes.filter(Boolean);
	if (!v.length) return null;
	return {
		minX: Math.min(...v.map(b => b.minX)), minY: Math.min(...v.map(b => b.minY)),
		maxX: Math.max(...v.map(b => b.maxX)), maxY: Math.max(...v.map(b => b.maxY)),
	};
}

/* 按物理直连 wire 把器件并查集聚类。命名网/标签连接不强行合并。 */
export function clusterByWires(snapshot) {
	const comps = snapshot.components || [];
	const wires = snapshot.wires || [];
	const pinAt = new Map();
	comps.forEach((c, i) => {
		for (const p of c.pins || []) {
			const k = `${round(p.x)},${round(p.y)}`;
			if (!pinAt.has(k)) pinAt.set(k, new Set());
			pinAt.get(k).add(i);
		}
	});
	const par = comps.map((_, i) => i);
	const find = x => (par[x] === x ? x : (par[x] = find(par[x])));
	const uni = (a, b) => { par[find(a)] = find(b); };

	for (const w of wires) {
		const line = w.line || [];
		const touched = new Set();
		for (let i = 0; i + 1 < line.length; i += 2) {
			for (let dx = -TOL; dx <= TOL; dx++) for (let dy = -TOL; dy <= TOL; dy++) {
				const s = pinAt.get(`${round(line[i]) + dx},${round(line[i + 1]) + dy}`);
				if (s) for (const idx of s) touched.add(idx);
			}
		}
		const arr = [...touched];
		for (let i = 1; i < arr.length; i++) uni(arr[0], arr[i]);
	}

	const groups = new Map();
	comps.forEach((c, i) => {
		const r = find(i);
		if (!groups.has(r)) groups.set(r, []);
		groups.get(r).push(i);
	});
	return [...groups.values()].map(componentIdx => ({
		componentIdx,
		box: unionBox(componentIdx.map(i => compBox(comps[i]))),
	}));
}

/* 货架打包：盒子按高度降序，逐行从左到右摆放，受 maxRowWidth 约束。 */
export function shelfPack(items, { maxRowWidth = 1000, gap = 30, originX = 0, originY = 0 } = {}) {
	const sized = items.map((it, idx) => {
		const b = it.box;
		return { idx, orig: it, w: b.maxX - b.minX, h: b.maxY - b.minY };
	}).sort((a, b) => b.h - a.h);

	let x = originX, y = originY, rowH = 0;
	const placed = [];
	for (const s of sized) {
		if (x > originX && x + s.w > originX + maxRowWidth) {
			x = originX; y += rowH + gap; rowH = 0;
		}
		placed.push({ ...s, tx: x, ty: y });
		x += s.w + gap;
		rowH = Math.max(rowH, s.h);
	}
	placed.sort((a, b) => a.idx - b.idx); // 还原输入顺序
	return placed;
}

/* dry-run 规划：聚类 → 打包 → 每块平移量 + 预计新填充率。不移动任何东西。 */
export function planCompaction(snapshot, opts = {}) {
	const comps = snapshot.components || [];
	const clusters = clusterByWires(snapshot);
	const cur = unionBox(clusters.map(c => c.box));
	const maxRowWidth = opts.maxRowWidth ?? Math.round((cur.maxX - cur.minX) * 0.85);
	const placed = shelfPack(clusters, { maxRowWidth, gap: opts.gap ?? 40, originX: cur.minX, originY: cur.minY });

	const plans = placed.map(p => ({
		componentIdx: p.orig.componentIdx,
		box: p.orig.box,
		dx: p.tx - p.orig.box.minX,
		dy: p.ty - p.orig.box.minY,
		target: { minX: p.tx, minY: p.ty, maxX: p.tx + p.w, maxY: p.ty + p.h },
	}));

	const partArea = b => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
	const partAreaSum = comps.reduce((s, c) => s + partArea(compBox(c)), 0);
	const newContent = unionBox(plans.map(p => p.target));
	const newArea = newContent ? partArea(newContent) : 0;
	const curArea = cur ? partArea(cur) : 0;

	return {
		clusters: clusters.length,
		current: { contentBox: cur, fillRatio: curArea ? partAreaSum / curArea : 0 },
		projected: { contentBox: newContent, fillRatio: newArea ? partAreaSum / newArea : 0 },
		plans,
	};
}

function centerOf(b) { return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }; }

function nearestDelta(centers, x, y) {
	let best = { dx: 0, dy: 0 }, bd = Infinity;
	for (const c of centers) {
		const d = (x - c.x) ** 2 + (y - c.y) ** 2;
		if (d < bd) { bd = d; best = { dx: c.dx, dy: c.dy }; }
	}
	return best;
}

/* 把规划展开成逐图元移动单：器件按所属块、网标/文本/导线按最近块中心。 */
export function computeMovePlan(snapshot, opts = {}) {
	const plan = planCompaction(snapshot, opts);
	const comps = snapshot.components || [];
	const centers = plan.plans.map(p => ({ ...centerOf(p.box), dx: p.dx, dy: p.dy }));

	const compDelta = new Map();
	for (const p of plan.plans) for (const i of p.componentIdx) compDelta.set(i, { dx: p.dx, dy: p.dy });

	const moves = [];
	comps.forEach((c, i) => {
		const d = compDelta.get(i) || { dx: 0, dy: 0 };
		if (c.id && (d.dx || d.dy)) moves.push({ id: c.id, type: 'component', dx: d.dx, dy: d.dy });
	});
	for (const f of snapshot.netflags || []) {
		const d = nearestDelta(centers, f.x, f.y);
		if (f.id && (d.dx || d.dy)) moves.push({ id: f.id, type: 'component', dx: d.dx, dy: d.dy });
	}
	for (const t of snapshot.texts || []) {
		const d = nearestDelta(centers, t.x, t.y);
		if (t.id && (d.dx || d.dy)) moves.push({ id: t.id, type: 'text', dx: d.dx, dy: d.dy });
	}
	for (const w of snapshot.wires || []) {
		const line = w.line || [];
		if (!line.length || !w.id) continue;
		let mx = 0, my = 0, n = 0;
		for (let i = 0; i + 1 < line.length; i += 2) { mx += line[i]; my += line[i + 1]; n++; }
		const d = nearestDelta(centers, mx / n, my / n);
		if (d.dx || d.dy) moves.push({ id: w.id, type: 'wire', dx: d.dx, dy: d.dy });
	}
	return { plan, moves };
}
