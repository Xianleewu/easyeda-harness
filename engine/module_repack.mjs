// 2D 模块重排:把 plexus 生成的【干净每模块单元几何】按 2D shelf-packing 重新排列,
// 解开"宽列式布局 vs aspect≤2.35"的死锁(列式 aspect 2.34→2D ~1.5),保留单元几何不动、
// 跨模块靠 grouped-net-label 同名连通。归属用 union-find(线连通到某模块的脚=该模块),
// 保证标签+短桩+脚作为刚体随模块整体移动(不浮空、不串模块)。
const TOL = 3;

function makeUF() {
	const par = new Map();
	const find = a => { if (!par.has(a)) par.set(a, a); while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
	const uni = (a, b) => par.set(find(a), find(b));
	return { find, uni };
}
const k = (x, y) => `${Math.round(x / TOL)},${Math.round(y / TOL)}`;

// 把每个 wire/flag 归属到模块:与某模块脚处于同一线连通分量者属该模块。
export function assignByConnectivity(model, ref2mod) {
	const uf = makeUF();
	// 1) union 所有线段端点(含折点链)+ 落在段上的脚
	for (const w of model.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 2) uf.uni(k(l[i], l[i + 1]), k(l[i + 2], l[i + 3])); }
	// 脚落在线段内部 → union(处理 T 接 + 短桩端点)
	const segs = [];
	for (const w of model.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 2) segs.push([l[i], l[i + 1], l[i + 2], l[i + 3]]); }
	const onSeg = (px, py, [ax, ay, bx, by]) => ax === bx ? (Math.abs(px - ax) <= TOL && py >= Math.min(ay, by) - TOL && py <= Math.max(ay, by) + TOL)
		: ay === by ? (Math.abs(py - ay) <= TOL && px >= Math.min(ax, bx) - TOL && px <= Math.max(ax, bx) + TOL) : false;
	const pins = [];
	for (const c of model.components) { const mod = ref2mod.get(c.designator); for (const p of (c.pins || [])) if (p.x != null) pins.push({ x: p.x, y: p.y, mod }); }
	for (const p of pins) for (const s of segs) if (onSeg(p.x, p.y, s)) uf.uni(k(p.x, p.y), k(s[0], s[1]));
	// 2) 根→模块(脚定义)
	const rootMod = new Map();
	for (const p of pins) if (p.mod) rootMod.set(uf.find(k(p.x, p.y)), p.mod);
	// 3) 查询函数:点 → 模块
	const modOf = (x, y) => rootMod.get(uf.find(k(x, y))) || null;
	return { modOf, rootMod, uf };
}

// 缩短跨模块 sig 标签的长桩:连通靠同名,长桩(列式布局遗留)在 2D 里多余且伸进邻模块。
// 把标签沿桩向【模块端】移到固定短长 STUBLEN,保持方向/正交/端点附着(DR10),只缩外伸量。
export function shortenSigStubs(model, STUBLEN = 34) {
	for (const f of (model.netflags || [])) {
		if (f.kind !== 'sig') continue;
		const near = (x, y) => Math.abs(x - f.x) < 2 && Math.abs(y - f.y) < 2;
		const stub = (model.wires || []).find(w => { const l = w.line; return near(l[0], l[1]) || near(l[l.length - 2], l[l.length - 1]); });
		if (!stub || stub.line.length !== 4) continue;   // 仅处理单段直桩
		const l = stub.line;
		const labelAtStart = near(l[0], l[1]);
		const pinEnd = labelAtStart ? [l[2], l[3]] : [l[0], l[1]];
		const dx = f.x - pinEnd[0], dy = f.y - pinEnd[1];
		const len = Math.hypot(dx, dy);
		if (len <= STUBLEN + 2 || len === 0) continue;
		const ux = dx / len, uy = dy / len;
		const nx = pinEnd[0] + ux * STUBLEN, ny = pinEnd[1] + uy * STUBLEN;
		const ddx = nx - f.x, ddy = ny - f.y;
		if (labelAtStart) { l[0] = nx; l[1] = ny; } else { l[2] = nx; l[3] = ny; }
		f.x = nx; f.y = ny;
		if (f.textX != null) f.textX += ddx; if (f.textY != null) f.textY += ddy;
	}
	return model;
}

