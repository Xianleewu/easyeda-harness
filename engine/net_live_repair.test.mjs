import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNetRepair, aggregateAuthNets } from './net_live_repair.mjs';

const netlist = {
	components: {
		g1: { props: { Designator: 'U1' }, pinInfoMap: { '1': { net: 'SIG' }, '2': { net: 'GND' } } },
		g2: { props: { Designator: 'U2' }, pinInfoMap: { '1': { net: 'SIG' } } },
	},
};
const mkSnap = () => ({
	components: [
		{ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, pins: [{ num: '1', x: 0, y: 20 }, { num: '2', x: 0, y: 30 }] },
		{ designator: 'U2', bbox: { minX: 200, minY: 0, maxX: 240, maxY: 40 }, pins: [{ num: '1', x: 240, y: 20 }] },
	],
	wires: [], netflags: [],
});

test('aggregateAuthNets:从 pinInfoMap 聚合 net→[ref]', () => {
	const nets = aggregateAuthNets(netlist);
	assert.deepEqual(nets.get('SIG'), ['U1.1', 'U2.1']);
	assert.deepEqual(nets.get('GND'), ['U1.2']);
});

test('断裂网(无连接)→ 规划两组各补 netport', () => {
	const plan = planNetRepair(netlist, mkSnap());
	assert.equal(plan.broken, 1, 'SIG 断裂(GND 单脚不计)');
	assert.equal(plan.planned, 2, '两组各补一 op');
	assert.equal(plan.ops.length, 2);
	for (const op of plan.ops) {
		assert.equal(op.net, 'SIG');
		assert.equal(op.wireLine.length, 4, '短桩:脚→安全位');
		// 安全位不入任一 bbox
		const inBox = mkSnap().components.some(c => op.flagX > c.bbox.minX - 8 && op.flagX < c.bbox.maxX + 8 && op.flagY > c.bbox.minY - 8 && op.flagY < c.bbox.maxY + 8);
		assert.ok(!inBox, 'netport 锚不入 bbox');
	}
});

test('已连通网 → 无修复 op', () => {
	const snap = mkSnap();
	snap.wires.push({ net: 'SIG', line: [0, 20, 240, 20] });
	const plan = planNetRepair(netlist, snap);
	assert.equal(plan.broken, 0);
	assert.equal(plan.ops.length, 0);
});

test('一组已有该网标签 → 只补缺标签的组', () => {
	const snap = mkSnap();
	snap.wires.push({ net: 'SIG', line: [0, 20, -20, 20] });
	snap.netflags.push({ net: 'SIG', x: -20, y: 20 });
	const plan = planNetRepair(netlist, snap);
	assert.equal(plan.broken, 1);
	assert.equal(plan.planned, 1, '只补 U2 组');
	assert.equal(plan.ops[0].net, 'SIG');
});

test('权威单脚网(NC)不触发', () => {
	const nl2 = { components: { g1: { props: { Designator: 'U1' }, pinInfoMap: { '1': { net: 'NC1' } } } } };
	const plan = planNetRepair(nl2, mkSnap());
	assert.equal(plan.broken, 0);
});
