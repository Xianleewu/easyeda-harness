// schematic_extract 单测：从快照几何重建网表(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLogical } from './schematic_extract.mjs';

// R1.2 —wire— R2.1；R1.1 接 GND 网标；R2.2 悬空
const snap = {
	components: [
		{ id: 'c1', designator: 'R1', value: '10k', pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 10, y: 0 }] },
		{ id: 'c2', designator: 'R2', value: '4k7', pins: [{ num: '1', x: 20, y: 0 }, { num: '2', x: 30, y: 0 }] },
		{ id: 'u1', designator: 'U1', value: 'ESP32', pins: [{ num: '1', x: 0, y: 100 }, { num: '2', x: 0, y: 110 }] },
	],
	wires: [{ id: 'w1', line: [10, 0, 20, 0] }],
	netflags: [
		{ id: 'f1', type: 'netflag', net: 'GND', x: 0, y: 0 },
		{ id: 'f2', type: 'netflag', net: 'VCC_3V3', x: 0, y: 100 },
	],
};

function netOfPin(r, pinRef) { return r.nets.find(n => n.pins.includes(pinRef)); }

test('导线把两引脚连成同一网', () => {
	const r = extractLogical(snap);
	const n = netOfPin(r, 'R1.2');
	assert.ok(n, 'R1.2 应有网');
	assert.ok(n.pins.includes('R2.1'), 'R1.2 与 R2.1 应同网');
});

test('网标命名其网并分类为 ground', () => {
	const r = extractLogical(snap);
	const n = netOfPin(r, 'R1.1');
	assert.equal(n.name, 'GND');
	assert.equal(n.class, 'ground');
});

test('电源网按名分类为 power', () => {
	const r = extractLogical(snap);
	const n = netOfPin(r, 'U1.1');
	assert.equal(n.name, 'VCC_3V3');
	assert.equal(n.class, 'power');
});

test('信号网(无网标)分类为 signal', () => {
	const r = extractLogical(snap);
	const n = netOfPin(r, 'R1.2');
	assert.equal(n.class, 'signal');
});

test('parts 含 ref/kind/value;kind 由设计符前缀推断', () => {
	const r = extractLogical(snap);
	const byRef = Object.fromEntries(r.parts.map(p => [p.ref, p]));
	assert.equal(byRef['R1'].kind, 'resistor');
	assert.equal(byRef['R1'].value, '10k');
	assert.equal(byRef['U1'].kind, 'ic');
});

test('悬空引脚不并入任何已连网(自成单点或计入 floating)', () => {
	const r = extractLogical(snap);
	const n = netOfPin(r, 'R2.2');
	// R2.2 不与 R1.2/R2.1 同网
	assert.ok(!n || !n.pins.includes('R2.1'));
	assert.ok(r.stats.floatingPins >= 1);
});

test('同名网跨物理簇合并为一个逻辑网(命名网靠名连接)', () => {
	const s = {
		components: [
			{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'U2', pins: [{ num: '1', x: 500, y: 500 }] },
		],
		wires: [],
		netflags: [{ type: 'netflag', net: 'GND', x: 0, y: 0 }, { type: 'netflag', net: 'GND', x: 500, y: 500 }],
	};
	const r = extractLogical(s);
	const gnd = r.nets.filter(n => n.name === 'GND');
	assert.equal(gnd.length, 1, '两个 GND 网标应合并为一个 GND 网');
	assert.deepEqual(gnd[0].pins.sort(), ['U1.1', 'U2.1']);
});

test('导线 net 名命名其簇', () => {
	const s = {
		components: [{ designator: 'U1', pins: [{ num: '5', x: 0, y: 0 }] }, { designator: 'R1', pins: [{ num: '1', x: 10, y: 0 }] }],
		wires: [{ id: 'w', net: 'SDA', line: [0, 0, 10, 0] }],
		netflags: [],
	};
	const r = extractLogical(s);
	const n = r.nets.find(x => x.pins.includes('U1.5'));
	assert.equal(n.name, 'SDA');
});

test('T型连接:线端落在另一线段内部 → 同网(junction)', () => {
	// 横线 A:[0,0→100,0];竖线 B:[50,0→50,50],B 下端落在 A 内部(中点),非端点
	const s = {
		components: [
			{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'U2', pins: [{ num: '1', x: 100, y: 0 }] },
			{ designator: 'U3', pins: [{ num: '1', x: 50, y: 50 }] },
		],
		wires: [
			{ id: 'a', line: [0, 0, 100, 0] },
			{ id: 'b', line: [50, 0, 50, 50] },
		],
		netflags: [],
	};
	const r = extractLogical(s);
	const n = r.nets.find(x => x.pins.includes('U1.1'));
	assert.ok(n, 'U1.1 应有网');
	assert.ok(n.pins.includes('U2.1'), 'U1.1 与 U2.1 应同网(共线)');
	assert.ok(n.pins.includes('U3.1'), 'U3.1 经 T 型 junction 应并入同网');
});

test('共线但不接触的两线不误并(T型规则不过度连接)', () => {
	// A:[0,0→40,0];B:[60,0→100,0] 同一直线但中间断开 → 不应连通
	const s = {
		components: [
			{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'U2', pins: [{ num: '1', x: 100, y: 0 }] },
		],
		wires: [
			{ id: 'a', line: [0, 0, 40, 0] },
			{ id: 'b', line: [60, 0, 100, 0] },
		],
		netflags: [],
	};
	const r = extractLogical(s);
	const n = r.nets.find(x => x.pins.includes('U1.1'));
	assert.ok(!n.pins.includes('U2.1'), 'U1.1 与 U2.1 中间断开,不应同网');
});

test('丢弃摆放：输出不含 x/y', () => {
	const r = extractLogical(snap);
	const blob = JSON.stringify(r);
	assert.ok(!/"x":/.test(blob) && !/"y":/.test(blob), '逻辑模型不应含坐标');
});
