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

// 合成快照:U1(8 脚 IC=控制器)+ R1/R2(无源)+ J1(连接器 4 脚)。
const comp = (d, x, y, pins, bw, bh) => ({
	designator: d, x, y, rotation: 0, mirror: false,
	bbox: { minX: x - bw, minY: y - bh, maxX: x + bw, maxY: y + bh }, pins,
});
function syntheticSnapshot() {
	const U1 = comp('U1', 1000, 1000, [
		{ num: '1', x: 960, y: 1030 }, { num: '2', x: 960, y: 1010 }, { num: '3', x: 960, y: 990 }, { num: '4', x: 960, y: 970 },
		{ num: '5', x: 1040, y: 1030 }, { num: '6', x: 1040, y: 1010 }, { num: '7', x: 1040, y: 990 }, { num: '8', x: 1040, y: 970 }], 20, 40);
	const R1 = comp('R1', 1200, 1000, [{ num: '1', x: 1200, y: 1020 }, { num: '2', x: 1200, y: 980 }], 8, 20);
	const R2 = comp('R2', 1300, 1000, [{ num: '1', x: 1300, y: 1020 }, { num: '2', x: 1300, y: 980 }], 8, 20);
	const J1 = comp('J1', 800, 1000, [{ num: '1', x: 760, y: 1030 }, { num: '2', x: 760, y: 1010 }, { num: '3', x: 760, y: 990 }, { num: '4', x: 760, y: 970 }], 15, 40);
	const wire = (id, net, a, b) => ({ id, net, line: [a[0], a[1], b[0], b[1]] });
	return {
		components: [U1, R1, R2, J1],
		wires: [
			wire('w1', 'TX', [960, 1030], [760, 1030]),
			wire('w2', 'RX', [960, 1010], [760, 1010]),
			wire('w3', 'SIG3', [1040, 1030], [1200, 1020]),
			wire('w4', 'SIG4', [1040, 1010], [1300, 1020]),
		],
		netflags: [
			{ net: 'VCC', symbol: 'power', x: 960, y: 990 }, { net: 'VCC', symbol: 'power', x: 760, y: 990 },
			{ net: 'GND', symbol: 'ground', x: 960, y: 970 }, { net: 'GND', symbol: 'ground', x: 760, y: 970 },
			{ net: 'GND', symbol: 'ground', x: 1200, y: 980 }, { net: 'GND', symbol: 'ground', x: 1300, y: 980 },
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
	assert.ok(contract.modules.length >= 1, '契约有模块');
	assert.ok(r.placed.length >= 1, '至少落地一个模块');
	assert.ok(r.model.components.length >= 1, 'model 有组件');
	assert.ok(r.model.wires.length > 0 && r.model.netflags.length > 0, 'model 有线有标');

	// 核心几何不变量必为 0(集成回归守护):无重叠、无线穿件、无异网交叉。
	const g = geomQC(r.model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.crossings, 0, 'crossings');
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
