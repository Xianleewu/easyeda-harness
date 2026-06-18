// 全链集成冒烟:合成快照 → extract → infer → contract → plan → geomQC。
// 守护整条合成管线的集成(不依赖未 tracked 的 live.json);断言核心几何不变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';

// 丰富合成快照,覆盖全部原型 dispatch:
//   U1(10 脚 IC=控制器→densefanout)、R1-R2 串(support 链)、C1(单件 support)、
//   J1(连接器→fanout)、Q1+R3(多件簇→multipart)。
const comp = (d, x, y, pins, bw, bh) => ({
	designator: d, x, y, rotation: 0, mirror: false,
	bbox: { minX: x - bw, minY: y - bh, maxX: x + bw, maxY: y + bh }, pins,
});
function syntheticSnapshot() {
	const U1 = comp('U1', 1000, 1000, Array.from({ length: 10 }, (_, i) => ({ num: String(i + 1), x: i < 5 ? 960 : 1040, y: 1040 - (i % 5) * 20 })), 20, 50);
	const R1 = comp('R1', 1200, 1100, [{ num: '1', x: 1200, y: 1120 }, { num: '2', x: 1200, y: 1080 }], 8, 20);
	const R2 = comp('R2', 1200, 1000, [{ num: '1', x: 1200, y: 1020 }, { num: '2', x: 1200, y: 980 }], 8, 20);
	const C1 = comp('C1', 1400, 1000, [{ num: '1', x: 1400, y: 1020 }, { num: '2', x: 1400, y: 980 }], 8, 20);
	const J1 = comp('J1', 700, 1000, [{ num: '1', x: 660, y: 1030 }, { num: '2', x: 660, y: 1010 }, { num: '3', x: 660, y: 990 }, { num: '4', x: 660, y: 970 }], 15, 40);
	const Q1 = comp('Q1', 1600, 1020, [{ num: '1', x: 1580, y: 1020 }, { num: '2', x: 1620, y: 1030 }, { num: '3', x: 1620, y: 1010 }], 12, 15);
	const R3 = comp('R3', 1600, 960, [{ num: '1', x: 1600, y: 980 }, { num: '2', x: 1600, y: 940 }], 8, 20);
	const wire = (id, net, a, b) => ({ id, net, line: [a[0], a[1], b[0], b[1]] });
	return {
		components: [U1, R1, R2, C1, J1, Q1, R3],
		wires: [
			wire('w1', 'TX', [960, 1040], [660, 1030]), wire('w2', 'RX', [960, 1020], [660, 1010]),
			wire('w3', 'SDA', [1040, 1040], [660, 990]), wire('w4', 'SCL', [1040, 1020], [660, 970]),
			wire('w5', 'MID', [1200, 1080], [1200, 1020]),   // R1.2-R2.1 内部结点
			wire('w6', 'VOUT', [1040, 1000], [1400, 1020]),  // U1.7-C1.1
			wire('w7', 'BASE', [1580, 1020], [1600, 980]),   // Q1.1-R3.1
			wire('w8', 'SW', [1040, 980], [1620, 1030]),     // U1.8-Q1.2
		],
		netflags: [
			{ net: 'VCC', symbol: 'power', x: 960, y: 1000 }, { net: 'VCC', symbol: 'power', x: 1200, y: 1120 },
			{ net: 'GND', symbol: 'ground', x: 960, y: 980 }, { net: 'GND', symbol: 'ground', x: 1200, y: 980 },
			{ net: 'GND', symbol: 'ground', x: 1400, y: 980 }, { net: 'GND', symbol: 'ground', x: 1620, y: 1010 },
			{ net: 'GND', symbol: 'ground', x: 1600, y: 940 }, { net: 'GND', symbol: 'ground', x: 660, y: 950 },
		],
	};
}

test('合成全链:extract→infer→contract→plan 端到端产出 + 核心几何不变量 0', () => {
	const snap = syntheticSnapshot();
	const logical = extractLogical(snap);
	const roles = inferRoles(logical);
	const contract = synthesizeContract(roles, logical);
	const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });

	assert.equal(roles.controller, 'U1', '最多脚 IC 为控制器');
	assert.equal(r.placed.length, contract.modules.length, '全部模块落地(覆盖所有原型 dispatch)');
	assert.ok(r.model.wires.length > 0 && r.model.netflags.length > 0, 'model 有线有标');
	// 落地角色覆盖密脚(controller→densefanout)与多件簇(switch=Q1+R3→multipart)。
	const placedRoles = new Set(r.placed.map(id => contract.modules.find(m => m.id === id).role));
	assert.ok(placedRoles.has('controller'), 'controller 落地(densefanout)');
	assert.ok(placedRoles.has('switch'), '多件簇 switch 落地(multipart 回退)');

	// 全链产出过真实几何 + 标签门(集成回归守护):全 0。
	const g = geomQC(r.model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.crossings, 0, 'crossings');
	assert.equal(g.offgrid, 0, 'offgrid(合成几何全格对齐)');
	assert.deepEqual(labelQC(r.model).filter(f => f.severity === 'hard'), [], 'labelHard');
});

test('合成全链:确定性(同快照两次 model 深相等)', () => {
	const snap = syntheticSnapshot();
	const run = () => {
		const logical = extractLogical(snap);
		const contract = synthesizeContract(inferRoles(logical), logical);
		const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
		return planLayout({ contract, byDes, logical }).model;
	};
	assert.deepEqual(run(), run());
});
