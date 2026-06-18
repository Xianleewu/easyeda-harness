// Plexus 布局驱动:design_contract 模块区 → archetype cell → 组装模型(纯函数,与生成轨道解耦)。
import { toWorld } from './transform.mjs';
import { getArchetype } from '../circuit_packs/archetypes/registry.mjs';
import { derivePinNets, deriveSupportEndpoints } from './net_derive.mjs';

const DEF = { origin: { x: 1000, y: 1000 }, colWidth: 400, rowGap: 120 };
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

	for (const col of [...cols.keys()].sort((a, b) => a - b)) {
		const mods = cols.get(col).slice().sort((a, b) => a.region.row - b.region.row);
		const colX = o.origin.x + col * o.colWidth;
		let cursorY = o.origin.y;
		for (const m of mods) {
			let fn;
			try {
				fn = getArchetype(m.role);
			} catch {
				skipped.push({ module: m.id, reason: 'no-archetype' });
				continue;
			}
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
			const nets = {};
			const side = sideByModule.get(m.id);
			if (side) nets.side = { name: side.net, class: 'signal' };
			const ep = (o.endpointNets || {})[m.id] || {};
			if (ep.top) nets.top = ep.top;
			if (ep.bottom) nets.bottom = ep.bottom;
			if (parts.length === 1 && logical) {
				nets.pinNets = derivePinNets(parts[0], logical);
			}
			if (logical) {
				const sep = deriveSupportEndpoints(parts, logical);
				if (!nets.top && sep.top) nets.top = sep.top;
				if (!nets.bottom && sep.bottom) nets.bottom = sep.bottom;
			}

			const cell = fn({ parts, anchor: { x: colX, y: snapGrid(cursorY) }, nets });
			const wcs = parts.map(p => worldComponent(p, cell.place[p.designator]));
			cursorY = cellExtentMinY(wcs, cell) - o.rowGap;

			components.push(...wcs);
			wires.push(...(cell.wires || []));
			netflags.push(...(cell.flags || []));
			placed.push(m.id);
		}
	}

	return { model: { components, wires, netflags }, placed, skipped };
}
