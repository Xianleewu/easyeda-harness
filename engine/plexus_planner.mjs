// Plexus 布局驱动:design_contract 模块区 → archetype cell → 组装模型(纯函数,与生成轨道解耦)。
import { toWorld } from './transform.mjs';
import { getArchetype } from '../circuit_packs/archetypes/registry.mjs';
import { derivePinNets, deriveSupportEndpoints, deriveModulePinNets } from './net_derive.mjs';
import { multipartArchetype } from '../circuit_packs/archetypes/multipart.mjs';

// 列宽自适应(每列按真实几何含标签框紧排,见列循环 COL_GAP);rowGap 为列内件纵向间距。
const DEF = { origin: { x: 1000, y: 1000 }, rowGap: 180 };
const GRID = 10;
const snapGrid = v => Math.round(v / GRID) * GRID;

/* 由 place + 库件构造世界坐标元件(引脚 + bbox),等价 buildmodel 核心一步 */
function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => {
		const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror);
		return { num: p.num, x, y };
	});
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]);
	const ys = corners.map(c => c[1]);
	return {
		designator: part.designator,
		pins,
		bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
	};
}

/* 模块真实几何范围最小 y(含桩):组件 bbox + 线顶点 + 标点。不用 cell.region(不含桩)。 */
export function cellExtentMinY(worldComps, cell) {
	const ys = [];
	for (const c of worldComps) ys.push(c.bbox.minY, c.bbox.maxY);
	for (const w of cell.wires || []) {
		const l = w.line || [];
		for (let i = 1; i < l.length; i += 2) ys.push(l[i]);
	}
	for (const f of cell.flags || []) ys.push(f.y);
	if (!ys.length) {
		throw new Error('cellExtentMinY: archetype produced empty geometry (no components/wires/flags)');
	}
	return Math.min(...ys);
}

export function planLayout({ contract, byDes, logical, opts = {} } = {}) {
	if (!contract || !Array.isArray(contract.modules)) {
		throw new TypeError('planLayout: contract.modules required');
	}
	if (!(byDes instanceof Map)) {
		throw new TypeError('planLayout: byDes must be a Map');
	}
	const o = { ...DEF, ...opts, origin: { ...DEF.origin, ...(opts.origin || {}) } };

	const sideByModule = new Map();
	for (const lc of contract.labelColumns || []) {
		if (lc.class === 'signal' && !sideByModule.has(lc.module)) sideByModule.set(lc.module, lc);
	}

	const cols = new Map();
	for (const m of contract.modules) {
		if (!cols.has(m.region.col)) cols.set(m.region.col, []);
		cols.get(m.region.col).push(m);
	}

	const placed = [];
	const skipped = [];
	const components = [];
	const wires = [];
	const netflags = [];

	// 每列先在 x=0 临时渲染,量真实 x 跨度(含标签框宽),再整列左缘紧排(自适应列宽,替代固定 colWidth)。
	const COL_GAP = 120;
	const labelLen = f => Math.max(40, String(f.net || '').length * 6 + 18);
	const labelLo = f => { const fx = f.textX ?? f.x; return (f.alignMode === 6 || f.alignMode === 7) ? fx : fx - labelLen(f); };
	const labelHi = f => { const fx = f.textX ?? f.x; return (f.alignMode === 6 || f.alignMode === 7) ? fx + labelLen(f) : fx; };
	const shiftX = (dx, comps, ws, fs) => {
		for (const c of comps) { c.bbox.minX += dx; c.bbox.maxX += dx; for (const p of c.pins) p.x += dx; }
		for (const w of ws) { const l = w.line || []; for (let i = 0; i < l.length; i += 2) l[i] += dx; }
		for (const f of fs) { f.x += dx; if (f.textX != null) f.textX += dx; }
	};

	let runningX = o.origin.x;
	for (const col of [...cols.keys()].sort((a, b) => a - b)) {
		const mods = cols.get(col).slice().sort((a, b) => a.region.row - b.region.row);
		const cComps = [], cWires = [], cFlags = [], cPlaced = [];
		let cursorY = o.origin.y;
		let xMin = Infinity, xMax = -Infinity;
		for (const m of mods) {
			const parts = [];
			let missing = false;
			for (const ref of m.parts) {
				const p = byDes.get(ref);
				if (!p) { missing = true; break; }
				parts.push(p);
			}
			if (missing) {
				skipped.push({ module: m.id, reason: 'missing-parts' });
				continue;
			}
			// 先试角色原型(support 处理多件链、fanout/dense 处理单件);抛错且多件 → 回退 multipart。
			let fn = null;
			try { fn = getArchetype(m.role); } catch { fn = null; }
			const nets = {};
			const side = sideByModule.get(m.id);
			if (side) nets.side = { name: side.net, class: 'signal' };
			const ep = (o.endpointNets || {})[m.id] || {};
			if (ep.top) nets.top = ep.top;
			if (ep.bottom) nets.bottom = ep.bottom;
			if (logical) {
				// 单件:pin-num 键(densefanout/fanout);多件:des.num 键(support 结点校验 + multipart)。
				nets.pinNets = parts.length === 1 ? derivePinNets(parts[0], logical) : deriveModulePinNets(parts, logical);
				const sep = deriveSupportEndpoints(parts, logical);
				if (!nets.top && sep.top) nets.top = sep.top;
				if (!nets.bottom && sep.bottom) nets.bottom = sep.bottom;
			}
			const anchorPt = { x: 0, y: snapGrid(cursorY) };   // 临时 x=0,整列后偏移
			let cell = null;
			if (fn) {
				try { cell = fn({ parts, anchor: anchorPt, nets }); } catch { cell = null; }
			}
			if (!cell && parts.length > 1) {
				try {
					cell = multipartArchetype({ parts, anchor: anchorPt, nets: { pinNets: logical ? deriveModulePinNets(parts, logical) : {} } });
				} catch { cell = null; }
			}
			if (!cell) {
				skipped.push({ module: m.id, reason: fn ? 'render-error' : 'no-archetype' });
				continue;
			}
			const wcs = parts.map(p => worldComponent(p, cell.place[p.designator]));
			cursorY = cellExtentMinY(wcs, cell) - o.rowGap;
			cComps.push(...wcs);
			cWires.push(...(cell.wires || []));
			cFlags.push(...(cell.flags || []));
			cPlaced.push(m.id);
			for (const c of wcs) { xMin = Math.min(xMin, c.bbox.minX); xMax = Math.max(xMax, c.bbox.maxX); }
			for (const w of (cell.wires || [])) { const l = w.line || []; for (let i = 0; i < l.length; i += 2) { xMin = Math.min(xMin, l[i]); xMax = Math.max(xMax, l[i]); } }
			for (const f of (cell.flags || [])) { xMin = Math.min(xMin, labelLo(f)); xMax = Math.max(xMax, labelHi(f)); }
		}
		if (!cPlaced.length) continue;
		const dx = snapGrid(runningX - xMin);   // 整列左缘对齐到 runningX(snap 保格)
		shiftX(dx, cComps, cWires, cFlags);
		components.push(...cComps);
		wires.push(...cWires);
		netflags.push(...cFlags);
		placed.push(...cPlaced);
		runningX += (xMax - xMin) + COL_GAP;
	}

	return { model: { components, wires, netflags }, placed, skipped };
}