// 重排:返回 { model, moduleRegions }
export function moduleRepack(model, modules, opts = {}) {
	model = JSON.parse(JSON.stringify(model));
	if (opts.shortenStubs === true) shortenSigStubs(model, opts.stubLen ?? 34);
	const ref2mod = new Map();
	const titleOf = new Map();
	for (const md of modules) { for (const r of Object.values(md.refs || {})) ref2mod.set(r, md.id); titleOf.set(md.id, md.title || md.id); }
	const { modOf } = assignByConnectivity(model, ref2mod);

	const groups = new Map();
	const G = id => { if (!groups.has(id)) groups.set(id, { components: [], wires: [], netflags: [] }); return groups.get(id); };
	for (const c of model.components) { const mod = ref2mod.get(c.designator); if (mod) G(mod).components.push(c); }
	for (const w of model.wires) { const l = w.line; const mod = modOf(l[0], l[1]) || modOf(l[l.length - 2], l[l.length - 1]); if (mod) G(mod).wires.push(w); else (opts.orphanWires = opts.orphanWires || []).push(w); }
	for (const f of (model.netflags || [])) { const mod = modOf(f.x, f.y) || modOf(f.textX ?? f.x, f.textY ?? f.y); if (mod) G(mod).netflags.push(f); else (opts.orphanFlags = opts.orphanFlags || []).push(f); }

	// 每模块全几何 bbox(含件/线/标签)
	const subs = [];
	for (const [id, g] of groups) {
		const b = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
		const ext = (x, y, m = 0) => { b.minX = Math.min(b.minX, x - m); b.minY = Math.min(b.minY, y - m); b.maxX = Math.max(b.maxX, x + m); b.maxY = Math.max(b.maxY, y + m); };
		for (const c of g.components) if (c.bbox) { ext(c.bbox.minX, c.bbox.minY); ext(c.bbox.maxX, c.bbox.maxY); }
		for (const w of g.wires) for (let i = 0; i < w.line.length; i += 2) ext(w.line[i], w.line[i + 1]);
		// 用网标真实 bbox(net 名文字实宽)算模块盒,否则低估标签宽度致 PAD 没隔开、压邻模块。
		for (const f of g.netflags) { if (f.bbox) { ext(f.bbox.minX, f.bbox.minY); ext(f.bbox.maxX, f.bbox.maxY); } else { ext(f.textX ?? f.x, f.textY ?? f.y, 30); ext(f.x, f.y, 8); } }
		subs.push({ id, g, bb: b, w: b.maxX - b.minX, h: b.maxY - b.minY });
	}
	subs.sort((a, b) => b.h - a.h);

	const PAD = opts.pad ?? 150, TITLE = opts.title ?? 48;
	const totalW = subs.reduce((a, s) => a + s.w + PAD, 0);
	const rowH0 = Math.max(...subs.map(s => s.h)) + TITLE + PAD;
	const MAXW = opts.maxWidth || Math.sqrt((opts.aspectTarget ?? 1.5) * totalW * rowH0);
	const out = { components: [], wires: [], netflags: [], rectangles: [], texts: [] };
	const moduleRegions = [];
	let cx = 0, cy = 0, rowH = 0;
	for (const s of subs) {
		if (cx > 0 && cx + s.w > MAXW) { cy += rowH + PAD; cx = 0; rowH = 0; }
		// 偏移吸 10 格:组件本在栅格,模块整体平移取 10 的倍数即保持栅格对齐(免 DRC 出格告警)。
		const ox = Math.round((cx - s.bb.minX) / 10) * 10, oy = Math.round((cy + TITLE - s.bb.minY) / 10) * 10;
		for (const c of s.g.components) out.components.push({ ...c, x: c.x + ox, y: c.y + oy, bbox: { minX: c.bbox.minX + ox, minY: c.bbox.minY + oy, maxX: c.bbox.maxX + ox, maxY: c.bbox.maxY + oy }, pins: (c.pins || []).map(p => ({ ...p, x: p.x + ox, y: p.y + oy })) });
		for (const w of s.g.wires) out.wires.push({ ...w, line: w.line.map((v, i) => i % 2 === 0 ? v + ox : v + oy) });
		for (const f of s.g.netflags) out.netflags.push({ ...f, x: f.x + ox, y: f.y + oy, textX: (f.textX ?? f.x) + ox, textY: (f.textY ?? f.y) + oy, bbox: f.bbox ? { minX: f.bbox.minX + ox, minY: f.bbox.minY + oy, maxX: f.bbox.maxX + ox, maxY: f.bbox.maxY + oy } : undefined });
		const frameBox = { minX: cx - 14, minY: cy + TITLE - 10, maxX: cx + s.w + 14, maxY: cy + TITLE + s.h + 12 };
		moduleRegions.push({ name: s.id, title: titleOf.get(s.id) || s.id, box: frameBox, contentBox: { minX: cx, minY: cy + TITLE, maxX: cx + s.w, maxY: cy + TITLE + s.h } });
		out.rectangles.push({ role: 'module-frame', module: s.id, bbox: frameBox, minX: frameBox.minX, minY: frameBox.minY, maxX: frameBox.maxX, maxY: frameBox.maxY });
		cx += s.w + PAD; rowH = Math.max(rowH, TITLE + s.h);
	}
	out.noConnects = model.noConnects || [];   // NC 按 ref/pin,位置无关,原样保留(清悬空脚 DRC)
	out.moduleRegions = moduleRegions;
	return { model: out, moduleRegions, orphanWires: opts.orphanWires || [], orphanFlags: opts.orphanFlags || [] };
}
