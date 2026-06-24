import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segThruBox, segThruPoint, segConflict, mstEdges } from './route_geom.mjs';

const box = { minX: 10, minY: 10, maxX: 30, maxY: 30 };

test('segThruBox:水平段穿过 box 内部 → true;贴边/外部 → false', () => {
	assert.equal(segThruBox([0, 20], [40, 20], [box]), true);   /* 穿内部 */
	assert.equal(segThruBox([0, 10], [40, 10], [box]), false);  /* 贴下边 */
	assert.equal(segThruBox([0, 50], [40, 50], [box]), false);  /* 外部 */
});

test('segThruBox:竖直段穿过 → true', () => {
	assert.equal(segThruBox([20, 0], [20, 40], [box]), true);
	assert.equal(segThruBox([5, 0], [5, 40], [box]), false);
});

test('segThruPoint:段穿过中间点(非端点)→ true', () => {
	assert.equal(segThruPoint([0, 5], [40, 5], [[20, 5]]), true);
	assert.equal(segThruPoint([0, 5], [40, 5], [[0, 5]]), false);  /* 端点不算 */
	assert.equal(segThruPoint([0, 5], [40, 5], [[20, 9]]), false); /* 不在线上 */
});

test('segConflict:异网垂直相交 → true;同网 → false', () => {
	const occ = [{ a: [20, 0], b: [20, 40], net: 'A' }];
	assert.equal(segConflict([0, 20], [40, 20], 'B', occ), true);  /* 异网交叉 */
	assert.equal(segConflict([0, 20], [40, 20], 'A', occ), false); /* 同网不算 */
});

test('segConflict:异网共线重叠 → true', () => {
	const occ = [{ a: [0, 5], b: [30, 5], net: 'A' }];
	assert.equal(segConflict([20, 5], [50, 5], 'B', occ), true);
});

test('mstEdges:4 点产 3 条边,确定性', () => {
	const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 100 }];
	const e1 = mstEdges(pts), e2 = mstEdges(pts);
	assert.equal(e1.length, 3);
	assert.deepEqual(e1, e2);
});
