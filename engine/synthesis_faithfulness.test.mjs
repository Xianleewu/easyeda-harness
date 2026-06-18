// synthesis_faithfulness 单测:合成模型对输入快照的跨模块电气连通保全(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';

// 复用全链合成测试的丰富合成快照思路:含跨模块信号网 TX/RX/SDA/SCL/VOUT/SW。
const comp = (d, x, y, pins, bw, bh) => ({
	designator: d, x, y, rotation: 0, mirror: false,
	bbox: { minX: x - bw, minY: y - bh, maxX: x + bw, maxY: y + bh }, pins,
});
function snapshot() {
	const U1 = comp('U1', 1000, 1000, Array.from({ length: 10 }, (_, i) => ({ num: String(i + 1), x: i < 5 ? 960 : 1040, y: 1040 - (i % 5) * 20 })), 20, 50);
	const C1 = comp('C1', 1400, 1000, [{ num: '1', x: 1400, y: 1020 }, { num: '2', x: 1400, y: 980 }], 8, 20);
	const J1 = comp('J1', 700, 1000, [{ num: '1', x: 660, y: 1030 }, { num: '2', x: 660, y: 1010 }, { num: '3', x: 660, y: 990 }, { num: '4', x: 660, y: 970 }], 15, 40);
	const Q1 = comp('Q1', 1600, 1020, [{ num: '1', x: 1580, y: 1020 }, { num: '2', x: 1620, y: 1030 }, { num: '3', x: 1620, y: 1010 }], 12, 15);
	const R3 = comp('R3', 1600, 960, [{ num: '1', x: 1600, y: 980 }, { num: '2', x: 1600, y: 940 }], 8, 20);
	const wire = (id, net, a, b) => ({ id, net, line: [a[0], a[1], b[0], b[1]] });
	return {
		components: [U1, C1, J1, Q1, R3],
		wires: [
			wire('w1', 'TX', [960, 1040], [660, 1030]), wire('w2', 'RX', [960, 1020], [660, 1010]),
			wire('w3', 'SDA', [1040, 1040], [660, 990]), wire('w4', 'SCL', [1040, 1020], [660, 970]),
			wire('w6', 'VOUT', [1040, 1000], [1400, 1020]),   // U1↔C1 跨模块
			wire('w7', 'BASE', [1580, 1020], [1600, 980]),    // Q1↔R3 模块内(multipart)
			wire('w8', 'SW', [1040, 980], [1620, 1030]),      // U1↔Q1 跨模块
		],
		netflags: [
			{ net: 'GND', symbol: 'ground', x: 1400, y: 980 }, { net: 'GND', symbol: 'ground', x: 1620, y: 1010 },
			{ net: 'GND', symbol: 'ground', x: 1600, y: 940 }, { net: 'GND', symbol: 'ground', x: 660, y: 950 },
		],
	};
}
function synth() {
	const snap = snapshot();
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
	const model = planLayout({ contract, byDes, logical }).model;
	return { logical, contract, model };
}

test('忠实度:合成产物保全全部跨模块信号网(≥2 同名标签)→ 0 hard', () => {
	const { logical, contract, model } = synth();
	const f = synthesisFaithfulness({ logical, contract, model });
	assert.deepEqual(f, [], '不应有跨模块连通丢失');
});

test('忠实度:删掉某跨模块网的标签 → 检出该网不可重连', () => {
	const { logical, contract, model } = synth();
	// 找一个有 ≥2 标签的跨模块信号网,删到只剩 1 个 → 应被检出。
	const counts = {};
	for (const fl of model.netflags) if (fl.net) counts[fl.net] = (counts[fl.net] || 0) + 1;
	const victim = Object.keys(counts).find(n => counts[n] >= 2 && ['TX', 'RX', 'SDA', 'SCL', 'VOUT', 'SW'].includes(n));
	assert.ok(victim, '存在可下手的跨模块网');
	let dropped = false;
	const broken = { ...model, netflags: model.netflags.filter(fl => {
		if (fl.net === victim && !dropped) { dropped = true; return false; }   // 删一个
		return true;
	}) };
	const f = synthesisFaithfulness({ logical, contract, model: broken });
	assert.ok(f.some(x => x.where.net === victim && x.severity === 'hard'), `应检出 ${victim} 不可重连`);
});

