// 角色原型:fanout 多引脚器件水平扇出(连接器/枢纽)。完全用 cell_helpers 构建几何。
import { toWorld } from '../../engine/transform.mjs';
import { labelStub, gndStub, powerStub, regionOf, mergeParts } from '../../engine/cell_helpers.mjs';

export function fanoutArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length !== 1) {
		throw new Error('fanoutArchetype: spec.parts must be exactly one multi-pin component');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('fanoutArchetype: spec.anchor {x,y} required');
	}
	const comp = parts[0];
	const pins = comp.pins || [];
	if (!pins.length) throw new Error('fanoutArchetype: component has no pins');
	const pinNets = nets.pinNets || {};
	const pinNums = new Set(pins.map(p => String(p.num)));
	for (const num of Object.keys(pinNets)) {
		if (!pinNums.has(String(num))) {
			throw new Error(`fanoutArchetype: pinNets references missing pin ${num}`);
		}
	}

	const place = { [comp.designator]: { x: anchor.x, y: anchor.y, rot: 0, mirror: false } };
	const frags = [];
	const pts = [];
	for (const p of pins) {
		const world = toWorld(p.local, [anchor.x, anchor.y], 0, false);
		pts.push(world);
		const pn = pinNets[String(p.num)];
		if (!pn) continue;
		const side = p.local[0] >= 0 ? 'right' : 'left';
		if (pn.class === 'signal') {
			frags.push(labelStub(pn.name, world, { side, escX: world[0] + (side === 'right' ? 30 : -30) }));
		} else if (pn.class === 'power') {
			frags.push(powerStub(pn.name, world, { dir: side, len: 50 }));
		} else if (pn.class === 'ground') {
			frags.push(gndStub(world, { dir: side, len: 30, net: pn.name }));
		}
	}
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
