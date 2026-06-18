// plexus_planner 单测:contract→placement 通用驱动(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLayout, cellExtentMinY } from './plexus_planner.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';

const passive = d => ({
	designator: d,
	pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
	localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
});
const byDes = new Map([['R1', passive('R1')], ['R2', passive('R2')], ['R3', passive('R3')], ['R4', passive('R4')]]);

const contract = {
	schemaVersion: 1,
	grid: { colPitch: 10, rowPitch: 10 },
	columns: [
		{ id: 'input', role: 'in', order: 0, modules: ['m0', 'm1', 'm9'] },
		{ id: 'control', role: 'ctl', order: 2, modules: ['mctrl'] },
	],
	modules: [
		{ id: 'm0', role: 'support', column: 'input', parts: ['R1', 'R2'], region: { col: 0, row: 0, wCells: 3, hCells: 4 } },
		{ id: 'm1', role: 'support', column: 'input', parts: ['R3', 'R4'], region: { col: 0, row: 10, wCells: 3, hCells: 4 } },
		{ id: 'm9', role: 'support', column: 'input', parts: ['R99'], region: { col: 0, row: 20, wCells: 3, hCells: 3 } },
		{ id: 'mctrl', role: 'controller', column: 'control', parts: ['U1'], region: { col: 2, row: 0, wCells: 6, hCells: 5 } },
	],
	labelColumns: [
		{ id: 'NET_A@m0', net: 'NET_A', module: 'm0', side: 'right', routeEnd: 'from', class: 'signal' },
		{ id: 'NET_B@m1', net: 'NET_B', module: 'm1', side: 'right', routeEnd: 'from', class: 'signal' },
	],
	meta: { controller: 'U1', moduleCount: 4, columnCount: 2 },
};
const opts = {
	endpointNets: {
		m0: { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } },
		m1: { top: { name: 'V5', class: 'power' }, bottom: { name: 'GND', class: 'ground' } },
	},
};
const r = planLayout({ contract, byDes, opts });

test('planner:有 archetype 且零件齐的模块被 placed', () => {
	assert.deepEqual(r.placed.slice().sort(), ['m0', 'm1']);
});

test('planner:无 archetype 的模块进 skipped(no-archetype)', () => {
	const s = r.skipped.find(x => x.module === 'mctrl');
	assert.ok(s && s.reason === 'no-archetype');
});

test('planner:缺件的模块进 skipped(missing-parts)', () => {
	const s = r.skipped.find(x => x.module === 'm9');
	assert.ok(s && s.reason === 'missing-parts');
});

test('planner:model 含两模块全部组件/线/标', () => {
	assert.equal(r.model.components.length, 4);   // m0(R1,R2) + m1(R3,R4)
	assert.ok(r.model.wires.length > 0);
	assert.ok(r.model.netflags.length > 0);
});

test('planner:确定性(同输入两次 model 深相等)', () => {
	assert.deepEqual(planLayout({ contract, byDes, opts }).model, planLayout({ contract, byDes, opts }).model);
});

test('planner:负例(畸形 contract / byDes 非 Map)抛错', () => {
	assert.throws(() => planLayout({ contract: {}, byDes }));
	assert.throws(() => planLayout({ contract, byDes: {} }));
});

test('planner:cellExtentMinY 空几何抛错', () => {
	assert.throws(() => cellExtentMinY([], { wires: [], flags: [] }));
});

test('planner:组装 model 过真实 geomQC/labelQC hard=0', () => {
	const g = geomQC(r.model);
	assert.equal(g.overlaps.length, 0, 'overlaps');
	assert.equal(g.wireThruComp.length, 0, 'wireThruComp');
	assert.equal(g.offgrid, 0, 'offgrid');
	assert.equal(g.crossings, 0, 'crossings');
	const labelHard = labelQC(r.model).filter(f => f.severity === 'hard');
	assert.deepEqual(labelHard, [], 'labelQC hard');
});

test('planner:分数 localBox 件 → 引脚仍全格对齐、offgrid=0', () => {
	const fpassive = d => ({
		designator: d,
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10.5, minY: -5.5, maxX: 10.5, maxY: 5.5 },
	});
	const bd = new Map([['F1', fpassive('F1')], ['F2', fpassive('F2')], ['F3', fpassive('F3')], ['F4', fpassive('F4')]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['a', 'b'] }],
		modules: [
			{ id: 'a', role: 'support', column: 'input', parts: ['F1', 'F2'], region: { col: 0, row: 0, wCells: 3, hCells: 4 } },
			{ id: 'b', role: 'support', column: 'input', parts: ['F3', 'F4'], region: { col: 0, row: 10, wCells: 3, hCells: 4 } },
		],
		labelColumns: [], meta: { controller: null, moduleCount: 2, columnCount: 1 },
	};
	const rr = planLayout({ contract: ct, byDes: bd });
	for (const c of rr.model.components) {
		for (const p of c.pins) {
			assert.equal(p.x % 10, 0, `pin ${c.designator}.${p.num} x off-grid: ${p.x}`);
			assert.equal(p.y % 10, 0, `pin ${c.designator}.${p.num} y off-grid: ${p.y}`);
		}
	}
	assert.equal(geomQC(rr.model).offgrid, 0, 'offgrid');
});

