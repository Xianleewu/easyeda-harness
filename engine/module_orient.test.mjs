import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorModuleX, moduleCenterX, mirrorModuleY, moduleCenterY } from './module_orient.mjs';

const mk = () => ({
	components: [{ designator: 'R1', x: 10, y: 0, mirror: false, bbox: { minX: 5, minY: -5, maxX: 15, maxY: 5 }, pins: [{ num: '1', x: 5, y: 0 }, { num: '2', x: 15, y: 0 }] }],
	wires: [{ net: 'N', line: [5, 0, -10, 0] }],          // R1.1(5,0) → 左到 (-10,0)
	netflags: [{ net: 'N', x: -10, y: 0, textX: -10, textY: 0, alignMode: 8, rot: 180 }],   // 标签在 (-10,0) 向左
});

test('mirrorModuleX:件/脚/线/标签 x 全翻(绕 cx=0)', () => {
	const s = mk();
	mirrorModuleX(s, 0);
	assert.equal(s.components[0].pins[0].x, -5, 'R1.1 (5)→(-5)');
	assert.equal(s.components[0].pins[1].x, -15, 'R1.2 (15)→(-15)');
	assert.deepEqual(s.wires[0].line, [-5, 0, 10, 0], '线端点全翻');
	assert.equal(s.netflags[0].x, 10, '标签 (-10)→(10)');
	assert.equal(s.components[0].mirror, true, 'mirror 翻');
});

test('镜像保连通:脚与线端点变换后仍重合', () => {
	const s = mk();
	// 镜像前:R1.1(5,0) 与线端点(5,0)重合;线另一端(-10,0)与标签(-10,0)重合
	mirrorModuleX(s, 0);
	const p1 = s.components[0].pins[0];        // R1.1
	const wStart = [s.wires[0].line[0], s.wires[0].line[1]];
	const wEnd = [s.wires[0].line[2], s.wires[0].line[3]];
	const flag = s.netflags[0];
	assert.deepEqual([p1.x, p1.y], wStart, 'R1.1 仍与线起点重合(连通保持)');
	assert.deepEqual(wEnd, [flag.x, flag.y], '线终点仍与标签重合(连通保持)');
});

test('标签朝向翻转:左(8/180)↔右(6/0)', () => {
	const s = mk();
	mirrorModuleX(s, 0);
	assert.equal(s.netflags[0].alignMode, 6, 'alignMode 8→6');
	assert.equal(s.netflags[0].rot, 0, 'rot 180→0');
});

test('moduleCenterX:件 bbox 水平中心', () => {
	assert.equal(moduleCenterX(mk()), 10);   // bbox 5..15 → 中心 10
});

test('mirrorModuleY:垂直翻 + 保连通 + 对合', () => {
	const s = { components: [{ designator: 'R1', y: 10, bbox: { minX: 0, minY: 5, maxX: 10, maxY: 15 }, pins: [{ num: '1', x: 5, y: 5 }] }], wires: [{ net: 'N', line: [5, 5, 5, -10] }], netflags: [{ net: 'N', x: 5, y: -10, rot: 90 }] };
	mirrorModuleY(s, 0);
	assert.equal(s.components[0].pins[0].y, -5, '脚 (5)→(-5)');
	assert.deepEqual(s.wires[0].line, [5, -5, 5, 10], '线 y 翻');
	assert.equal(s.netflags[0].y, 10, '标签 (-10)→(10)');
	assert.deepEqual([s.components[0].pins[0].x, s.components[0].pins[0].y], [s.wires[0].line[0], s.wires[0].line[1]], '脚仍与线起点重合(连通)');
	assert.equal(s.netflags[0].rot, 270, 'rot 90→270');
	mirrorModuleY(s, 0); assert.equal(s.components[0].pins[0].y, 5, '两次复原');
});

test('moduleCenterY:件 bbox 垂直中心', () => { assert.equal(moduleCenterY({ components: [{ bbox: { minX: 0, minY: 5, maxX: 10, maxY: 15 } }] }), 10); });

test('镜像两次=原状(对合)', () => {
	const s = mk(); const cx = moduleCenterX(s);
	const ox = JSON.parse(JSON.stringify(s));
	mirrorModuleX(s, cx); mirrorModuleX(s, cx);
	assert.deepEqual(s.components[0].pins.map(p => p.x), ox.components[0].pins.map(p => p.x), '两次镜像复原脚位');
	assert.deepEqual(s.wires[0].line, ox.wires[0].line, '两次镜像复原线');
});
