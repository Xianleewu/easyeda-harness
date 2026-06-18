// net_derive 单测:引脚→网+类派生(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePinNets } from './net_derive.mjs';

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
