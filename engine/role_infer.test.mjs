// role_infer 单测：角色推断 + 模块聚类(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferRoles } from './role_infer.mjs';

const logical = {
	parts: [
		{ ref: 'U1', kind: 'ic', pinCount: 30 },      // 最多脚 → controller
		{ ref: 'U2', kind: 'ic', pinCount: 5 },       // 接两电源网 → regulator
		{ ref: 'J1', kind: 'connector', pinCount: 6 },
		{ ref: 'R1', kind: 'resistor', pinCount: 2 },
		{ ref: 'LED1', kind: 'led', pinCount: 2 },
		{ ref: 'SW1', kind: 'switch', pinCount: 2 },
		{ ref: 'Q1', kind: 'transistor', pinCount: 3 },
	],
	nets: [
		{ name: 'USB_DP', class: 'signal', pins: ['J1.1', 'R1.1'] },
		{ name: 'USB_DP_MCU', class: 'signal', pins: ['R1.2', 'U1.5'] },
		{ name: 'LED_CTRL', class: 'signal', pins: ['U1.6', 'LED1.1'] },
		{ name: 'BTN', class: 'signal', pins: ['U1.7', 'SW1.1'] },
		{ name: 'GATE', class: 'signal', pins: ['U1.8', 'Q1.1'] },
		{ name: 'VCC_3V3', class: 'power', pins: ['U2.3', 'U1.1', 'R1.1'] },
		{ name: 'VIN', class: 'power', pins: ['U2.1', 'J1.2'] },
		{ name: 'GND', class: 'ground', pins: ['U1.2', 'U2.2', 'LED1.2'] },
	],
};

function roleOf(r, ref) { return r.parts.find(p => p.ref === ref).role; }

test('角色:最多脚 ic → controller', () => {
	const r = inferRoles(logical);
	assert.equal(roleOf(r, 'U1'), 'controller');
	assert.equal(r.controller, 'U1');
});

test('角色:接≥2 电源/地网的非主 ic → regulator', () => {
	const r = inferRoles(logical);
	assert.equal(roleOf(r, 'U2'), 'regulator');
});

test('角色:接 1 电源 + 1 地的非主 ic → ic(负载外设不是稳压器)', () => {
	const lg = {
		parts: [{ ref: 'U1', kind: 'ic', pinCount: 30 }, { ref: 'U3', kind: 'ic', pinCount: 8 }],
		nets: [
			{ name: 'VDD', class: 'power', pins: ['U3.1', 'U1.1'] },
			{ name: 'GND', class: 'ground', pins: ['U3.8', 'U1.2'] },
			{ name: 'DAT', class: 'signal', pins: ['U3.2', 'U1.5'] },
		],
	};
	assert.equal(inferRoles(lg).parts.find(p => p.ref === 'U3').role, 'ic');
});

test('角色:接 ≥2 电源网的非主 ic → regulator(有输入+输出电源轨)', () => {
	const lg = {
		parts: [{ ref: 'U1', kind: 'ic', pinCount: 30 }, { ref: 'U4', kind: 'ic', pinCount: 5 }],
		nets: [
			{ name: 'VIN', class: 'power', pins: ['U4.1', 'U1.1'] },
			{ name: 'VOUT', class: 'power', pins: ['U4.3', 'U1.2'] },
			{ name: 'GND', class: 'ground', pins: ['U4.2'] },
		],
	};
	assert.equal(inferRoles(lg).parts.find(p => p.ref === 'U4').role, 'regulator');
});

test('角色:连接器/无源/指示/开关/驱动', () => {
	const r = inferRoles(logical);
	assert.equal(roleOf(r, 'J1'), 'connector');
	assert.equal(roleOf(r, 'R1'), 'support');
	assert.equal(roleOf(r, 'LED1'), 'indicator');
	assert.equal(roleOf(r, 'SW1'), 'input');
	assert.equal(roleOf(r, 'Q1'), 'switch');
});

test('模块聚类:控制器自成一模块;共享信号网的非控制器件归一模块', () => {
	const r = inferRoles(logical);
	const modOf = ref => r.modules.find(m => m.parts.includes(ref));
	// 控制器独立
	assert.deepEqual(modOf('U1').parts, ['U1']);
	// J1 与 R1 共享 USB_DP → 同模块
	assert.equal(modOf('J1').id, modOf('R1').id);
	// LED1 不与 J1 同模块(只经控制器相连，控制器枢纽不合并)
	assert.notEqual(modOf('LED1').id, modOf('J1').id);
});

test('列分配:连接器/电源在左、控制器居中、负载在右', () => {
	const r = inferRoles(logical);
	const col = ref => r.modules.find(m => m.parts.includes(ref)).column;
	assert.equal(col('U1'), 'center');
	assert.equal(col('J1'), 'left');
	assert.equal(col('LED1'), 'right');
});
