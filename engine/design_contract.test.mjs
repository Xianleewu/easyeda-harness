// design_contract 单测:审计模型 → 通用合成契约(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract, contractQC } from './design_contract.mjs';

const logical = {
	parts: [
		{ ref: 'U1', kind: 'ic', pinCount: 30 },
		{ ref: 'U2', kind: 'ic', pinCount: 5 },
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

const roles = inferRoles(logical);
const contract = synthesizeContract(roles, logical);

test('列:left/center/right → 有序 input/control/output,控制器在中列', () => {
	const ids = contract.columns.map(c => c.id);
	assert.deepEqual(ids, ['input', 'control', 'output']);
	const order = Object.fromEntries(contract.columns.map(c => [c.id, c.order]));
	assert.ok(order.input < order.control && order.control < order.output);
	assert.equal(contract.meta.controller, 'U1');
	assert.equal(contract.meta.columnCount, 3);
});

test('模块区:每模块有整数列号、正格尺寸、间距预算', () => {
	assert.equal(contract.modules.length, roles.modules.length);
	for (const m of contract.modules) {
		assert.ok(Number.isInteger(m.region.col) && Number.isInteger(m.region.row));
		assert.ok(m.region.wCells > 0 && m.region.hCells > 0);
		assert.deepEqual(Object.keys(m.gap).sort(), ['bottom', 'left', 'right', 'top']);
	}
});

test('标签列:跨模块 signal 网出标签;power/ground 不出;源端 routeEnd=from', () => {
	const nets = contract.labelColumns.map(l => l.net);
	assert.ok(nets.includes('LED_CTRL'));       // mctrl + LED 模块 → 跨模块
	assert.ok(nets.includes('USB_DP_MCU'));     // R1 模块 + mctrl → 跨模块
	assert.ok(!nets.includes('USB_DP'));        // J1 与 R1 同模块 → 不出
	assert.ok(!nets.includes('VCC_3V3'));       // power
	assert.ok(!nets.includes('GND'));           // ground
	assert.ok(contract.labelColumns.every(l => l.class === 'signal'));
	const led = contract.labelColumns.filter(l => l.net === 'LED_CTRL');
	assert.equal(led.length, 2);                // 两个端模块各一条
	assert.equal(led.filter(l => l.routeEnd === 'from').length, 1);
});

test('布线通道:相邻列之间各一条', () => {
	assert.equal(contract.routingChannels.length, contract.columns.length - 1);
	assert.deepEqual(contract.routingChannels[0].betweenColumns, ['input', 'control']);
});
