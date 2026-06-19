// svg 渲染器单测:netflag 标签文字须含网名 + 旋转注释(读 n.rot,非笔误 n.rotation)。
// 守护视觉证据正确——历史 bug:读 n.rotation(实际字段 n.rot)→ 每个标签渲染成「网名 (rundefined)」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSVG } from './svg.mjs';

test('netflag 标签:渲染网名 + 旋转(n.rot),不含 rundefined', () => {
	const svg = renderSVG({
		components: [],
		wires: [],
		netflags: [
			{ kind: 'sig', net: 'NB16', x: 100, y: 100, rot: 180, alignMode: 6 },
			{ kind: 'sig', net: 'GND', x: 200, y: 100, rot: 0, alignMode: 8 },
		],
	});
	assert.ok(!svg.includes('rundefined'), '不得出现 rundefined（n.rotation 笔误）');
	assert.ok(svg.includes('NB16 (r180)'), 'NB16 标签含正确旋转 r180');
	assert.ok(svg.includes('GND (r0)'), 'GND 标签含正确旋转 r0');
});

test('netflag 标签:rot 缺失时兜底 r0(不渲染 undefined)', () => {
	const svg = renderSVG({ components: [], wires: [], netflags: [{ net: 'X', x: 0, y: 0 }] });
	assert.ok(!svg.includes('undefined'), 'rot 缺失也不得渲染 undefined');
	assert.ok(svg.includes('X (r0)'), '兜底 r0');
});
