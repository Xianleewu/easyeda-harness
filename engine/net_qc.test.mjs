// net_qc 通用网级体检测试 —— 全部合成夹具,零特定电路内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netQC, netRepairPlan } from './net_qc.mjs';

test('短路:不同命名网经导线相连', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] }],
		// 一条线两端分别标 SIG_A 与 SIG_B(不同信号网)→ 经线相连 = 短路
		wires: [{ net: 'SIG_A', line: [0, 0, 40, 0] }],
		netflags: [{ net: 'SIG_A', x: 0, y: 0 }, { net: 'SIG_B', x: 40, y: 0 }],
	};
	const r = netQC(snap);
	assert.equal(r.shorts.length, 1);
	assert.deepEqual(r.shorts[0].nets.sort(), ['SIG_A', 'SIG_B']);
});

test('同轨别名不报短路(共享电压 token / 地网)', () => {
	const snap = {
		components: [], wires: [{ net: 'VBUS_5V', line: [0, 0, 40, 0] }],
		netflags: [{ net: 'VBUS_5V', x: 0, y: 0 }, { net: '+5V', x: 40, y: 0 }],
	};
	assert.equal(netQC(snap).shorts.length, 0, '+5V 与 VBUS_5V 共享 5V token,视为同轨别名');
});

test('杂散电源标:电源 flag 落在他网导线上', () => {
	const snap = {
		components: [],
		wires: [{ net: 'SIG_DATA', line: [0, 0, 60, 0] }],   // 信号线
		netflags: [{ net: '+5V', x: 30, y: 0 }],             // +5V 标压在信号线中部 → 串电源到信号
	};
	const r = netQC(snap);
	assert.equal(r.strayPowerFlags.length, 1);
	assert.equal(r.strayPowerFlags[0].onNet, 'SIG_DATA');
});

test('杂散电源标:落在同轨导线上不算缺陷', () => {
	const snap = {
		components: [], wires: [{ net: 'VCC_3V3', line: [0, 0, 60, 0] }],
		netflags: [{ net: 'VCC_3V3', x: 30, y: 0 }],   // 同网标,正常
	};
	assert.equal(netQC(snap).strayPowerFlags.length, 0);
});

test('畸形导线:回折段', () => {
	const snap = { components: [], wires: [{ net: 'N', line: [0, 0, 20, 0, 40, 0, 20, 0] }], netflags: [] };
	const r = netQC(snap);
	assert.equal(r.malformedWires.length, 1);
	assert.equal(r.malformedWires[0].kind, 'backtrack');
});

test('畸形导线:零长段', () => {
	const snap = { components: [], wires: [{ net: 'N', line: [10, 10, 10, 10, 30, 10] }], netflags: [] };
	assert.equal(netQC(snap).malformedWires[0].kind, 'zero-length');
});

test('悬空网标:下方无线无脚', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] }],
		wires: [{ net: 'A', line: [0, 0, 40, 0] }],
		netflags: [{ net: 'A', x: 0, y: 0 }, { net: 'B', x: 500, y: 500 }],   // B 标孤立悬空
	};
	const r = netQC(snap);
	assert.equal(r.danglingFlags.length, 1);
	assert.equal(r.danglingFlags[0].net, 'B');
});

test('ERC 引脚类型:无源件脚错标 IN/OUT(应 Passive)', () => {
	const snap = {
		components: [
			{ designator: 'R5', pins: [{ num: '1', x: 0, y: 0, type: 'IN' }, { num: '2', x: 40, y: 0, type: 'IN' }] },
			{ designator: 'C3', pins: [{ num: '1', x: 0, y: 0, type: 'Passive' }, { num: '2', x: 0, y: 40, type: 'Passive' }] },
			{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0, type: 'IN' }] },   // IC 的 IN 脚不报(非无源件)
		],
		wires: [], netflags: [],
	};
	const r = netQC(snap);
	assert.equal(r.ercPinType.length, 2, '仅 R5 的两个 IN 脚应报');
	assert.ok(r.ercPinType.every(e => e.ref.startsWith('R5')));
});

test('ERC 引脚类型:无 pin.type 的旧快照不报(优雅降级)', () => {
	const snap = { components: [{ designator: 'R1', pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 40, y: 0 }] }], wires: [], netflags: [] };
	assert.equal(netQC(snap).ercPinType.length, 0);
});

test('修复规划:杂散电源短路标 + 畸形线 → 可修操作;ERC/短路归 manualOnly', () => {
	const snap = {
		components: [{ designator: 'R1', pins: [{ num: '1', x: 0, y: 0, type: 'IN' }, { num: '2', x: 40, y: 0, type: 'IN' }] }],
		wires: [
			{ net: 'SIG', line: [0, 0, 60, 0] },                 // 信号线
			{ net: 'N', line: [10, 10, 30, 10, 50, 10, 30, 10] },  // 畸形回折
		],
		netflags: [{ net: '+5V', x: 30, y: 0 }],                 // 杂散电源标压信号线
	};
	const plan = netRepairPlan(snap);
	assert.equal(plan.ops.filter(o => o.kind === 'delete-flag').length, 1);
	assert.equal(plan.ops.filter(o => o.kind === 'straighten-wire').length, 1);
	assert.equal(plan.manualOnly.ercPinType, 2, 'R1 两个 IN 脚需符号库手修');
});

test('干净网表:零缺陷', () => {
	const snap = {
		components: [{ designator: 'X1', pins: [{ num: '1', x: 0, y: 0 }] }, { designator: 'X2', pins: [{ num: '1', x: 40, y: 0 }] }],
		wires: [{ net: 'NET1', line: [0, 0, 40, 0] }],
		netflags: [{ net: 'NET1', x: 0, y: 0 }],
	};
	const r = netQC(snap);
	assert.equal(r.shorts.length, 0);
	assert.equal(r.strayPowerFlags.length, 0);
	assert.equal(r.malformedWires.length, 0);
	assert.equal(r.danglingFlags.length, 0);
});
