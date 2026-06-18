// support 角色原型单测:无源件竖直串(纯函数,完全基于 cell_helpers)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportArchetype } from './support.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';

function passive(designator) {
	return {
		designator,
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
	};
}
const anchor = { x: 1000, y: 1000 };
const nets = {
	top: { name: 'V5', class: 'power' },
	bottom: { name: 'GND', class: 'ground' },
	side: { name: 'VMID', class: 'signal' },
};
const cell = supportArchetype({ parts: [passive('R1'), passive('R2'), passive('R3')], anchor, nets });

test('support:N 件竖直等距、rot 90、x 对齐 anchor', () => {
	assert.equal(cell.place.R1.rot, 90);
	assert.equal(cell.place.R1.x, 1000);
	assert.equal(cell.place.R1.y, 1000);
	assert.equal(cell.place.R2.y, 940);
	assert.equal(cell.place.R3.y, 880);
});

test('support:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('support:端点出桩按网类(power/gnd/sig)', () => {
	const kinds = cell.flags.map(f => f.kind).sort();
	assert.ok(kinds.includes('power'));   // 顶 V5
	assert.ok(kinds.includes('gnd'));     // 底 GND
	assert.ok(kinds.includes('sig'));     // 侧 VMID
});

test('support:region 覆盖所有件', () => {
	assert.ok(cell.region.minX < 1000 && cell.region.maxX > 1000);
	assert.ok(cell.region.minY < 880 && cell.region.maxY > 1000);
});

test('support:确定性(同输入两次深相等)', () => {
	const a = supportArchetype({ parts: [passive('R1'), passive('R2')], anchor, nets });
	const b = supportArchetype({ parts: [passive('R1'), passive('R2')], anchor, nets });
	assert.deepEqual(a, b);
});

test('support:负例(空 parts/非2端/侧信号<2件)抛错', () => {
	assert.throws(() => supportArchetype({ parts: [], anchor }));
	assert.throws(() => supportArchetype({
		parts: [{ designator: 'U1', pins: [{ num: '1', local: [0, 0] }, { num: '2', local: [1, 0] }, { num: '3', local: [2, 0] }] }],
		anchor,
	}));
	assert.throws(() => supportArchetype({ parts: [passive('R1')], anchor, nets: { side: { name: 'X', class: 'signal' } } }));
	assert.throws(() => supportArchetype({ parts: [passive('R1'), passive('R2')], anchor, nets: { side: { name: 'X', class: 'signal' } }, opts: { tapIndex: 5 } }));
});
