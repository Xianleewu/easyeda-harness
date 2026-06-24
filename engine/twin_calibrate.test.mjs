import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareGeom } from './twin_calibrate.mjs';

const mk = (dx = 0) => ({ components: [{ designator: 'X1', bbox: { minX: dx, minY: 0, maxX: 10 + dx, maxY: 20 }, pins: [{ num: '1', x: 10 + dx, y: 5 }], attrs: [] }], wires: [], netflags: [], texts: [], rectangles: [] });

test('compareGeom:预测=真实 → conform,误差 0', () => {
	const r = compareGeom(mk(0), mk(0), { tol: 2 });
	assert.equal(r.conform, true);
	assert.equal(r.maxPinErr, 0);
	assert.equal(r.maxBBoxErr, 0);
});

test('compareGeom:偏移超 tol → 不符合', () => {
	const r = compareGeom(mk(0), mk(10), { tol: 2 });
	assert.equal(r.conform, false);
	assert.ok(r.maxPinErr >= 10);
});
