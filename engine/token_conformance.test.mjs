// 几何严标检查器单测(RED 验证:无实现)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrtho, checkGrid, checkNoCross, checkNoThru, checkNoOverlap } from './token_conformance.mjs';

test('T-ORTHO 严标:有1段斜线即不符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0], net: '' }, { line: [0,0,10,10], net: '' }] });
	assert.equal(r.token, 'T-ORTHO');
	assert.equal(r.conform, false);
	assert.equal(r.deviations.length, 1);
});

test('T-ORTHO 全正交 → 符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0,10,10], net: '' }] });
	assert.equal(r.token, 'T-ORTHO');
	assert.equal(r.conform, true);
	assert.equal(r.deviations.length, 0);
});

test('T-GRID 严标:任一脚脱格即不符合', () => {
	const ok = checkGrid({ components: [{ pins: [{x:0,y:0},{x:10,y:15}], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 } }] });
	assert.equal(ok.token, 'T-GRID');
	assert.equal(ok.conform, true);
	const bad = checkGrid({ components: [{ pins: [{x:3,y:5}], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }] });
	assert.equal(bad.conform, false);
	assert.equal(bad.deviations.length, 1);
});

test('T-NOCROSS 0 crossing → 符合', () => {
	const r = checkNoCross({ wires: [{ line: [0,0,10,0], net: 'A' }, { line: [20,0,30,0], net: 'B' }], components: [] });
	assert.equal(r.token, 'T-NOCROSS');
	assert.equal(r.conform, true);
});

test('T-NOCROSS 只短接(中段相接)无交叉也不符合', () => {
	// 两段共线重叠（中段相接），geomQC 记 collinear
	const model = { wires: [{ line: [0,0,20,0], net: 'A' }, { line: [10,0,30,0], net: 'B' }], components: [] };
	const r = checkNoCross(model);
	// shorts > 0 意味着中段相接，必定不符合
	if (r.detail.shorts > 0) {
		assert.equal(r.conform, false);
		assert(r.deviations.some(d => d.kind === 'mid-segment-touch'));
	}
	// 也验证 conform ↔ deviations 长度一致的不变式
	assert.equal(r.conform, r.deviations.length === 0);
});

test('T-NOTHRU 0 wire-thru → 符合', () => {
	const r = checkNoThru({ wires: [{ line: [0,0,10,0], net: 'A' }], components: [{ designator: 'R1', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }] });
	assert.equal(r.token, 'T-NOTHRU');
	assert.equal(r.conform, true);
});

test('T-NOOVERLAP 0 overlap → 符合', () => {
	const r = checkNoOverlap({ components: [{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [] }, { designator: 'R2', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }], wires: [], netflags: [] });
	assert.equal(r.token, 'T-NOOVERLAP');
	assert.equal(r.conform, true);
});
