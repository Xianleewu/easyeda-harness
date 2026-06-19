// Plexus 布局驱动:design_contract 模块区 → archetype cell → 组装模型(纯函数,与生成轨道解耦)。
import { toWorld } from './transform.mjs';
import { getArchetype } from '../circuit_packs/archetypes/registry.mjs';
import { derivePinNets, deriveSupportEndpoints, deriveModulePinNets } from './net_derive.mjs';
import { multipartArchetype } from '../circuit_packs/archetypes/multipart.mjs';
import { resolveLabelCollisions } from './label_resolve.mjs';

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

// cell 真实顶(max Y),口径与 cellExtentMinY 镜像。供列内放置「顶对齐」防上向重叠。
export function cellExtentMaxY(worldComps, cell) {
	const ys = [];
	for (const c of worldComps) ys.push(c.bbox.minY, c.bbox.maxY);
	for (const w of cell.wires || []) { const l = w.line || []; for (let i = 1; i < l.length; i += 2) ys.push(l[i]); }
	for (const f of cell.flags || []) ys.push(f.y);
	if (!ys.length) throw new Error('cellExtentMaxY: archetype produced empty geometry');
	return Math.max(...ys);
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
	const placements = [];   // 每器件最终世界摆位 {designator,x,y,rot,mirror}(供就地写回移器件)

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
	const MAX_COL_H = Number.isFinite(o.maxColHeight) ? o.maxColHeight : 2200;   // 子列最大高,超则折行成 2D 块(紧凑布局,避免细高条)
	for (const col of [...cols.keys()].sort((a, b) => a - b)) {
		const mods = cols.get(col).slice().sort((a, b) => a.region.row - b.region.row);
		// 子列累加器:超过 MAX_COL_H 就 flush 落盘并右移,角色列折成多子列。
		let cComps = [], cWires = [], cFlags = [], cPlaced = [], cPlace = [];
		let cursorY = o.origin.y;
		let xMin = Infinity, xMax = -Infinity;
		const flush = () => {
			if (!cPlaced.length) return;
			const dx = snapGrid(runningX - xMin);
			shiftX(dx, cComps, cWires, cFlags);
			for (const pl of cPlace) pl.x += dx;
			components.push(...cComps); wires.push(...cWires); netflags.push(...cFlags);
			placements.push(...cPlace); placed.push(...cPlaced);
			runningX += (xMax - xMin) + COL_GAP;
			cComps = []; cWires = []; cFlags = []; cPlaced = []; cPlace = [];
			cursorY = o.origin.y; xMin = Infinity; xMax = -Infinity;
		};
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
			// 折行:子列已有内容且当前游标已超过最大高 → 先 flush,本模块落到新子列顶部。
			if (cPlaced.length && (o.origin.y - cursorY) > MAX_COL_H) flush();
			// 先试角色原型(support 处理多件链、fanout/dense 处理单件);抛错且多件 → 回退 multipart。
			let fn = null;
			try { fn = getArchetype(m.role); } catch { fn = null; }
			const nets = {};
			const side = sideByModule.get(m.id);
			// 侧信号抽头只对多件链有意义(需内部结点);单件无源(去耦/旁路电容)无结点,
			// 下面把侧信号转作端点(top/bottom),避免单件 support 抛错被跳过(任意图:单电容必须能放)。
			if (side && parts.length >= 2) nets.side = { name: side.net, class: 'signal' };
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
			// 单件 support 的侧信号转作端点:填空闲的 top/bottom(2 脚件最多 2 网,不会冲突)。
			// 这样单电容(signal-GND / 双信号等)能作端点路由,不再因「side 需≥2件」抛错被跳。
			if (side && parts.length === 1) {
				if (!nets.top) nets.top = { name: side.net, class: 'signal' };
				else if (!nets.bottom) nets.bottom = { name: side.net, class: 'signal' };
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
			// 顶对齐:cell 锚不一定是其顶(连接器/各原型锚位各异,有的向上延伸)。仅当 cell 顶超出锚位
			// (向上延伸)时,整 cell 下移(ceil 到栅格,保证清空 + 引脚仍全格对齐)使顶≤cursorY,防向上压到
			// 上一 cell。对任意锚位模块都防住列内重叠(任意图)。dyShift 必为栅格倍数,不破坏分数 localBox 的格对齐。
			const _anchorY = snapGrid(cursorY);
			const _cellTop = cellExtentMaxY(wcs, cell);
			const dyShift = _cellTop > _anchorY ? -Math.ceil((_cellTop - _anchorY) / GRID) * GRID : 0;
			if (dyShift) {
				for (const c of wcs) { c.bbox.minY += dyShift; c.bbox.maxY += dyShift; for (const p of (c.pins || [])) p.y += dyShift; }
				for (const p of parts) { cell.place[p.designator].y += dyShift; }
				for (const w of (cell.wires || [])) { const l = w.line || []; for (let i = 1; i < l.length; i += 2) l[i] += dyShift; }
				for (const f of (cell.flags || [])) { f.y += dyShift; if (f.textY != null) f.textY += dyShift; }
			}
			for (const p of parts) { const pl = cell.place[p.designator]; cPlace.push({ designator: p.designator, x: pl.x, y: pl.y, rot: pl.rot || 0, mirror: !!pl.mirror }); }
			cursorY = cellExtentMinY(wcs, cell) - o.rowGap;
			cComps.push(...wcs);
			cWires.push(...(cell.wires || []));
			cFlags.push(...(cell.flags || []).map(f => ({ ...f, module: m.id })));   // 打模块标签:供忠实度逐模块校验
			cPlaced.push(m.id);
			for (const c of wcs) { xMin = Math.min(xMin, c.bbox.minX); xMax = Math.max(xMax, c.bbox.maxX); }
			for (const w of (cell.wires || [])) { const l = w.line || []; for (let i = 0; i < l.length; i += 2) { xMin = Math.min(xMin, l[i]); xMax = Math.max(xMax, l[i]); } }
			for (const f of (cell.flags || [])) { xMin = Math.min(xMin, labelLo(f)); xMax = Math.max(xMax, labelHi(f)); }
		}
		flush();   // 列尾:落盘最后一个子列
	}

	// 装配后消解跨模块同名网标的 L10 碰撞(门精确、只接受严格改善;无碰撞则原样)。
	const model = resolveLabelCollisions({ components, wires, netflags });
	return { model, placed, skipped, placements };
}
