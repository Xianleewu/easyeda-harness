import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directRouteClose } from './direct_route.mjs';

const mk = () => ({
	components: [
		{ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, pins: [{ num: '1', x: 40, y: 20 }] },
		{ designator: 'U2', bbox: { minX: 100, minY: 0, maxX: 140, maxY: 40 }, pins: [{ num: '1', x: 100, y: 20 }] },
	],
	wires: [{ net: 'SIG', line: [40, 20, 60, 20] }, { net: 'SIG', line: [80, 20, 100, 20] }],   // 两侧逃逸桩
	netflags: [{ net: 'SIG', kind: 'sig', x: 60, y: 20 }, { net: 'SIG', kind: 'sig', x: 80, y: 20 }],   // 两侧逃逸标签
});
const NET = [{ name: 'SIG', class: 'signal', pins: ['U1.1', 'U2.1'] }];

test('近 2 脚信号网 + 路径清晰 → 转直连线、删两侧标签', () => {
	const m = mk();
	const r = directRouteClose(m, NET, { maxDist: 200 });
	assert.equal(r.converted, 1);
	assert.equal(m.netflags.filter(f => f.net === 'SIG').length, 0, '逃逸标签已删');
	const sigWires = m.wires.filter(w => w.net === 'SIG');
	assert.equal(sigWires.length, 1, '只剩一条直连');
	assert.deepEqual(sigWires[0].line, [40, 20, 100, 20], 'pin→pin 直连');
});

test('路径穿器件 bbox → 不转,保留标签', () => {
	const m = mk();
	m.components.push({ designator: 'U3', bbox: { minX: 55, minY: 0, maxX: 85, maxY: 40 }, pins: [] });   // 挡在中间
	const r = directRouteClose(m, NET, { maxDist: 200 });
	assert.equal(r.converted, 0);
	assert.equal(m.netflags.filter(f => f.net === 'SIG').length, 2, '标签保留');
});

test('远距(>maxDist)→ 不转', () => {
	const m = mk();
	m.components[1].pins[0].x = 1000; m.components[1].bbox = { minX: 1000, minY: 0, maxX: 1040, maxY: 40 };
	const r = directRouteClose(m, NET, { maxDist: 200 });
	assert.equal(r.converted, 0);
});

test('多脚网(≠2脚)→ 不转(保留标签做远距连接)', () => {
	const m = mk();
	m.components.push({ designator: 'U4', bbox: { minX: 200, minY: 0, maxX: 240, maxY: 40 }, pins: [{ num: '1', x: 200, y: 20 }] });
	const r = directRouteClose(m, [{ name: 'SIG', class: 'signal', pins: ['U1.1', 'U2.1', 'U4.1'] }], { maxDist: 5000 });
	assert.equal(r.converted, 0);
});

test('L 形直连(异 x 异 y)+ 角点不入 bbox → 转', () => {
	const m = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, pins: [{ num: '1', x: 20, y: 10 }] },
			{ designator: 'B', bbox: { minX: 100, minY: 100, maxX: 120, maxY: 120 }, pins: [{ num: '1', x: 110, y: 100 }] },
		],
		wires: [], netflags: [{ net: 'S', kind: 'sig', x: 30, y: 10 }, { net: 'S', kind: 'sig', x: 110, y: 90 }],
	};
	const r = directRouteClose(m, [{ name: 'S', class: 'signal', pins: ['A.1', 'B.1'] }], { maxDist: 500 });
	assert.equal(r.converted, 1);
});
