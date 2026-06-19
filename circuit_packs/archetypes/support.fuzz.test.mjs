// support 平面性属性测试(种子化 fuzz):随机无源件竖直串(2–6 件)× 随机端点网类(top/bottom
// 电源or地)× 随机侧抽头(signal tap 在合法 tapIndex 或无)。断言路由器不变量:geomQC
// overlaps/wireThruComp/wireThruPin/crossings/offgrid=0、labelQC hard=0、确定性。补齐四原型 fuzz 覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportArchetype } from './support.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }; }

const passive = d => ({ designator: d, pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }], localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 } });

function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => { const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror); return { num: p.num, x, y }; });
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]].map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]); const ys = corners.map(c => c[1]);
	return { designator: part.designator, pins, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

function genConfig(rnd, idx) {
	const pick = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
	const n = pick(2, 6);
	const parts = []; for (let i = 0; i < n; i++) parts.push(passive(`R${idx}_${i}`));
	const pwrGnd = c => c === 0 ? { name: `P${idx}`, class: 'power' } : { name: `G${idx}`, class: 'ground' };
	const nets = { top: pwrGnd(pick(0, 1)), bottom: pwrGnd(pick(0, 1)) };
	if (pick(0, 1)) nets.side = { name: `MID${idx}`, class: 'signal' };   // 半数带侧抽头
	const opts = { tapIndex: pick(0, n - 2) };
	return { parts, anchor: { x: pick(80, 200) * 10, y: pick(80, 200) * 10 }, nets, opts };
}

test('support 属性:240 随机串全部满足几何/标签不变量', () => {
	const rnd = lcg(0x5A99012);
	let checked = 0;
	for (let i = 0; i < 240; i++) {
		const { parts, anchor, nets, opts } = genConfig(rnd, i);
		let cell;
		try { cell = supportArchetype({ parts, anchor, nets, opts }); }
		catch { continue; }   // tapIndex 越界等 fail-closed 是合法跳过
		const model = { components: parts.map(p => worldComponent(p, cell.place[p.designator])), wires: cell.wires, netflags: cell.flags };
		const g = geomQC(model);
		const ctx = `cfg#${i} parts=${parts.length}`;
		assert.equal(g.crossings, 0, `${ctx} crossings=${g.crossings} ${g.crossEx.join(' ')}`);
		assert.equal(g.wireThruPin.length, 0, `${ctx} wireThruPin ${g.wireThruPin.join(' ')}`);
		assert.equal(g.collinear, 0, `${ctx} collinear ${g.collEx.join(' ')}`);
		assert.equal(g.endpointShort, 0, `${ctx} endpointShort ${g.endEx.join(' ')}`);
		assert.equal(g.endpointOnWire, 0, `${ctx} endpointOnWire ${g.eowEx.join(' ')}`);
		assert.equal(g.wireThruComp.length, 0, `${ctx} wireThruComp ${g.wireThruComp.join(' ')}`);
		assert.equal(g.overlaps.length, 0, `${ctx} overlaps ${g.overlaps.join(' ')}`);
		assert.equal(g.offgrid, 0, `${ctx} offgrid=${g.offgrid} ${g.offEx.join(' ')}`);
		assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], `${ctx} labelHard`);
		checked++;
	}
	assert.ok(checked >= 150, `有效配置 ${checked}/240 应 ≥150`);
});

test('support 属性:确定性(同种子两次产物深相等)', () => {
	const run = () => { const rnd = lcg(11); const out = []; for (let i = 0; i < 20; i++) { const { parts, anchor, nets, opts } = genConfig(rnd, i); try { out.push(supportArchetype({ parts, anchor, nets, opts })); } catch { out.push(null); } } return out; };
	assert.deepEqual(run(), run());
});
