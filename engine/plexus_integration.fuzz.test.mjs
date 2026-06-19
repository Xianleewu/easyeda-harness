// Plexus 全链集成属性测试(种子化 fuzz):随机多模块快照 → extract→infer→contract→plan,
// 断言集成层不变量恒成立:几何(overlaps/wireThruComp/wireThruPin/crossings/offgrid)=0、忠实度=0、连通(connHard)=0、全模块落地,
// 标签仅允许已知的 L10 跨模块同名同 y 碰撞(见 memory:plexus-phase3-synthesis;需后组装碰撞消解器,
// 属独立特性),其余 L1–L9 必须为 0。单原型 fuzz 守护各原型,本测守护 planner 列紧排 + 跨模块装配。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { wireConnectivity } from './wire_connectivity.mjs';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }; }

// 随机多模块快照:1 控制器 IC(中心列)+ k 个连接器外设(侧列),控制器脚↔外设脚连跨模块信号网,电源/地加 flag。
function genSnap(rnd) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const comp = (d, x, y, pins, bw, bh) => ({ designator: d, x, y, rotation: 0, mirror: false, bbox: { minX: x - bw, minY: y - bh, maxX: x + bw, maxY: y + bh }, pins });
	const comps = [], wires = [], flags = [];
	const nU = pick(8, 16);
	const U = comp('U1', 1000, 1000, Array.from({ length: nU }, (_, i) => ({ num: String(i + 1), x: i < nU / 2 ? 960 : 1040, y: 1040 - (i % 8) * 20 })), 20, 90);
	comps.push(U);
	let wi = 0; const peri = pick(2, 4);
	for (let p = 0; p < peri; p++) {
		const des = 'J' + (p + 1), px = 600 - p * 120, np = pick(2, 4);
		const J = comp(des, px, 1000, Array.from({ length: np }, (_, i) => ({ num: String(i + 1), x: px - 40, y: 1030 - i * 20 })), 15, 40);
		comps.push(J);
		for (let i = 0; i < np; i++) { const un = pick(1, nU); wires.push({ id: 'w' + (wi++), net: `S${p}_${i}`, line: [px - 40, 1030 - i * 20, U.pins[un - 1].x, U.pins[un - 1].y] }); }
		flags.push({ net: 'GND', symbol: 'ground', x: px - 40, y: 1030 - np * 20 });
	}
	flags.push({ net: 'VCC', symbol: 'power', x: 960, y: 840 });
	flags.push({ net: 'GND', symbol: 'ground', x: 960, y: 820 });
	return { components: comps, wires, netflags: flags };
}

function synth(snap) {
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
	const r = planLayout({ contract, byDes, logical });
	return { logical, contract, r };
}

test('集成 fuzz:60 随机多模块图 — 几何/忠实/落地不变量恒成立(标签仅允许已知 L10 跨模块碰撞)', () => {
	const rnd = lcg(0x1234);
	let checked = 0;
	for (let t = 0; t < 60; t++) {
		const snap = genSnap(rnd);
		const { logical, contract, r } = synth(snap);
		const ctx = `t#${t} mods=${contract.modules.length}`;
		assert.equal(r.placed.length, contract.modules.length, `${ctx} 全模块落地`);
		const g = geomQC(r.model);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.join(' ')}`);
		assert.equal(g.wireThruPin.length, 0, `${ctx} wireThruPin ${g.wireThruPin.join(' ')}`);
		assert.equal(g.collinear, 0, `${ctx} collinear ${g.collEx.join(' ')}`);
		assert.equal(g.crossings, 0, `${ctx} crossings ${g.crossEx.join(' ')}`);
		assert.equal(g.offgrid, 0, `${ctx} offgrid ${g.offEx.join(' ')}`);
		assert.equal(synthesisFaithfulness({ logical, contract, model: r.model }).length, 0, `${ctx} faithfulness`);
		assert.equal(wireConnectivity({ model: r.model, logical }).filter(f => f.severity === 'hard').length, 0, `${ctx} connHard`);
		// 标签:planLayout 已含 L10 碰撞消解器,标签硬伤须全为 0(含跨模块同名同 y)。
		const hard = labelQC(r.model).filter(f => f.severity === 'hard');
		assert.equal(hard.length, 0, `${ctx} 标签硬伤 ${JSON.stringify(hard.slice(0, 2))}`);
		checked++;
	}
	assert.equal(checked, 60);
});

test('集成 fuzz:确定性(同种子两次装配模型深相等)', () => {
	const run = () => { const rnd = lcg(99); const out = []; for (let t = 0; t < 12; t++) out.push(synth(genSnap(rnd)).r.model); return out; };
	assert.deepEqual(run(), run());
});
