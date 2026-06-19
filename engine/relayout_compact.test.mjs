// relayout_compact 单测：连通聚类 + 货架打包（纯几何，确定性）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfPack, clusterByWires } from './relayout_compact.mjs';

test('shelfPack：盒子按行紧凑摆放，不重叠，受最大行宽约束', () => {
	const boxes = [
		{ box: { minX: 0, minY: 0, maxX: 100, maxY: 40 } },
		{ box: { minX: 500, minY: 500, maxX: 560, maxY: 540 } }, // 60x40
		{ box: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
	];
	const placed = shelfPack(boxes, { maxRowWidth: 180, gap: 10, originX: 0, originY: 0 });
	// 第一行放下 100 与 60（100+10+60=170 <=180），第三个 50 换行
	assert.equal(placed.length, 3);
	// 每个有 target 左上角
	for (const p of placed) assert.ok(typeof p.tx === 'number' && typeof p.ty === 'number');
	// 不重叠：两两 target 框无交叠
	const tb = placed.map(p => ({ minX: p.tx, minY: p.ty, maxX: p.tx + p.w, maxY: p.ty + p.h }));
	for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
		const a = tb[i], b = tb[j];
		const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
		assert.ok(!overlap, `box ${i} 与 ${j} 重叠`);
	}
});

test('shelfPack：总占地比原散布紧凑（填充率提升）', () => {
	const boxes = [
		{ box: { minX: 0, minY: 0, maxX: 40, maxY: 40 } },
		{ box: { minX: 900, minY: 900, maxX: 940, maxY: 940 } },
	];
	const placed = shelfPack(boxes, { maxRowWidth: 200, gap: 10, originX: 0, originY: 0 });
	const minX = Math.min(...placed.map(p => p.tx));
	const maxX = Math.max(...placed.map(p => p.tx + p.w));
	const maxY = Math.max(...placed.map(p => p.ty + p.h));
	const span = (maxX - minX) * maxY;
	assert.ok(span < 900 * 900, '打包后占地应远小于原散布');
});

test('clusterByWires：物理直连的器件归同一块，标签连接不强行合并', () => {
	const snap = {
		components: [
			{ designator: 'R1', pins: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
			{ designator: 'R2', pins: [{ x: 10, y: 0 }, { x: 20, y: 0 }] }, // 与 R1 共点 (10,0)
			{ designator: 'R3', pins: [{ x: 100, y: 100 }, { x: 110, y: 100 }] }, // 孤立
		],
		wires: [{ line: [0, 0, 10, 0] }, { line: [10, 0, 20, 0] }],
		netflags: [],
	};
	const cl = clusterByWires(snap);
	const sizes = cl.map(c => c.componentIdx.length).sort((a, b) => b - a);
	assert.deepEqual(sizes, [2, 1]); // R1+R2 一块，R3 一块
});
