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
