// 「任意图」属性测试(种子化 fuzz):随机多样板 = 随机混合 [大IC/中IC/连接器/无源链/多件簇/单电容],
// 随机脚数/网密度/尺寸,跨模块用真实命名标签网。断言全链(extract→infer→contract→plan)对任意多样
// 输入都 ① 全部模块落地(无 render-error 跳过)② 全门干净(geom 含短路家族 + label + faith + conn)。
// 守护北极星「任意原理图美观自洽」:守护 planner/multipart 顶对齐、单件 support 端点、support 信号端点四修。
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

function lcg(s) { s = s >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }; }
const P = (num, x, y) => ({ num: String(num), x, y });
const comp = (d, x, y, pins, bw, bh) => ({ designator: d, x, y, rotation: 0, mirror: false, bbox: { minX: x - bw, minY: y - bh, maxX: x + bw, maxY: y + bh }, pins });
const flag = (net, sym, x, y) => ({ net, symbol: sym, x, y });

// 随机多样板。跨模块用短命名 stub(extractLogical 按名认网、不几何并远距件,贴近真实原理图)。
function genArbitrary(rnd, idx) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const comps = [], wires = [], flags = []; let wi = 0; const gx = 300, gy = 300; const allPins = [];
	const nBlocks = pick(3, 8);
	for (let b = 0; b < nBlocks; b++) {
		const kind = pick(0, 5); const x = gx + (b % 4) * 600, y = gy + Math.floor(b / 4) * 700;
		if (kind === 0 || kind === 1) {
			const np = kind === 0 ? pick(20, 50) : pick(8, 18); const half = Math.max(1, np >> 1);
			const pins = []; for (let i = 0; i < np; i++) pins.push(P(i + 1, i < np / 2 ? x - 40 : x + 40, y + np * 5 - (i % half) * 20));
			const U = comp(`U${idx}_${b}`, x, y, pins, 40, np * 5 + 10); comps.push(U); pins.forEach(p => allPins.push(p));
		} else if (kind === 2) {
			const np = pick(2, 8); const pins = []; for (let i = 0; i < np; i++) pins.push(P(i + 1, x - 30, y + 30 - i * 20));
			const J = comp(`J${idx}_${b}`, x, y, pins, 15, np * 12); comps.push(J); pins.forEach(p => allPins.push(p));
		} else if (kind === 3) {
			const n = pick(2, 4); let prevPin = null;
			for (let k = 0; k < n; k++) { const yy = y - k * 60; const R = comp(`R${idx}_${b}_${k}`, x, yy, [P(1, x, yy + 15), P(2, x, yy - 15)], 8, 12); comps.push(R);
				if (prevPin) wires.push({ id: 'w' + (wi++), net: `MID${idx}_${b}_${k}`, line: [prevPin.x, prevPin.y, R.pins[0].x, R.pins[0].y] }); prevPin = R.pins[1]; }
			flags.push(flag('VCC', 'power', x, y + 15)); flags.push(flag('GND', 'ground', x, y - (n - 1) * 60 - 15));
		} else if (kind === 4) {
			const np = pick(3, 5); const parts = [];
			for (let k = 0; k < 2; k++) { const yy = y - k * 100; const pins = []; for (let i = 0; i < np; i++) pins.push(P(i + 1, i < np / 2 ? x - 25 : x + 25, yy + 20 - i * 15));
				const Q = comp(`Q${idx}_${b}_${k}`, x, yy, pins, 25, 40); comps.push(Q); parts.push(Q); pins.forEach(p => allPins.push(p)); }
			wires.push({ id: 'w' + (wi++), net: `INT${idx}_${b}`, line: [parts[0].pins[0].x, parts[0].pins[0].y, parts[1].pins[0].x, parts[1].pins[0].y] });
		} else {
			const C = comp(`C${idx}_${b}`, x, y, [P(1, x, y + 12), P(2, x, y - 12)], 8, 12); comps.push(C);
			flags.push(flag('GND', 'ground', x, y - 12)); allPins.push(C.pins[0]);
		}
	}
	const nNets = pick(2, Math.min(10, Math.max(2, allPins.length >> 1)));
	for (let n = 0; n < nNets && allPins.length >= 2; n++) {
		const a = pick(0, allPins.length - 1); let bb = pick(0, allPins.length - 1); if (bb === a) bb = (bb + 1) % allPins.length;
		const nn = `NET${idx}_${n}`;
		wires.push({ id: 'w' + (wi++), net: nn, line: [allPins[a].x, allPins[a].y, allPins[a].x + 15, allPins[a].y] });
		wires.push({ id: 'w' + (wi++), net: nn, line: [allPins[bb].x, allPins[bb].y, allPins[bb].x + 15, allPins[bb].y] });
	}
	flags.push(flag('VCC', 'power', gx, gy - 50)); flags.push(flag('GND', 'ground', gx, gy - 70));
	return { components: comps, wires, netflags: flags };
}

function synth(snap) {
	const logical = extractLogical(snap);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const r = planLayout({ contract, byDes: new Map(snap.components.map(c => [c.designator, withLocalPins(c)])), logical });
	return { logical, contract, r };
}

test('任意图 fuzz:60 随机多样板 — 全模块落地 + 全门干净(美观自洽)', () => {
	const rnd = lcg(0xA4B17);
	let checked = 0;
	for (let t = 0; t < 60; t++) {
		const snap = genArbitrary(rnd, t);
		const { logical, contract, r } = synth(snap);
		const ctx = `t#${t} mods=${contract.modules.length}`;
		assert.equal(r.placed.length, contract.modules.length, `${ctx} 全模块落地(无 render-error 跳过) skipped=${JSON.stringify(r.skipped)}`);
		const g = geomQC(r.model);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.slice(0, 4).join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.slice(0, 4).join(' ')}`);
		assert.equal(g.wireThruPin.length, 0, `${ctx} wireThruPin ${g.wireThruPin.slice(0, 4).join(' ')}`);
		assert.equal(g.crossings, 0, `${ctx} crossings ${g.crossEx.join(' ')}`);
		assert.equal(g.collinear, 0, `${ctx} collinear ${g.collEx.join(' ')}`);
		assert.equal(g.endpointShort, 0, `${ctx} endpointShort ${g.endEx.join(' ')}`);
		assert.equal(g.endpointOnWire, 0, `${ctx} endpointOnWire ${g.eowEx.join(' ')}`);
		assert.equal(labelQC(r.model).filter(f => f.severity === 'hard').length, 0, `${ctx} labelHard`);
		assert.equal(synthesisFaithfulness({ logical, contract, model: r.model }).length, 0, `${ctx} faithHard`);
		assert.equal(wireConnectivity({ model: r.model, logical }).filter(f => f.severity === 'hard').length, 0, `${ctx} connHard`);
		checked++;
	}
	assert.equal(checked, 60);
});

test('任意图 fuzz:确定性(同种子两次装配模型深相等)', () => {
	const run = () => { const rnd = lcg(0x5151); const out = []; for (let t = 0; t < 12; t++) out.push(synth(genArbitrary(rnd, t)).r.model); return out; };
	assert.deepEqual(run(), run());
});
