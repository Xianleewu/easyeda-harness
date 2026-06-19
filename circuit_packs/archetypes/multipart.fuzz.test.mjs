// multipart 平面性属性测试(种子化 fuzz):随机多件簇(2–4 件、各件随机尺寸/左右脚 + 栈底件底边
// 排脚 / 栈顶件顶边排脚)断言路由器不变量:geomQC overlaps/wireThruComp/wireThruPin/crossings/
// offgrid=0、labelQC hard=0、确定性。守护堆叠 + 边路由(栈选择/floorY)对任意配置的健壮性。
// 注:中层件的底/顶边脚仍走 routeSide(向下/上会穿邻件,无解),故 fuzz 只在栈底/顶件放边脚——
// 这正是 multipart 边路由支持的范围(与真实板 SW2 在栈底一致)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multipartArchetype } from './multipart.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }; }
const cls = ['signal', 'power', 'ground'];

function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => { const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror); return { num: p.num, x, y }; });
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]].map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]); const ys = corners.map(c => c[1]);
	return { designator: part.designator, pins, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

// 生成一件:左右脚(体内 y) + 可选边脚(仅 atBottom/atTop 件加底/顶排脚)。
function genPart(rnd, di, atBottom, atTop, pinNets) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const bw = pick(2, 6) * 10, bh = pick(3, 8) * 10;
	const widths = [4, 10, 20];
	const pins = [];
	const add = (num, side, local) => { pins.push({ num, local }); const w = widths[pick(0, 2)]; pinNets[`${di}.${num}`] = { name: `${side}${di}_${num}_${'X'.repeat(w)}`, class: cls[pick(0, 2)] }; };
	let k = 1;
	for (let i = 0, n = pick(0, 5); i < n; i++) add(k, 'L', [-bw, pick(-bh / 10, bh / 10) * 10]), k++;
	for (let i = 0, n = pick(0, 5); i < n; i++) add(k, 'R', [bw, pick(-bh / 10, bh / 10) * 10]), k++;
	if (atBottom) for (let i = 0, n = pick(0, 4); i < n; i++) add(k, 'B', [pick(-bw / 10 + 1, bw / 10 - 1) * 10, -bh]), k++;
	if (atTop) for (let i = 0, n = pick(0, 4); i < n; i++) add(k, 'T', [pick(-bw / 10 + 1, bw / 10 - 1) * 10, bh]), k++;
	if (!pins.length) add(k, 'L', [-bw, 0]);   // 至少 1 脚
	return { designator: di, pins, localBox: { minX: -bw, minY: -bh, maxX: bw, maxY: bh } };
}

function genConfig(rnd, idx) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const nParts = pick(2, 4);
	const pinNets = {};
	const parts = [];
	for (let i = 0; i < nParts; i++) parts.push(genPart(rnd, `U${idx}_${i}`, i === nParts - 1, i === 0, pinNets));
	const anchor = { x: pick(80, 200) * 10, y: pick(80, 200) * 10 };
	return { parts, anchor, pinNets };
}

test('multipart 属性:240 随机多件栈全部满足几何/标签不变量', () => {
	const rnd = lcg(0x5EED1);
	let checked = 0;
	for (let i = 0; i < 240; i++) {
		const { parts, anchor, pinNets } = genConfig(rnd, i);
		let cell;
		try { cell = multipartArchetype({ parts, anchor, nets: { pinNets } }); }
		catch { continue; }   // assertEscapable/重复位号 fail-closed 是合法跳过
		const model = { components: parts.map(p => worldComponent(p, cell.place[p.designator])), wires: cell.wires, netflags: cell.flags };
		const g = geomQC(model);
		const ctx = `cfg#${i} parts=${parts.length}`;
		assert.equal(g.crossings, 0, `${ctx} crossings=${g.crossings} ${g.crossEx.join(' ')}`);
		assert.equal(g.wireThruPin.length, 0, `${ctx} wireThruPin ${g.wireThruPin.join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.join(' ')}`);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.join(' ')}`);
		assert.equal(g.offgrid, 0, `${ctx} offgrid=${g.offgrid} ${g.offEx.join(' ')}`);
		assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], `${ctx} labelHard`);
		checked++;
	}
	assert.ok(checked >= 180, `有效配置 ${checked}/240 应 ≥180`);
});

test('multipart 属性:确定性(同种子两次产物深相等)', () => {
	const run = () => { const rnd = lcg(7); const out = []; for (let i = 0; i < 20; i++) { const { parts, anchor, pinNets } = genConfig(rnd, i); try { out.push(multipartArchetype({ parts, anchor, nets: { pinNets } })); } catch { out.push(null); } } return out; };
	assert.deepEqual(run(), run());
});
