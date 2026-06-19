// 角色原型:多件簇模块。把模块内 N 个器件纵向堆叠,所有器件引脚并集用 densefanout 的
// 平面路由扇出到间隔标签列;模块内部网靠同名网标连通(EasyEDA 网名连通),无需显式内部连线。
import { toWorld } from '../../engine/transform.mjs';
import { regionOf, mergeParts } from '../../engine/cell_helpers.mjs';
import { routeSide, routeEdge, classifyEdge, assertEscapable } from './densefanout.mjs';

const PART_GAP = 50;   // 件体间隙(按各件真实高度自适应堆叠)
const snap10 = v => Math.round(v / 10) * 10;

export function multipartArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length < 1) {
		throw new Error('multipartArchetype: spec.parts must be a non-empty array');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('multipartArchetype: spec.anchor {x,y} required');
	}
	// place 以位号为键:重复位号会静默覆盖(后件冲掉前件、cursor 仍推进)→ 世界体重叠。
	// 显式化该前提,fail-closed 抛错。当前链 inferRoles 并查集分组保证 parts 位号唯一。
	const dup = new Set();
	for (const c of parts) {
		if (dup.has(c.designator)) throw new Error(`multipartArchetype: duplicate designator ${c.designator} in parts`);
		dup.add(c.designator);
	}
	const pinNets = nets.pinNets || {};   // 键 `${designator}.${num}`
	const place = {};
	const left = [], right = [], botPins = [], topPins = [], pts = [];
	let cursorY = anchor.y;
	let stackBottom = anchor.y;
	const lastIdx = parts.length - 1;
	parts.forEach((comp, pi) => {
		const lb = comp.localBox || { minX: -5, minY: -5, maxX: 5, maxY: 5 };
		const px = anchor.x, py = cursorY;
		place[comp.designator] = { x: px, y: py, rot: 0, mirror: false };
		stackBottom = Math.min(stackBottom, py + lb.minY);
		const partPins = [];
		for (const p of (comp.pins || [])) {
			const world = toWorld(p.local, [px, py], 0, false);
			pts.push(world);
			const net = pinNets[`${comp.designator}.${p.num}`];
			if (!net) continue;
			const e = { num: `${comp.designator}.${p.num}`, world, net };
			partPins.push(e);
			// 底/顶边引脚水平逃逸会横穿同排邻脚(wireThruPin)。仅栈底件底边可向下逃逸(下无件)、
			// 栈顶件顶边可向上逃逸(上无件);中层件边脚向下/上会穿邻件,故仍走 routeSide(左/右)。
			const edge = classifyEdge(p.local, lb);
			if (edge === 'bottom' && pi === lastIdx) botPins.push(e);
			else if (edge === 'top' && pi === 0) topPins.push(e);
			else (p.local[0] >= 0 ? right : left).push(e);
		}
		// 每件脚对自件世界体 fail-closed 检查(内部脚无正交逃逸 → 抛错让 planner 跳过)。
		assertEscapable(partPins, { minX: px + lb.minX, minY: py + lb.minY, maxX: px + lb.maxX, maxY: py + lb.maxY }, comp.designator);
		cursorY = snap10(py - (lb.maxY - lb.minY) - PART_GAP);   // 下一件落在本件真实底部之下
	});
	const sideFrags = [...routeSide(right, 'right'), ...routeSide(left, 'left')];
	// 底/顶边引脚的标签降到侧布线之外(floor/ceil)以免碰撞(同 densefanout)。
	const sideYs = [];
	for (const fr of sideFrags) {
		for (const w of fr.wires || []) { const l = w.line || []; for (let i = 1; i < l.length; i += 2) sideYs.push(l[i]); }
		for (const f of fr.flags || []) sideYs.push(f.y);
	}
	const floorY = (sideYs.length ? Math.min(stackBottom, ...sideYs) : stackBottom) - PART_GAP;
	const ceilY = (sideYs.length ? Math.max(anchor.y, ...sideYs) : anchor.y) + PART_GAP;
	const splitSide = arr => [arr.filter(p => p.world[0] < anchor.x), arr.filter(p => p.world[0] >= anchor.x)];
	const [bL, bR] = splitSide(botPins);
	const [tL, tR] = splitSide(topPins);
	const frags = [
		...sideFrags,
		...routeEdge(bL, -1, 'left', floorY), ...routeEdge(bR, -1, 'right', floorY),
		...routeEdge(tL, 1, 'left', ceilY), ...routeEdge(tR, 1, 'right', ceilY),
	];
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
