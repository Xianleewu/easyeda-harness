// multipart 角色原型单测:多件簇纵向自适应堆叠 + 并集引脚平面扇出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multipartArchetype } from './multipart.mjs';
import { assertOrthogonalWires, assertLabelsAttached } from '../../engine/cell_helpers.mjs';
import { toWorld } from '../../engine/transform.mjs';
import { geomQC } from '../../engine/geom_qc.mjs';
import { labelQC } from '../../engine/label_qc.mjs';

// 合成 2 件簇:R(2脚)+ U(4脚),含一个内部共享网 MID(靠同名网标连通)。
const synR = () => ({ designator: 'RA', pins: [{ num: '1', local: [-30, 0] }, { num: '2', local: [30, 0] }], localBox: { minX: -10, minY: -10, maxX: 10, maxY: 10 } });
const synU = () => ({ designator: 'UA', pins: [{ num: '1', local: [-30, 10] }, { num: '2', local: [-30, -10] }, { num: '3', local: [30, 10] }, { num: '4', local: [30, -10] }], localBox: { minX: -15, minY: -20, maxX: 15, maxY: 20 } });
const pinNets = {
	'RA.1': { name: 'VIN', class: 'power' }, 'RA.2': { name: 'MID', class: 'signal' },
	'UA.1': { name: 'MID', class: 'signal' }, 'UA.3': { name: 'OUT', class: 'signal' }, 'UA.4': { name: 'GND', class: 'ground' },
};
const anchor = { x: 1000, y: 1000 };
const cell = multipartArchetype({ parts: [synR(), synU()], anchor, nets: { pinNets } });

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

test('multipart:各件纵向堆叠(rot 0),按真实高度自适应不重叠', () => {
	assert.equal(cell.place.RA.rot, 0);
	assert.ok(cell.place.RA.y > cell.place.UA.y, 'RA 在 UA 之上');
	// 自适应:RA 高 20、间隙 50 → UA 应在 RA 下方 ≥70
	assert.ok(cell.place.RA.y - cell.place.UA.y >= 70);
});

test('multipart:导线全正交、标签全附着', () => {
	assert.doesNotThrow(() => assertOrthogonalWires(cell.wires));
	assert.doesNotThrow(() => assertLabelsAttached(cell.wires, cell.flags));
});

test('multipart:确定性(同输入两次深相等)', () => {
	const a = multipartArchetype({ parts: [synR(), synU()], anchor, nets: { pinNets } });
	const b = multipartArchetype({ parts: [synR(), synU()], anchor, nets: { pinNets } });
	assert.deepEqual(a, b);
});

test('multipart:负例(空 parts/无 anchor)抛错', () => {
	assert.throws(() => multipartArchetype({ parts: [], anchor, nets: { pinNets } }));
	assert.throws(() => multipartArchetype({ parts: [synR()], anchor: {}, nets: { pinNets } }));
});

test('multipart:重复位号 fail-closed(place 以位号为键,重复会静默覆盖→堆叠重叠)', () => {
	// 两件同位号 RA:place[RA] 会被第二件覆盖、cursor 仍推进 → 二者世界体重叠。
	// place 按位号 key 的前提应显式化:重复位号直接抛错,而非产出重叠几何。
	assert.throws(() => multipartArchetype({ parts: [synR(), synR()], anchor, nets: { pinNets } }), /位号|designator|duplicate/);
});

test('multipart:冒烟 — 2 件簇过真实 geomQC/labelQC hard=0', () => {
	const parts = [synR(), synU()];
	const c = multipartArchetype({ parts, anchor, nets: { pinNets } });
	const model = { components: parts.map(p => worldComponent(p, c.place[p.designator])), wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], 'labelQC hard');
});

// 回归:栈底件含底边引脚排(如开关 A/B/C 同 y),旧 routeSide 水平逃逸会横穿邻脚(wireThruPin,
// 真实板 SW2.B)。栈底件底边脚应向下竖直逃逸 → wireThruPin=0、无交叉。
test('multipart:栈底件底边引脚排向下逃逸,wireThruPin=0、无交叉、标签净', () => {
	const synIC = () => ({ designator: 'UB', pins: [{ num: '1', local: [-30, 5] }, { num: '2', local: [30, 5] }], localBox: { minX: -15, minY: -20, maxX: 15, maxY: 20 } });
	// 开关:A/B/C 在体下边一排(local y=-25 < minY=-20),x 各异 → 底边排
	const synSw = () => ({ designator: 'SWB', pins: [{ num: 'A', local: [-10, -25] }, { num: 'B', local: [0, -25] }, { num: 'C', local: [10, -25] }], localBox: { minX: -15, minY: -20, maxX: 15, maxY: 20 } });
	const nets = { 'UB.1': { name: 'N1', class: 'signal' }, 'UB.2': { name: 'N2', class: 'signal' }, 'SWB.A': { name: 'SA', class: 'signal' }, 'SWB.B': { name: 'SB', class: 'signal' }, 'SWB.C': { name: 'SC', class: 'signal' } };
	const c = multipartArchetype({ parts: [synIC(), synSw()], anchor, nets: { pinNets: nets } });   // SWB 为栈底件
	const model = { components: [worldComponent(synIC(), c.place.UB), worldComponent(synSw(), c.place.SWB)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.wireThruPin.length, 0, `wireThruPin ${g.wireThruPin.join(' ')}`);
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.crossings, 0, 'crossings');
	assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], 'labelQC hard');
	assert.equal(c.flags.filter(f => f.kind === 'sig').length, 5, '5 个有网脚各一标签');
});

// 两限界修复:① 中层件含边脚(重排移栈端)② 不同宽件侧脚(对齐公共边)。3 件栈,中件含顶边脚 + 各件不同宽。
test('multipart:中层件边脚 + 不同宽件 → 重排+对齐修复,wireThruPin=0、无交叉', () => {
	const wide = () => ({ designator: 'WIDE', pins: [{ num: '1', local: [-50, 10] }, { num: '2', local: [50, 10] }, { num: '3', local: [-50, -10] }], localBox: { minX: -50, minY: -30, maxX: 50, maxY: 30 } });
	const midTop = () => ({ designator: 'MID', pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }, { num: '3', local: [-10, 30] }, { num: '4', local: [10, 30] }], localBox: { minX: -20, minY: -30, maxX: 20, maxY: 30 } });  // 3,4=顶边脚
	const narrow = () => ({ designator: 'NAR', pins: [{ num: '1', local: [-15, 5] }, { num: '2', local: [15, 5] }], localBox: { minX: -15, minY: -20, maxX: 15, maxY: 20 } });
	const nets = {};
	[['WIDE', 3], ['MID', 4], ['NAR', 2]].forEach(([d, n]) => { for (let i = 1; i <= n; i++) nets[`${d}.${i}`] = { name: `${d}${i}`, class: 'signal' }; });
	// MID 在中间(index 1),含顶边脚 → 重排应移到栈顶;三件不同宽 → 侧脚对齐
	const c = multipartArchetype({ parts: [wide(), midTop(), narrow()], anchor, nets: { pinNets: nets } });
	const model = { components: [worldComponent(wide(), c.place.WIDE), worldComponent(midTop(), c.place.MID), worldComponent(narrow(), c.place.NAR)], wires: c.wires, netflags: c.flags };
	const g = geomQC(model);
	assert.equal(g.wireThruPin.length, 0, `wireThruPin ${g.wireThruPin.join(' ')}`);
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.crossings, 0, 'crossings');
	assert.deepEqual(labelQC(model).filter(f => f.severity === 'hard'), [], 'labelQC hard');
});
