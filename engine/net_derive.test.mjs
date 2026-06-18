// net_derive 单测:引脚→网+类派生(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePinNets, deriveSupportEndpoints, deriveModulePinNets } from './net_derive.mjs';

const comp = { designator: 'J1', pins: [{ num: '1' }, { num: '2' }, { num: '3' }] };
const logical = {
	nets: [
		{ name: 'GND', class: 'ground', pins: ['J1.1', 'U1.5'] },
		{ name: 'D-', class: 'signal', pins: ['J1.2', 'U1.6'] },
		{ name: 'V5', class: 'power', pins: ['U2.1', 'C1.1'] },
	],
};

test('net_derive:引脚映射其网名+类;未连引脚不收', () => {
	const pn = derivePinNets(comp, logical);
	assert.deepEqual(pn['1'], { name: 'GND', class: 'ground' });
	assert.deepEqual(pn['2'], { name: 'D-', class: 'signal' });
	assert.ok(!('3' in pn));   // J1.3 未在任何网 → 不收
});

test('net_derive:空 pins / 无 nets → 空对象', () => {
	assert.deepEqual(derivePinNets({ designator: 'X', pins: [] }, logical), {});
	assert.deepEqual(derivePinNets(comp, {}), {});
});

test('net_derive:确定性', () => {
	assert.deepEqual(derivePinNets(comp, logical), derivePinNets(comp, logical));
});

test('net_derive:deriveSupportEndpoints 取首件 pin2(top)、末件 pin1(bottom)', () => {
	const parts = [{ designator: 'R1' }, { designator: 'R2' }];
	const lg = { nets: [
		{ name: 'V5', class: 'power', pins: ['R1.2'] },
		{ name: 'GND', class: 'ground', pins: ['R2.1'] },
	] };
	assert.deepEqual(deriveSupportEndpoints(parts, lg), { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } });
});

test('net_derive:deriveSupportEndpoints 单件取 pin2/pin1;空 parts 空对象', () => {
	const lg = { nets: [
		{ name: 'V3V3', class: 'power', pins: ['C1.2'] },
		{ name: 'GND', class: 'ground', pins: ['C1.1'] },
	] };
	assert.deepEqual(deriveSupportEndpoints([{ designator: 'C1' }], lg), { top: { name: 'V3V3', class: 'power' }, bottom: { name: 'GND', class: 'ground' } });
	assert.deepEqual(deriveSupportEndpoints([], lg), {});
});

test('net_derive:deriveModulePinNets 跨件以 des.num 为键', () => {
	const parts = [
		{ designator: 'Q1', pins: [{ num: '1' }, { num: '2' }] },
		{ designator: 'R5', pins: [{ num: '1' }, { num: '2' }] },
	];
	const lg = { nets: [
		{ name: 'BASE', class: 'signal', pins: ['Q1.1', 'R5.2'] },
		{ name: 'GND', class: 'ground', pins: ['Q1.2'] },
	] };
	const pn = deriveModulePinNets(parts, lg);
	assert.deepEqual(pn['Q1.1'], { name: 'BASE', class: 'signal' });
	assert.deepEqual(pn['Q1.2'], { name: 'GND', class: 'ground' });
	assert.deepEqual(pn['R5.2'], { name: 'BASE', class: 'signal' });
	assert.ok(!('R5.1' in pn));   // R5.1 未连 → 不收
});
