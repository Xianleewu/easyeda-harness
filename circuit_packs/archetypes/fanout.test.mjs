// fanout 角色原型单测:多引脚器件水平扇出(纯函数,基于 cell_helpers)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanoutArchetype } from './fanout.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

// 合成双侧 6 脚连接器:左 x=-30(脚1/2/3 y=-40/0/40),右 x=+30(脚4/5/6 y=-40/0/40)。
// localBox x±15(脚 x=±30 在体外 → 桩不穿体);y±55 覆盖脚;纵向间距 40 > 标签净空。
function connector(designator) {
	return {
		designator,
		pins: [
			{ num: '1', local: [-30, -40] }, { num: '2', local: [-30, 0] }, { num: '3', local: [-30, 40] },
			{ num: '4', local: [30, -40] }, { num: '5', local: [30, 0] }, { num: '6', local: [30, 40] },
		],
		localBox: { minX: -15, minY: -55, maxX: 15, maxY: 55 },
	};
}
const anchor = { x: 1000, y: 1000 };
const pinNets = {
	'1': { name: 'GND', class: 'ground' },
	'2': { name: 'USB_DN', class: 'signal' },
	'3': { name: 'V5', class: 'power' },
	'4': { name: 'TX', class: 'signal' },
	'5': { name: 'RX', class: 'signal' },
	'6': { name: 'V3V3', class: 'power' },
};
const cell = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });

test('fanout:器件 rot 0 摆 anchor', () => {
	assert.deepEqual(cell.place.J1, { x: 1000, y: 1000, rot: 0, mirror: false });
});

test('fanout:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('fanout:各网类出对应桩(sig/power/gnd)', () => {
	const kinds = cell.flags.map(f => f.kind);
	assert.ok(kinds.includes('sig'));
	assert.ok(kinds.includes('power'));
	assert.ok(kinds.includes('gnd'));
	assert.equal(cell.flags.filter(f => f.kind === 'sig').length, 3);
});

test('fanout:region 覆盖所有引脚', () => {
	assert.ok(cell.region.minX < 970 && cell.region.maxX > 1030);
	assert.ok(cell.region.minY < 960 && cell.region.maxY > 1040);
});

test('fanout:确定性(同输入两次深相等)', () => {
	const a = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });
	const b = fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets } });
	assert.deepEqual(a, b);
});

test('fanout:负例(空 parts/多器件/pinNets 指向不存在引脚)抛错', () => {
	assert.throws(() => fanoutArchetype({ parts: [], anchor, nets: { pinNets } }));
	assert.throws(() => fanoutArchetype({ parts: [connector('J1'), connector('J2')], anchor, nets: { pinNets } }));
	assert.throws(() => fanoutArchetype({ parts: [connector('J1')], anchor, nets: { pinNets: { '9': { name: 'X', class: 'signal' } } } }));
});

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

test('fanout:冒烟 — 真实 geomQC/labelQC hard=0', () => {
	const part = connector('J1');
	const c = fanoutArchetype({ parts: [part], anchor, nets: { pinNets } });
	const model = { components: [worldComponent(part, c.place.J1)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});
