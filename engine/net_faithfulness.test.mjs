import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairNetFaithfulness } from './net_faithfulness.mjs';

const mk = () => ({
	components: [
		{ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, pins: [{ num: '1', x: 0, y: 20 }] },
		{ designator: 'U2', bbox: { minX: 200, minY: 0, maxX: 240, maxY: 40 }, pins: [{ num: '1', x: 240, y: 20 }] },
	],
	wires: [],
	netflags: [],
});
const NET = [{ name: 'SIG', class: 'signal', pins: ['U1.1', 'U2.1'] }];

test('断裂网(无连接)→ 两组各补一个命名标签', () => {
	const m = mk();
	const r = repairNetFaithfulness(m, NET);
	assert.equal(r.splitNets, 1, '应检出 1 个断裂网');
	assert.equal(r.groupsFixed, 2, '两组各补一标签');
	const sigFlags = m.netflags.filter(f => f.net === 'SIG');
	assert.equal(sigFlags.length, 2, 'SIG 标签新增 2');
	// 标签锚不落任一 bbox(安全)
	for (const f of sigFlags) {
		const inBox = m.components.some(c => f.x > c.bbox.minX - 8 && f.x < c.bbox.maxX + 8 && f.y > c.bbox.minY - 8 && f.y < c.bbox.maxY + 8);
		assert.ok(!inBox, '标签锚不入器件 bbox');
	}
});

test('已连通网(有连线)→ 不动', () => {
	const m = mk();
	m.wires.push({ net: 'SIG', line: [0, 20, 240, 20] });   // U1.1 ↔ U2.1 直连
	const r = repairNetFaithfulness(m, NET);
	assert.equal(r.splitNets, 0, '已连通,不算断裂');
	assert.equal(r.groupsFixed, 0, '不补标签');
	assert.equal(m.netflags.length, 0);
});

test('一侧已有标签 → 只给缺标签的组补', () => {
	const m = mk();
	// U1 组已有 SIG 标签;U2 组孤立
	m.wires.push({ net: 'SIG', line: [0, 20, -28, 20] });
	m.netflags.push({ kind: 'sig', net: 'SIG', x: -28, y: 20 });
	const r = repairNetFaithfulness(m, NET);
	assert.equal(r.splitNets, 1);
	assert.equal(r.groupsFixed, 1, '只补 U2 组');
	assert.equal(m.netflags.filter(f => f.net === 'SIG').length, 2, '原 1 + 新 1');
});

test('单脚网/单组网不触发', () => {
	const m = mk();
	m.wires.push({ net: 'SIG', line: [0, 20, 240, 20] });
	const r = repairNetFaithfulness(m, [{ name: 'NC', class: 'signal', pins: ['U1.1'] }, ...NET]);
	assert.equal(r.splitNets, 0);
});

test('脚用 _ax/_ay(EDA 实际脚位)做连通判定', () => {
	const m = mk();
	// U1.1 展开到 x=0 但实际脚 _ax=-5;连线建在实际脚 → 应判已连通
	m.components[0].pins[0]._ax = -5; m.components[0].pins[0]._ay = 20;
	m.components[1].pins[0]._ax = 245; m.components[1].pins[0]._ay = 20;
	m.wires.push({ net: 'SIG', line: [-5, 20, 245, 20] });
	const r = repairNetFaithfulness(m, NET);
	assert.equal(r.splitNets, 0, '用 _ax/_ay 判定时已连通');
});
