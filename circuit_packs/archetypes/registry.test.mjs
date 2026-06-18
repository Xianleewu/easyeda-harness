// 角色原型注册表单测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getArchetype, renderArchetype } from './registry.mjs';
import { supportArchetype } from './support.mjs';

const passive = d => ({
	designator: d,
	pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
	localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
});

test('registry:getArchetype(support) 返回 supportArchetype', () => {
	assert.equal(getArchetype('support'), supportArchetype);
});

test('registry:renderArchetype 分发到对应原型', () => {
	const cell = renderArchetype('support', { parts: [passive('R1'), passive('R2')], anchor: { x: 0, y: 0 }, nets: {} });
	assert.ok(cell.place.R1 && cell.place.R2);
	assert.ok(Array.isArray(cell.wires));
});

test('registry:未知 role 抛错', () => {
	assert.throws(() => getArchetype('nope'));
	assert.throws(() => renderArchetype('nope', {}));
});
