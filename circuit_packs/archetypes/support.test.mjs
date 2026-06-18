// support 角色原型单测:无源件竖直串(纯函数,完全基于 cell_helpers)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportArchetype } from './support.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

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

test('support:结点电气校验 — 实际共享网不匹配 pin1/pin2 链式假设 → fail-closed 抛错', () => {
	// 水平件 rot90 后结点正交,但实际结点是 RA.2-RB.1(非链式假设的 RA.1-RB.2)。
	// supportArchetype 假设 parts[k].1 与 parts[k+1].2 同网;不符则抛错让 planner 回退 multipart。
	const parts = [passive('RA'), passive('RB')];
	const pinNets = {
		'RA.1': { name: 'NETA', class: 'signal' }, 'RA.2': { name: 'MID', class: 'signal' },
		'RB.1': { name: 'MID', class: 'signal' }, 'RB.2': { name: 'NETB', class: 'signal' },
	};
	assert.throws(() => supportArchetype({ parts, anchor, nets: { pinNets } }), /junction|结点|topology|同网/);
});

test('support:结点电气校验 — 匹配链式假设则正常出图', () => {
	const parts = [passive('RA'), passive('RB')];
	const pinNets = {
		'RA.1': { name: 'MID', class: 'signal' }, 'RA.2': { name: 'TOP', class: 'power' },
		'RB.1': { name: 'BOT', class: 'ground' }, 'RB.2': { name: 'MID', class: 'signal' },
	};
	assert.doesNotThrow(() => supportArchetype({ parts, anchor, nets: { pinNets } }));
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

test('support:冒烟 — 真实 geomQC/labelQC hard=0', () => {
	const parts = [passive('R1'), passive('R2'), passive('R3')];
	const c = supportArchetype({ parts, anchor, nets });
	const model = {
		components: parts.map(p => worldComponent(p, c.place[p.designator])),
		wires: c.wires,
		netflags: c.flags,
	};
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});