test('planner:单件 connector + logical → 扇出有线有标;不传 logical 则裸件', () => {
	// 6 脚连接器(脚 x=±30 体外、纵距 40),role=connector → fanout。
	const conn = {
		designator: 'J9',
		pins: [
			{ num: '1', local: [-30, -40] }, { num: '2', local: [-30, 0] }, { num: '3', local: [-30, 40] },
			{ num: '4', local: [30, -40] }, { num: '5', local: [30, 0] }, { num: '6', local: [30, 40] },
		],
		localBox: { minX: -15, minY: -55, maxX: 15, maxY: 55 },
	};
	const bd = new Map([['J9', conn]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['c'] }],
		modules: [{ id: 'c', role: 'connector', column: 'input', parts: ['J9'], region: { col: 0, row: 0, wCells: 4, hCells: 6 } }],
		labelColumns: [], meta: { controller: null, moduleCount: 1, columnCount: 1 },
	};
	const lg = {
		nets: [
			{ name: 'GND', class: 'ground', pins: ['J9.1'] },
			{ name: 'USB_DN', class: 'signal', pins: ['J9.2'] },
			{ name: 'V5', class: 'power', pins: ['J9.3'] },
			{ name: 'TX', class: 'signal', pins: ['J9.4'] },
			{ name: 'RX', class: 'signal', pins: ['J9.5'] },
			{ name: 'V3V3', class: 'power', pins: ['J9.6'] },
		],
	};
	const withLog = planLayout({ contract: ct, byDes: bd, logical: lg });
	assert.ok(withLog.model.wires.length > 0, 'wires with logical');
	assert.ok(withLog.model.netflags.length > 0, 'flags with logical');
	const g = geomQC(withLog.model);
	assert.equal(g.overlaps.length + g.wireThruComp.length + g.offgrid + g.crossings, 0, 'geom clean');

	const noLog = planLayout({ contract: ct, byDes: bd });
	assert.equal(noLog.model.wires.length, 0, 'no wires without logical (backward compat)');
});

test('planner:单件 support + logical → 出电源/地桩;不传则裸件', () => {
	const cap = {
		designator: 'C1',
		pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }],
		localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 },
	};
	const bd = new Map([['C1', cap]]);
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['s'] }],
		modules: [{ id: 's', role: 'support', column: 'input', parts: ['C1'], region: { col: 0, row: 0, wCells: 3, hCells: 3 } }],
		labelColumns: [], meta: { controller: null, moduleCount: 1, columnCount: 1 },
	};
	const lg = { nets: [
		{ name: 'V5', class: 'power', pins: ['C1.2'] },
		{ name: 'GND', class: 'ground', pins: ['C1.1'] },
	] };
	const withLog = planLayout({ contract: ct, byDes: bd, logical: lg });
	assert.ok(withLog.model.wires.length > 0, 'wires with logical');
	assert.ok(withLog.model.netflags.length > 0, 'flags with logical');
	const g = geomQC(withLog.model);
	assert.equal(g.overlaps.length + g.wireThruComp.length + g.offgrid + g.crossings, 0, 'geom clean');

	const noLog = planLayout({ contract: ct, byDes: bd });
	assert.equal(noLog.model.wires.length, 0, 'no wires without logical (backward compat)');
});

test('planner:archetype 渲染抛错 → 模块进 skipped(render-error),不崩', () => {
	const passive = d => ({ designator: d, pins: [{ num: '1', local: [-20, 0] }, { num: '2', local: [20, 0] }], localBox: { minX: -10, minY: -5, maxX: 10, maxY: 5 } });
	const bd = new Map([['R1', passive('R1')], ['R2', passive('R2')]]);
	// connector 模块给了 2 个零件,但 fanout 要求恰 1 个 → 渲染抛错 → 应安全跳过。
	const ct = {
		schemaVersion: 1, grid: { colPitch: 10, rowPitch: 10 },
		columns: [{ id: 'input', role: 'in', order: 0, modules: ['bad'] }],
		modules: [{ id: 'bad', role: 'connector', column: 'input', parts: ['R1', 'R2'], region: { col: 0, row: 0, wCells: 3, hCells: 4 } }],
		labelColumns: [], meta: { controller: null, moduleCount: 1, columnCount: 1 },
	};
	let rr;
	assert.doesNotThrow(() => { rr = planLayout({ contract: ct, byDes: bd }); });
	const s = rr.skipped.find(x => x.module === 'bad');
	assert.ok(s && s.reason === 'render-error');
	assert.equal(rr.placed.length, 0);
});
