// densefanout 角色原型单测:密脚 IC 间隔标签列 + 平面无交叉路由。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densefanoutArchetype } from './densefanout.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

// 合成密脚 IC:左右各 6 脚、纵向 10px 密排(比 ROW_PITCH 20 更密 → 触发 jog/staircase);混合网类。
function denseIC(designator) {
	const pins = [];
	for (let i = 0; i < 6; i++) pins.push({ num: String(i + 1), local: [-40, 30 - i * 10] });
	for (let i = 0; i < 6; i++) pins.push({ num: String(i + 7), local: [40, 30 - i * 10] });
	return { designator, pins, localBox: { minX: -20, minY: -40, maxX: 20, maxY: 40 } };
}
const cls = ['signal', 'power', 'ground'];
const pinNets = {};
denseIC('U9').pins.forEach((p, i) => { pinNets[p.num] = { name: 'N' + p.num, class: cls[i % 3] }; });
const anchor = { x: 1000, y: 1000 };
const cell = densefanoutArchetype({ parts: [denseIC('U9')], anchor, nets: { pinNets } });

function worldComponent(part, place) {
	const pins = (part.pins || []).map(p => {
		const [x, y] = toWorld(p.local, [place.x, place.y], place.rot, place.mirror);
		return { num: p.num, x, y };
	});
	const lb = part.localBox;
	const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]]
		.map(([lx, ly]) => toWorld([lx, ly], [place.x, place.y], place.rot, place.mirror));
	const xs = corners.map(c => c[0]);
	const ys = corners.map(c => c[1]);
	return { designator: part.designator, pins, bbox: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

test('densefanout:器件 rot 0 摆 anchor;每个有网的脚一条标签', () => {
	assert.deepEqual(cell.place.U9, { x: 1000, y: 1000, rot: 0, mirror: false });
	assert.equal(cell.flags.filter(f => f.kind === 'sig').length, 12);
});

test('densefanout:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('densefanout:确定性(同输入两次深相等)', () => {
	const a = densefanoutArchetype({ parts: [denseIC('U9')], anchor, nets: { pinNets } });
	const b = densefanoutArchetype({ parts: [denseIC('U9')], anchor, nets: { pinNets } });
	assert.deepEqual(a, b);
});

test('densefanout:负例(空 parts/多器件/无引脚)抛错', () => {
	assert.throws(() => densefanoutArchetype({ parts: [], anchor, nets: { pinNets } }));
	assert.throws(() => densefanoutArchetype({ parts: [denseIC('U9'), denseIC('U8')], anchor, nets: { pinNets } }));
	assert.throws(() => densefanoutArchetype({ parts: [{ designator: 'X', pins: [], localBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }], anchor, nets: { pinNets } }));
});

test('densefanout:冒烟 — 密脚 IC 过真实 geomQC/labelQC hard=0(平面无交叉)', () => {
	const part = denseIC('U9');
	const c = densefanoutArchetype({ parts: [part], anchor, nets: { pinNets } });
	const model = { components: [worldComponent(part, c.place.U9)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});

test('densefanout:fail-closed — 自体内部脚(无正交逃逸)抛错而非产穿体几何', () => {
	// 右侧脚 local(10,0) 落在体 x[-20..20]/y[-40..40] 内部 → 横向逃逸段必穿自体,
	// 拓扑上无正交路径能出实心矩形 → 原型应 fail-closed 抛错,让 planner 跳过该模块。
	const part = { designator: 'U6', localBox: { minX: -20, minY: -40, maxX: 20, maxY: 40 },
		pins: [{ num: '1', local: [40, 30] }, { num: '2', local: [10, 0] }, { num: '3', local: [40, -30] }] };
	const nets = { pinNets: { '1': { name: 'A', class: 'signal' }, '2': { name: 'B', class: 'signal' }, '3': { name: 'C', class: 'signal' } } };
	assert.throws(() => densefanoutArchetype({ parts: [part], anchor, nets }), /内部|interior/);
});

test('densefanout:边缘脚(脚贴体边)不误判内部,正常出图', () => {
	// 右侧脚 local(20,0) 恰在体右边 x=20 上(非严格内部)→ 仍可逃逸,不应抛错。
	const part = { designator: 'U6', localBox: { minX: -20, minY: -40, maxX: 20, maxY: 40 },
		pins: [{ num: '1', local: [40, 30] }, { num: '2', local: [20, 0] }, { num: '3', local: [40, -30] }] };
	const nets = { pinNets: { '1': { name: 'A', class: 'signal' }, '2': { name: 'B', class: 'signal' }, '3': { name: 'C', class: 'signal' } } };
	assert.doesNotThrow(() => densefanoutArchetype({ parts: [part], anchor, nets }));
});

test('densefanout:宽标签名也过门(标签列让开通道,无 L4)', () => {
	const part = denseIC('U7');
	const wide = {};
	part.pins.forEach(p => { wide[p.num] = { name: 'I2S_SPK_BCLK_' + p.num, class: 'signal' }; });
	const c = densefanoutArchetype({ parts: [part], anchor, nets: { pinNets: wide } });
	const model = { components: [worldComponent(part, c.place.U7)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.overlaps.length + g.wireThruComp.length + g.offgrid + g.crossings, 0, 'geom clean');
	assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], 'labelQC hard');
});

// 4 边密脚 IC(含上/下边引脚):回归底/顶边引脚被误判左右、水平横穿引脚排(wireThruPin)的根因。
function quadIC(designator) {
	const pins = [];
	let n = 1;
	for (let i = 0; i < 5; i++) pins.push({ num: String(n++), local: [-40, 20 - i * 10] });  // 左
	for (let i = 0; i < 5; i++) pins.push({ num: String(n++), local: [40, 20 - i * 10] });    // 右
	for (let i = 0; i < 6; i++) pins.push({ num: String(n++), local: [-25 + i * 10, -60] });  // 底(伸出体下)
	for (let i = 0; i < 4; i++) pins.push({ num: String(n++), local: [-15 + i * 10, 60] });   // 顶(伸出体上)
	return { designator, pins, localBox: { minX: -20, minY: -40, maxX: 20, maxY: 40 } };
}

test('densefanout:4 边引脚 IC — 底/顶边引脚竖直逃逸,wireThruPin=0、无交叉、标签门净', () => {
	const part = quadIC('U8');
	const nets = {};
	part.pins.forEach((p, i) => { nets[p.num] = { name: 'Q' + p.num, class: cls[i % 3] }; });
	const c = densefanoutArchetype({ parts: [part], anchor, nets: { pinNets: nets } });
	const model = { components: [worldComponent(part, c.place.U8)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.wireThruPin.length, 0, `wireThruPin ${g.wireThruPin.join(' ')}`);
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.crossings, 0, 'crossings');
	assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], 'labelQC hard');
	// 每个有网的脚都出一条标签(20 脚全有网)
	assert.equal(c.flags.filter(f => f.kind === 'sig').length, 20);
});
