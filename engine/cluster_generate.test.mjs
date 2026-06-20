// cluster_generate 单测:干净网表构建 + 功能聚类(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanLogical, clusterComponents, generateLayout } from './cluster_generate.mjs';

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

// 通用性:全新合成板(非 vibe-buddy)也能产功能块模块图。
test('generateLayout 通用性:全新合成板产功能块、有真实连线', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 30, minY: y - pins.length * 10, maxX: x + 30, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 30 : x + 30, y: y - pins.length * 10 + i * 20 + 10 })) });
	const rc = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const comps = [
		ic('U1', 200, 300, [{ n: 'VCC', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'R' }, { n: 'SDA', s: 'R' }]),
		ic('U2', 700, 250, [{ n: 'VCC', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'L' }, { n: 'SDA', s: 'L' }]),
		rc('C1', 150, 400), rc('C2', 650, 380), rc('R1', 400, 250),
	];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); return [c.pins[n - 1].x, c.pins[n - 1].y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [
		W('VCC', pin('U1', 1), pin('C1', 1)), W('GND', pin('U1', 2), pin('C1', 2)),
		W('VCC', pin('U2', 1), pin('C2', 1)), W('GND', pin('U2', 2), pin('C2', 2)),
		W('SCL', pin('U1', 3), pin('R1', 1)), W('SCL', pin('R1', 2), pin('U2', 3)),
		W('SDA', pin('U1', 4), pin('U2', 4)),
	];
	const r = await generateLayout({ components: comps, wires, netflags: [] }, { scale: true });
	assert.ok(r, '产出模型');
	assert.ok(r.stats.clusters >= 2, `形成 ≥2 功能块(实 ${r.stats?.clusters})`);
	assert.ok(r.stats.wires > 0, '有真实连线');
	assert.ok(r.stats.nets >= 4, 'SCL/SDA/VCC/GND 等网提取正确');
});