test('忠实度:单脚网/模块内网不误报(范围外)', () => {
	// 单脚信号网(只一个 placed 脚)与纯模块内网都不应触发 finding。
	const logical = { nets: [
		{ name: 'SINGLE', class: 'signal', pins: ['U1.1'] },              // 单脚
		{ name: 'GND', class: 'ground', pins: ['U1.5', 'C1.2'] },         // 非 signal
	] };
	const contract = { modules: [{ id: 'm0', role: 'controller', parts: ['U1'] }] };
	const model = { components: [{ designator: 'U1' }], wires: [], netflags: [] };
	assert.deepEqual(synthesisFaithfulness({ logical, contract, model }), []);
});

test('忠实度:跨模块网触及的模块被跳过(连通丢失)→ 检出', () => {
	// planner 跳过 mB(R2 不在 model.components)→ SIG 跨模块连通断,只剩 1 标签。
	// 旧实现按 placed 界定跨度 → 塌缩成单端静默通过(fail-open);应改按 contract 成员检出。
	const logical = { nets: [{ name: 'SIG', class: 'signal', pins: ['R1.1', 'R2.1'] }] };
	const contract = { modules: [{ id: 'mA', role: 'support', parts: ['R1'] }, { id: 'mB', role: 'support', parts: ['R2'] }] };
	const model = { components: [{ designator: 'R1' }], wires: [], netflags: [{ kind: 'sig', net: 'SIG' }] };
	const f = synthesisFaithfulness({ logical, contract, model });
	assert.ok(f.some(x => x.severity === 'hard' && x.where.net === 'SIG'), '应检出 SIG 因模块跳过而连通丢失');
});

test('忠实度:跨模块网某模块缺标签(标签数<模块数)→ 检出', () => {
	// 两模块都落地,但只产 1 个 SIG 标签(应 ≥2,逐模块各一)→ 不可逐模块重连。
	const logical = { nets: [{ name: 'SIG', class: 'signal', pins: ['R1.1', 'R2.1'] }] };
	const contract = { modules: [{ id: 'mA', role: 'support', parts: ['R1'] }, { id: 'mB', role: 'support', parts: ['R2'] }] };
	const model = { components: [{ designator: 'R1' }, { designator: 'R2' }], wires: [], netflags: [{ kind: 'sig', net: 'SIG' }] };
	const f = synthesisFaithfulness({ logical, contract, model });
	assert.ok(f.some(x => x.severity === 'hard' && x.where.net === 'SIG'), '应检出 SIG 标签数<模块数');
});

test('忠实度:跨模块电源网某模块跳过 → 检出(电源/地也在口径)', () => {
	const logical = { nets: [{ name: 'VBUS', class: 'power', pins: ['U1.1', 'J1.1'] }] };
	const contract = { modules: [{ id: 'mA', role: 'controller', parts: ['U1'] }, { id: 'mB', role: 'connector', parts: ['J1'] }] };
	const model = { components: [{ designator: 'U1' }], wires: [], netflags: [{ kind: 'power', net: 'VBUS' }] };
	const f = synthesisFaithfulness({ logical, contract, model });
	assert.ok(f.some(x => x.severity === 'hard' && x.where.net === 'VBUS'), '应检出 VBUS 因模块跳过连通丢失');
});

test('忠实度:缺参数抛错', () => {
	assert.throws(() => synthesisFaithfulness({}));
	assert.throws(() => synthesisFaithfulness({ logical: {}, contract: {} }));
});
