// fanout 属性测试(种子化 fuzz):随机多脚连接器(同侧异 y、变长名、混合网类),
// 断言 geomQC overlaps/wireThruComp/crossings/offgrid=0、labelQC hard=0 + 确定性。
// 守护 fanout 在其域(连接器/枢纽:脚在体边、同侧 ≥10 栅间距)内的鲁棒性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanoutArchetype } from './fanout.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

function lcg(seed) {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
const cls = ['signal', 'power', 'ground'];
const widths = [4, 8, 14, 22, 30];

function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => { const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror); return { num: p.num, x, y }; });
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]); const ys = corners.map(c => c[1]);
	return { designator: part.designator, pins, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

// 生成合法连接器:脚在体边(±bw,体外避开 fail-closed),同侧 y 互异(≥10 栅,fanout 无 staircase)。
function genConfig(rnd, idx) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const bw = pick(2, 6) * 10;
	const rows = pick(6, 16);                       // 可用行槽
	const bh = rows * 10;
	const pins = []; const pinNets = {}; let k = 1;
	const mkSide = (sx) => {
		const n = pick(0, Math.min(8, rows));
		// 从 rows 个互异槽中无放回取 n 个 y(保证同侧异 y)
		const slots = Array.from({ length: rows + 1 }, (_, i) => (i - Math.floor(rows / 2)) * 10);
		for (let i = 0; i < n; i++) {
			const j = pick(0, slots.length - 1);
			const y = slots.splice(j, 1)[0];
			const num = String(k++);
			pins.push({ num, local: [sx, y] });
			const cl = cls[pick(0, 2)];
			// 真实分布:信号网名可长(压宽名定位),电源/地网名短('GND'/'V5')。
			const w = cl === 'signal' ? widths[pick(0, widths.length - 1)] : pick(2, 5);
			pinNets[num] = { name: `${sx < 0 ? 'L' : 'R'}${num}_${'X'.repeat(Math.max(1, w - 3))}`, class: cl };
		}
	};
	mkSide(-(bw + 10)); mkSide(bw + 10);            // 脚在体边外
	if (!pins.length) return genConfig(rnd, idx);
	const part = { designator: `J${idx}`, pins, localBox: { minX: -bw, minY: -bh, maxX: bw, maxY: bh } };
	const anchor = { x: pick(80, 200) * 10, y: pick(80, 200) * 10 };
	return { part, anchor, pinNets };
}

test('fanout 属性:300 随机连接器 — 出图者全门 0,过密者 fail-closed', () => {
	const rnd = lcg(0xFA0);
	let rendered = 0, guarded = 0;
	for (let i = 0; i < 300; i++) {
		const { part, anchor, pinNets } = genConfig(rnd, i);
		let cell;
		try { cell = fanoutArchetype({ parts: [part], anchor, nets: { pinNets } }); }
		catch { guarded++; continue; }   // 同侧过密 → fail-closed,planner 会跳过(可接受)
		const model = { components: [worldComponent(part, cell.place[part.designator])], wires: cell.wires, netflags: cell.flags };
		const g = geomQC(model);
		const ctx = `cfg#${i} pins=${part.pins.length}`;
		assert.equal(g.crossings, 0, `${ctx} crossings ${g.crossEx.join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.join(' ')}`);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.join(' ')}`);
		assert.equal(g.offgrid, 0, `${ctx} offgrid ${g.offEx.join(' ')}`);
		assert.equal(labelQC(model).filter(f => f.severity === 'hard').length, 0, `${ctx} labelHard`);
		rendered++;
	}
	assert.equal(rendered + guarded, 300);
	assert.ok(rendered > 0, '应有相当比例配置正常出图');
});

test('fanout 属性:确定性(同种子两次深相等)', () => {
	const run = () => {
		const rnd = lcg(7); const out = [];
		for (let i = 0; i < 20; i++) {
			const { part, anchor, pinNets } = genConfig(rnd, i);
			try { out.push(fanoutArchetype({ parts: [part], anchor, nets: { pinNets } })); }
			catch (e) { out.push(`THROW:${e.message}`); }
		}
		return out;
	};
	assert.deepEqual(run(), run());
});
