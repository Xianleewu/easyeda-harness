// 角色原型:多件簇模块。把模块内 N 个器件纵向堆叠,所有器件引脚并集用 densefanout 的
// 平面路由扇出到间隔标签列;模块内部网靠同名网标连通(EasyEDA 网名连通),无需显式内部连线。
import { toWorld } from '../../engine/transform.mjs';
import { regionOf, mergeParts } from '../../engine/cell_helpers.mjs';
import { routeSide, assertEscapable } from './densefanout.mjs';

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
	const left = [], right = [], pts = [];
	let cursorY = anchor.y;
	for (const comp of parts) {
		const lb = comp.localBox || { minX: -5, minY: -5, maxX: 5, maxY: 5 };
		const px = anchor.x, py = cursorY;
		place[comp.designator] = { x: px, y: py, rot: 0, mirror: false };
		const partPins = [];
		for (const p of (comp.pins || [])) {
			const world = toWorld(p.local, [px, py], 0, false);
			pts.push(world);
			const net = pinNets[`${comp.designator}.${p.num}`];
			if (!net) continue;
			const e = { num: `${comp.designator}.${p.num}`, world, net };
			partPins.push(e);
			(p.local[0] >= 0 ? right : left).push(e);
		}
		// 每件脚对自件世界体 fail-closed 检查(内部脚无正交逃逸 → 抛错让 planner 跳过)。
		assertEscapable(partPins, { minX: px + lb.minX, minY: py + lb.minY, maxX: px + lb.maxX, maxY: py + lb.maxY }, comp.designator);
		cursorY = snap10(py - (lb.maxY - lb.minY) - PART_GAP);   // 下一件落在本件真实底部之下
	}
	const frags = [...routeSide(right, 'right'), ...routeSide(left, 'left')];
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
