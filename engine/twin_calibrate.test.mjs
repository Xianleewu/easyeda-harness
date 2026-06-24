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

/* Fix1 §6 Level-2 ①: text-position error 须参与 conform 门控 */
test('compareGeom:bbox/pin 对齐但 attr bbox 偏移超 tol → conform===false', () => {
	/* 预测:件 bbox+pin 与实际完全一致;但可见 attr bbox 偏移 20px */
	const predicted = {
		components: [{
			designator: 'X1',
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
			pins: [{ num: '1', x: 10, y: 5 }],
			attrs: [{ key: 'Name', bbox: { minX: 2, minY: 22, maxX: 12, maxY: 36 } }],
		}],
		wires: [], netflags: [], texts: [], rectangles: [],
	};
	const actual = {
		components: [{
			designator: 'X1',
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
			pins: [{ num: '1', x: 10, y: 5 }],
			attrs: [{ key: 'Name', bbox: { minX: 22, minY: 22, maxX: 32, maxY: 36 } }], /* x 偏移 20 */
		}],
		wires: [], netflags: [], texts: [], rectangles: [],
	};
	const r = compareGeom(predicted, actual, { tol: 2 });
	assert.equal(r.conform, false, 'attr bbox 偏移超 tol 应使 conform=false');
	assert.ok(r.maxAttrErr >= 20, `maxAttrErr 应反映偏移量(got ${r.maxAttrErr})`);
});
