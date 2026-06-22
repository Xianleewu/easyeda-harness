// layout_audit 综合诊断探针测试 —— 全合成夹具,零特定电路内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAudit } from './layout_audit.mjs';

test('连接完整性:有线连但不进网表 → lost-connection(critical)', () => {
	const snap = {
		components: [{ designator: 'X1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, pins: [{ num: '1', x: 0, y: 10 }] }],
		wires: [{ net: '', line: [0, 10, 40, 10] }],   // 无名线接 X1.1 → 不进命名网
		netflags: [],
	};
	const r = layoutAudit(snap);
	assert.ok(r.categories.连接完整性.lostConn >= 1, '应检出漏连脚');
});

test('连接完整性:浮空脚未标 NC → floating(high);标 NC 不报', () => {
	const snap = {
		components: [{ designator: 'X1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, pins: [{ num: '1', x: 0, y: 10 }, { num: '2', x: 0, y: 20, noConnected: true }] }],
		wires: [], netflags: [],
	};
	const r = layoutAudit(snap);
	assert.equal(r.categories.连接完整性.floating, 1, '仅未标 NC 的浮空脚报');
	assert.equal(r.categories.连接完整性.ncFloat, 1);
});

test('器件间距:bbox 重叠 → overlap(critical);过近 → too-tight', () => {
	const snap = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, x: 0, y: 0, pins: [] },
			{ designator: 'B', bbox: { minX: 10, minY: 0, maxX: 30, maxY: 20 }, x: 10, y: 0, pins: [] },   // 与 A 重叠
			{ designator: 'C', bbox: { minX: 100, minY: 0, maxX: 120, maxY: 20 }, x: 100, y: 0, pins: [] },
			{ designator: 'D', bbox: { minX: 124, minY: 0, maxX: 144, maxY: 20 }, x: 124, y: 0, pins: [] },   // 与 C 净距 4px
		],
		wires: [], netflags: [],
	};
	const r = layoutAudit(snap);
	assert.ok(r.categories.器件间距对齐.overlap >= 1, '应检出重叠');
	assert.ok(r.categories.器件间距对齐.tooTight >= 1, '应检出过密');
});

test('走线规范:斜线段 + 线穿件', () => {
	const snap = {
		components: [{ designator: 'U1', bbox: { minX: 50, minY: 50, maxX: 100, maxY: 100 }, x: 50, y: 50, pins: [] }],
		wires: [
			{ net: 'N', line: [0, 0, 40, 30] },        // 斜线
			{ net: 'M', line: [40, 75, 120, 75] },     // 横穿 U1 体
		],
		netflags: [],
	};
	const r = layoutAudit(snap);
	assert.ok(r.categories.走线规范.diag >= 1, '应检出斜线');
	assert.ok(r.categories.走线规范.wireThruComp >= 1, '应检出线穿件');
});

test('标注完整:无源件缺值 → missing-value', () => {
	const snap = {
		components: [
			{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 8 }, pins: [], value: '' },
			{ designator: 'R2', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 8 }, pins: [], value: '10k' },
			{ designator: 'C1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 8 }, pins: [], attrs: [{ key: 'Value', value: '={Value}' }] },   // 未解析模板
		],
		wires: [], netflags: [],
	};
	const r = layoutAudit(snap);
	assert.equal(r.categories.标注完整.noVal, 2, 'R1(空)与 C1(模板串)报,R2(10k)不报');
});

test('图纸结构:内容 bbox / 填充率 / 纵横比', () => {
	const snap = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, pins: [] },
			{ designator: 'B', bbox: { minX: 100, minY: 0, maxX: 140, maxY: 40 }, pins: [] },
		],
		wires: [], netflags: [],
	};
	const r = layoutAudit(snap);
	assert.equal(r.categories.标签结构.contentW, 140);
	assert.equal(r.categories.标签结构.contentH, 40);
	assert.ok(r.categories.标签结构.aspect >= 3, '140/40=3.5 纵横比');
});

test('干净小板:总问题为 0 或极低', () => {
	const snap = {
		components: [
			{ designator: 'X1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, x: 0, y: 0, pins: [{ num: '1', x: 0, y: 10 }] },
			{ designator: 'X2', bbox: { minX: 60, minY: 0, maxX: 80, maxY: 20 }, x: 60, y: 0, pins: [{ num: '1', x: 80, y: 10 }] },
		],
		wires: [{ net: 'NET1', line: [0, 10, 80, 10] }],
		netflags: [{ net: 'NET1', x: 0, y: 10 }],
	};
	const r = layoutAudit(snap);
	assert.equal(r.categories.连接完整性.lostConn, 0, '命名网覆盖→无漏连');
	assert.equal(r.categories.走线规范.shorts, 0);
});

test('summary 聚合:total + byCategory + byCriticality 结构', () => {
	const snap = { components: [], wires: [], netflags: [] };
	const r = layoutAudit(snap);
	assert.ok('total' in r.summary && 'byCategory' in r.summary && 'byCriticality' in r.summary);
	assert.equal(typeof r.summary.total, 'number');
});
