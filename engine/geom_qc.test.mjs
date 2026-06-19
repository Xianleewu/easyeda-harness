// geom_qc 单测:重点验证 wireThruPin —— 导线内部压到外部引脚(EDA 拒建会短路)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geomQC } from './geom_qc.mjs';

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test('wireThruPin:线段内部压到外部引脚 → 报 hard', () => {
	// U1 在 [0..20]x[0..100],引脚 U1.1 @(50,50) 伸出本体右侧;
	// 一条线 [10,50→100,50] 水平穿过 (50,50) 这个引脚(内部,非端点)。
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [10, 50, 100, 50] }],
		netflags: [],
	};
	const r = geomQC(model);
	assert.ok(r.wireThruPin.length >= 1, '应检出线压外部引脚');
	assert.ok(r.wireThruPin[0].includes('U1.1'), 'finding 应指明 U1.1');
});

test('wireThruPin:线端点接引脚(正常连接)→ 不报', () => {
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [50, 50, 100, 50] }],   // 端点正好在引脚
		netflags: [],
	};
	const r = geomQC(model);
	assert.equal(r.wireThruPin.length, 0, '端点接引脚是正常连接,不应报');
});

test('wireThruPin:线不经过任何引脚 → 不报', () => {
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [10, 200, 100, 200] }],
		netflags: [],
	};
	const r = geomQC(model);
	assert.equal(r.wireThruPin.length, 0);
});

test('collinear:两段同 y 异网、x 范围内部重叠 → 报短路(正交点相交检测漏的这类)', () => {
	const r = geomQC({ components: [], netflags: [], wires: [
		{ net: 'NETA', line: [0, 100, 50, 100] },
		{ net: 'NETB', line: [30, 100, 80, 100] },   // 与 NETA 在 [30..50] 共线重叠
	] });
	assert.equal(r.collinear, 1, '一处共线异网短路');
	assert.ok(r.collEx[0].includes('y=100'));
});

test('collinear:竖直同 x 异网重叠 → 报;同网重叠 / 端点相贴 → 不报', () => {
	const vert = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [100, 0, 100, 50] }, { net: 'B', line: [100, 30, 100, 80] },
	] });
	assert.equal(vert.collinear, 1, '竖直异网重叠=短路');
	const same = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 100, 50, 100] }, { net: 'A', line: [30, 100, 80, 100] },
	] });
	assert.equal(same.collinear, 0, '同网重叠不是短路');
	const touch = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 100, 50, 100] }, { net: 'B', line: [50, 100, 80, 100] },
	] });
	assert.equal(touch.collinear, 0, '端点相贴不算重叠');
});

test('回归:既有字段仍在(overlaps/wireThruComp/crossings/collinear)', () => {
	const r = geomQC({ components: [], wires: [], netflags: [] });
	assert.deepEqual(r.overlaps, []);
	assert.deepEqual(r.wireThruComp, []);
	assert.equal(r.crossings, 0);
	assert.deepEqual(r.wireThruPin, []);
	assert.equal(r.collinear, 0);
});
