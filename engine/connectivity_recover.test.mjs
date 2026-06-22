// connectivity_recover 测试 —— 全合成夹具,零特定电路内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverConnectivity } from './connectivity_recover.mjs';

test('无名本地线连两脚 → 本地网(class local)', () => {
	const snap = {
		components: [
			{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'X2', pins: [{ num: '1', x: 40, y: 0 }] },
		],
		wires: [{ net: '', line: [0, 0, 40, 0] }],   // 无名线连 X1.1—X2.1
		netflags: [],
	};
	const r = recoverConnectivity(snap);
	const loc = r.nets.find(n => n.class === 'local');
	assert.ok(loc, '应产本地网');
	assert.deepEqual(loc.pins.sort(), ['X1.1', 'X2.1']);
});

test('经无名线接入命名网的脚 → 补回命名网', () => {
	const snap = {
		components: [
			{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'X2', pins: [{ num: '1', x: 80, y: 0 }] },
		],
		// X1.1 —命名线SIG— 中点 —无名线— X2.1:X2.1 经无名线接入 SIG
		wires: [{ net: 'SIG', line: [0, 0, 40, 0] }, { net: '', line: [40, 0, 80, 0] }],
		netflags: [{ net: 'SIG', x: 0, y: 0 }],
	};
	const r = recoverConnectivity(snap);
	const sig = r.nets.find(n => n.name === 'SIG');
	assert.ok(sig.pins.includes('X1.1') && sig.pins.includes('X2.1'), 'X2.1 应补入 SIG');
	assert.equal(r.nets.filter(n => n.class === 'local').length, 0, '无残留本地网');
});

test('脚落线段中部(非端点)也并入', () => {
	const snap = {
		components: [
			{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'X2', pins: [{ num: '1', x: 100, y: 0 }] },
			{ designator: 'X3', pins: [{ num: '1', x: 50, y: 0 }] },   // 落在 X1—X2 线段中部
		],
		wires: [{ net: '', line: [0, 0, 100, 0] }],
		netflags: [],
	};
	const r = recoverConnectivity(snap);
	const loc = r.nets.find(n => n.class === 'local');
	assert.equal(loc.pins.length, 3, 'X3.1 中部脚应并入');
});

test('单脚 stub(无名线只接 1 脚)→ 不成网', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] }],
		wires: [{ net: '', line: [0, 0, 30, 0] }],   // 只连 X1.1,另一端无脚
		netflags: [],
	};
	const r = recoverConnectivity(snap);
	assert.equal(r.nets.filter(n => n.class === 'local').length, 0, '单脚不成本地网');
});

test('电源/地标 → 命名网 + 分类正确', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] }, { designator: 'X2', pins: [{ num: '1', x: 0, y: 40 }] }],
		wires: [{ net: '', line: [0, 0, 0, 40] }],
		netflags: [{ net: 'GND', x: 0, y: 0 }],
	};
	const r = recoverConnectivity(snap);
	const gnd = r.nets.find(n => n.name === 'GND');
	assert.ok(gnd && gnd.class === 'ground' && gnd.pins.length === 2, 'GND 接地类、连 2 脚');
});

test('stats:覆盖统计', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 0, y: 99 }] }, { designator: 'X2', pins: [{ num: '1', x: 40, y: 0 }] }],
		wires: [{ net: 'A', line: [0, 0, 40, 0] }],
		netflags: [{ net: 'A', x: 0, y: 0 }],
	};
	const r = recoverConnectivity(snap);
	assert.equal(r.stats.totalPins, 3);
	assert.equal(r.stats.covered, 2, 'X1.2 无线→不覆盖');
});
