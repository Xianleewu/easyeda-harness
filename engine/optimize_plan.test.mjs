// optimize_plan 单测：分类结果 + 决策 → 可执行动作 / 待人工 / 待决策
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from './optimize_plan.mjs';

const netLabel = { category: 'unconnectedNetLabel', kind: 'delete-net-label', ref: '$3I165', disposition: 'auto' };
const pinR = { category: 'floatingPin', kind: 'floating-pin', ref: 'R9.2', disposition: 'ask', suggestion: 'wire' };
const pinSW = { category: 'floatingPin', kind: 'floating-pin', ref: 'SW2.B', disposition: 'ask', suggestion: 'nc' };
const dev = { category: 'deviceStandardization', kind: 'standardize-device', ref: 'SW2', detail: { edaId: '$3I6' }, disposition: 'resolve' };

test('auto 网标 → 直接进 actions(delete)，无需决策', () => {
	const p = buildPlan([netLabel], {});
	assert.equal(p.actions.length, 1);
	assert.equal(p.actions[0].op, 'delete-net-label');
	assert.equal(p.actions[0].ref, '$3I165');
	assert.equal(p.pending.length, 0);
});

test('悬空引脚 决策=nc → actions(add-noconnect)', () => {
	const p = buildPlan([pinSW], { 'SW2.B': 'nc' });
	assert.equal(p.actions.length, 1);
	assert.equal(p.actions[0].op, 'add-noconnect');
	assert.equal(p.actions[0].ref, 'SW2.B');
});

test('悬空引脚 决策=wire → flagged(不自动猜目标网)', () => {
	const p = buildPlan([pinR], { 'R9.2': 'wire' });
	assert.equal(p.actions.length, 0);
	assert.equal(p.flagged.length, 1);
	assert.equal(p.flagged[0].op, 'manual-connect-required');
	assert.equal(p.flagged[0].ref, 'R9.2');
});

test('悬空引脚 无决策 → pending', () => {
	const p = buildPlan([pinR], {});
	assert.equal(p.actions.length, 0);
	assert.equal(p.flagged.length, 0);
	assert.equal(p.pending.length, 1);
	assert.equal(p.pending[0].ref, 'R9.2');
	assert.equal(p.pending[0].suggestion, 'wire');
});

test('器件标准化 已给标准件 → actions(rebind)；未给 → pending', () => {
	const withPart = buildPlan([dev], { SW2: { standardPart: 'C123456' } });
	assert.equal(withPart.actions.length, 1);
	assert.equal(withPart.actions[0].op, 'rebind-device');
	assert.equal(withPart.actions[0].params.standardPart, 'C123456');

	const without = buildPlan([dev], {});
	assert.equal(without.actions.length, 0);
	assert.equal(without.pending.length, 1);
});

test('skip 项被忽略，不进任何桶', () => {
	const p = buildPlan([{ category: 'other', disposition: 'skip', ref: 'x' }], {});
	assert.equal(p.actions.length + p.flagged.length + p.pending.length, 0);
});

test('summary 计数', () => {
	const p = buildPlan([netLabel, pinSW, pinR, dev], { 'SW2.B': 'nc', 'R9.2': 'wire' });
	assert.equal(p.summary.actions, 2);   // 删网标 + SW2.B nc
	assert.equal(p.summary.flagged, 1);   // R9.2 wire
	assert.equal(p.summary.pending, 1);   // dev 未给标准件
});
