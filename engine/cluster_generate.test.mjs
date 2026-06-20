// cluster_generate 单测:干净网表构建 + 功能聚类(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanLogical, clusterComponents } from './cluster_generate.mjs';

// 合成快照:U1.1-C1.1 经有名线 SIG;C1.2 经 GND 标接地;U1.2 仅接无名线(NC,应不入网)。
const snap = {
	components: [
		{ designator: 'U1', x: 0, y: 0, pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 0, y: 10 }] },
		{ designator: 'C1', x: 100, y: 0, pins: [{ num: '1', x: 100, y: 0 }, { num: '2', x: 100, y: 10 }] },
	],
	wires: [
		{ net: 'SIG', line: [0, 0, 100, 0] },
		{ net: '', line: [0, 10, 50, 10] },
	],
	netflags: [{ net: 'GND', symbol: 'Ground-GND', x: 100, y: 10 }],
};

test('buildCleanLogical:有名线构网,NC脚不入网', () => {
	const lg = buildCleanLogical(snap);
	const sig = lg.nets.find(n => n.name === 'SIG');
	const gnd = lg.nets.find(n => n.name === 'GND');
	assert.ok(sig, 'SIG 网存在');
	assert.deepEqual(sig.pins.sort(), ['C1.1', 'U1.1']);
	assert.equal(sig.class, 'signal');
	assert.ok(gnd && gnd.class === 'ground' && gnd.pins.includes('C1.2'));
	// U1.2 仅接无名线 → 不在任何网(NC)
	const allPins = new Set(lg.nets.flatMap(n => n.pins));
	assert.equal(allPins.has('U1.2'), false, 'NC脚不入网');
});

test('buildCleanLogical:power/ground 分类正确', () => {
	const lg = buildCleanLogical({
		components: [{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 0, y: 10 }] }],
		wires: [{ net: 'VCC_3V3', line: [0, 0, 0, 0] }, { net: '+5V', line: [0, 10, 0, 10] }],
		netflags: [],
	});
	assert.equal(lg.nets.find(n => n.name === 'VCC_3V3').class, 'power');
	assert.equal(lg.nets.find(n => n.name === '+5V').class, 'power');
});

test('clusterComponents:无源件归到共享 signal 网的 IC', () => {
	const lg = buildCleanLogical(snap);
	const cl = clusterComponents(snap, lg);
	assert.ok(cl.has('U1'), 'U1 是锚点');
	assert.ok(cl.get('U1').includes('C1'), 'C1(共享 SIG)归到 U1');
});

test('clusterComponents:无 IC 锚点返回 null', () => {
	const cl = clusterComponents({ components: [{ designator: 'R1', pins: [] }] }, { nets: [] });
	assert.equal(cl, null);
});
