// densefanout 平面性属性测试(种子化 fuzz):对大量随机密脚配置,断言路由器不变量恒成立:
//   geomQC overlaps/wireThruComp/crossings/offgrid=0、labelQC hard=0。
// 固化人工评审的 5000 次 fuzz 结论为永久回归守护,并作为后续降漂移改造的验证网。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densefanoutArchetype } from './densefanout.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

// 确定性 PRNG(LCG)——避免 Math.random,保证可复现。
function lcg(seed) {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
const cls = ['signal', 'power', 'ground'];

function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => {
		const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror);
		return { num: p.num, x, y };
	});
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]); const ys = corners.map(c => c[1]);
	return { designator: part.designator, pins, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

// 生成一个合法密脚配置:脚落在各侧体边(非内部,避开 C1 fail-closed),y 在体内 10 栅(允许稠密/同 y)。
function genConfig(rnd, idx) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const bw = pick(2, 8) * 10;             // 体半宽
	const bh = pick(4, 12) * 10;            // 体半高
	const nL = pick(0, 12), nR = pick(0, 12), nB = pick(0, 8), nT = pick(0, 8);   // 含底/顶边脚(覆盖边路由)
	if (nL + nR + nB + nT === 0) return genConfig(rnd, idx);   // 至少 1 脚
	const pins = []; const pinNets = {};
	let k = 1;
	// 网名宽度也随机(含超长名),压 L4(线穿标签)/L6(标签离体):密脚 × 宽名是真实硬组合。
	const widths = [4, 8, 14, 22, 30];
	const addNet = (num, side) => {
		const w = widths[pick(0, widths.length - 1)];
		pinNets[num] = { name: `${side}${num}_${'X'.repeat(Math.max(1, w - String(num).length - 2))}`, class: cls[pick(0, 2)] };
	};
	const mk = (side) => {            // 左/右边脚:x 在体侧边,y 体内
		const x = side === 'L' ? -bw : bw;
		const y = (pick(-bh / 10, bh / 10)) * 10;
		const num = String(k++); pins.push({ num, local: [x, y] }); addNet(num, side);
	};
	const mkBT = (side) => {          // 底/顶边脚:y 在体上下边,x 体内(留 1 栅离侧边避免被判左右)
		const y = side === 'B' ? -bh : bh;
		const x = (pick(-bw / 10 + 1, bw / 10 - 1)) * 10;
		const num = String(k++); pins.push({ num, local: [x, y] }); addNet(num, side);
	};
	for (let i = 0; i < nL; i++) mk('L');
	for (let i = 0; i < nR; i++) mk('R');
	for (let i = 0; i < nB; i++) mkBT('B');
	for (let i = 0; i < nT; i++) mkBT('T');
	const part = { designator: `U${idx}`, pins, localBox: { minX: -bw, minY: -bh, maxX: bw, maxY: bh } };
	const anchor = { x: pick(80, 200) * 10, y: pick(80, 200) * 10 };
	return { part, anchor, pinNets };
}

test('densefanout 属性:300 随机密脚配置全部满足几何/标签不变量(平面无交叉)', () => {
	const rnd = lcg(0xC0FFEE);
	let checked = 0;
	for (let i = 0; i < 300; i++) {
		const { part, anchor, pinNets } = genConfig(rnd, i);
		const cell = densefanoutArchetype({ parts: [part], anchor, nets: { pinNets } });
		const model = { components: [worldComponent(part, cell.place[part.designator])], wires: cell.wires, netflags: cell.flags };
		const g = geomQC(model);
		const ctx = `cfg#${i} pins=${part.pins.length}`;
		assert.equal(g.crossings, 0, `${ctx} crossings=${g.crossings} ${g.crossEx.join(' ')}`);
		assert.equal(g.wireThruPin.length, 0, `${ctx} wireThruPin ${g.wireThruPin.join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.join(' ')}`);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.join(' ')}`);
		assert.equal(g.offgrid, 0, `${ctx} offgrid=${g.offgrid} ${g.offEx.join(' ')}`);
		const hard = labelQC(model).filter(f => f.severity === 'hard');
		assert.equal(hard.length, 0, `${ctx} labelHard ${JSON.stringify(hard.slice(0, 3))}`);
		checked++;
	}
	assert.equal(checked, 300);
});

test('densefanout 属性:确定性(同种子两次产物深相等)', () => {
	const run = () => {
		const rnd = lcg(42); const out = [];
		for (let i = 0; i < 20; i++) { const { part, anchor, pinNets } = genConfig(rnd, i); out.push(densefanoutArchetype({ parts: [part], anchor, nets: { pinNets } })); }
		return out;
	};
	assert.deepEqual(run(), run());
});
