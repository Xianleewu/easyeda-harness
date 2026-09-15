// geom_qc 单测:重点验证 wireThruPin —— 导线内部压到外部引脚(EDA 拒建会短路)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geomQC } from './geom_qc.mjs';

const box = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test('standalone text is checked against bodies, other text and wires', () => {
	const model = { components:[{designator:'U1',bbox:box(0,0,20,20),pins:[]}],
		wires:[{net:'signal',line:[30,10,80,10]}], netflags:[],
		texts:[{id:'body-note',bbox:box(5,5,15,15)},{id:'wire-note',bbox:box(40,5,60,15)},
			{id:'second-note',bbox:box(45,8,65,18)}] };
	const result = geomQC(model);
	assert.ok(result.overlaps.some(s => s.includes('body-note') && s.includes('U1')));
	assert.ok(result.overlaps.some(s => s.includes('wire-note') && s.includes('second-note')));
	assert.equal(result.textOnWire.length, 2);
});

test('grid tolerates rotation roundoff but detects actual displacement', () => {
	const check = x => geomQC({ components: [{ designator: 'U1', bbox: box(0, 0, 20, 20),
		pins: [{ num: '1', x, y: 10 }] }], wires: [], netflags: [] }, { grid: 5 }).offgrid;
	assert.equal(check(10 + 1e-12), 0);
	assert.equal(check(10.01), 1);
});

test('wireThruPin:线段内部压到外部引脚 → 报 hard', () => {
	// U1 在 [0..20]x[0..100],引脚 U1.1 @(50,50) 伸出本体右侧;
	// 一条线 [10,50→100,50] 水平穿过 (50,50) 这个引脚(内部,非端点)。
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [10, 50, 100, 50] }],
		netflags: [],
	};
	const r = geomQC(model);
	assert.ok(r.wireThruPin.length >= 1, '应检出线压外部引脚');
	assert.ok(r.wireThruPin[0].includes('U1.1'), 'finding 应指明 U1.1');
});

test('wireThruPin:线端点接引脚(正常连接)→ 不报', () => {
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [50, 50, 100, 50] }],   // 端点正好在引脚
		netflags: [],
	};
	const r = geomQC(model);
	assert.equal(r.wireThruPin.length, 0, '端点接引脚是正常连接,不应报');
});

test('wireThruPin:导线端点碰到 NoConnected 引脚 → 报 hard', () => {
	const model = {
		components: [{ designator: 'J1', bbox: box(0, 0, 20, 100), pins: [
			{ num: '1', x: 50, y: 50, noConnected: true },
		] }],
		wires: [{ net: 'SIG', line: [50, 50, 100, 50] }],
		netflags: [],
	};
	const r = geomQC(model);
	assert.ok(r.wireThruPin.some(x => x.includes('wire-to-no-connect J1.1')));
});

test('wireThruPin:同网母线仅错开引脚列一个小栅格 → 报逃逸间距不足', () => {
	const model = {
		components: [{ designator: 'J1', bbox: box(0, 0, 40, 100), pins: [
			{ num: '1', x: 40, y: 20 }, { num: '2', x: 40, y: 40 }, { num: '3', x: 40, y: 60 },
		] }],
		wires: [
			{ net: 'GND', line: [40, 20, 45, 20] },
			{ net: 'GND', line: [40, 40, 45, 40] },
			{ net: 'GND', line: [40, 60, 45, 60] },
			{ net: 'GND', line: [45, 0, 45, 60] },
		],
		netflags: [],
	};
	const r = geomQC(model);
	assert.ok(r.wireThruPin.some(x => x.includes('bus-too-close-to-pin-column J1.1,2,3 clearance=5')));
});

test('wireThruPin:支线越过共享母线形成回折过冲 → 报错', () => {
	const model = {
		components: [{ designator: 'J4', bbox: box(0, 0, 20, 50), pins: [
			{ num: '1', x: 30, y: 10 }, { num: '2', x: 30, y: 20 }, { num: '3', x: 30, y: 30 },
		] }],
		wires: [
			{ id: 'g#0', net: '', line: [30,10,60,10] },
			{ id: 'g#1', net: '', line: [40,10,40,30] },
			{ id: 'g#2', net: '', line: [40,20,30,20] },
			{ id: 'g#3', net: '', line: [40,30,30,30] },
		],
		netflags: [],
	};
	const r = geomQC(model);
	assert.ok(r.wireThruPin.some(x => x.includes('bus-branch-overhang J4.1 overhang=20')));
});

test('wireThruPin:外置引脚首段必须沿引脚轴向器件外逃逸', () => {
	const component = { designator: 'J7', bbox: box(20, 0, 60, 60), pins: [
		{ num: '1', x: 10, y: 20 }, { num: '2', x: 70, y: 40 }, { num: '3', x: 10, y: 50 },
	] };
	const good = geomQC({ components: [component], wires: [
		{ net: 'A', line: [10, 20, 0, 20] }, { net: 'B', line: [70, 40, 80, 40] },
	], netflags: [] });
	assert.ok(!good.wireThruPin.some(x => x.includes('pin-escape-inward')));
	const bad = geomQC({ components: [component], wires: [
		{ net: 'A', line: [10, 20, 20, 20] }, { net: 'B', line: [70, 40, 70, 50] },
	], netflags: [] });
	assert.ok(bad.wireThruPin.some(x => x.includes('pin-escape-inward J7.1')));
	assert.ok(bad.wireThruPin.some(x => x.includes('pin-escape-inward J7.2')));
});

test('wireThruPin:线不经过任何引脚 → 不报', () => {
	const model = {
		components: [{ designator: 'U1', bbox: box(0, 0, 20, 100), pins: [{ num: '1', x: 50, y: 50 }] }],
		wires: [{ net: 'SIG', line: [10, 200, 100, 200] }],
		netflags: [],
	};
	const r = geomQC(model);
	assert.equal(r.wireThruPin.length, 0);
});

test('collinear:两段同 y 异网、x 范围内部重叠 → 报短路(正交点相交检测漏的这类)', () => {
	const r = geomQC({ components: [], netflags: [], wires: [
		{ net: 'NETA', line: [0, 100, 50, 100] },
		{ net: 'NETB', line: [30, 100, 80, 100] },   // 与 NETA 在 [30..50] 共线重叠
	] });
	assert.equal(r.collinear, 1, '一处共线异网短路');
	assert.ok(r.collEx[0].includes('y=100'));
});

test('collinear:竖直同 x 异网重叠 → 报;同网重叠 / 端点相贴 → 不报', () => {
	const vert = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [100, 0, 100, 50] }, { net: 'B', line: [100, 30, 100, 80] },
	] });
	assert.equal(vert.collinear, 1, '竖直异网重叠=短路');
	const same = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 100, 50, 100] }, { net: 'A', line: [30, 100, 80, 100] },
	] });
	assert.equal(same.collinear, 0, '同网重叠不是短路');
	const touch = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 100, 50, 100] }, { net: 'B', line: [50, 100, 80, 100] },
	] });
	assert.equal(touch.collinear, 0, '端点相贴不算重叠');
});

test('endpointShort:两条异网线共享端点 → 报短路;同网相接 → 不报', () => {
	const sh = geomQC({ components: [], netflags: [], wires: [
		{ net: 'NA', line: [0, 50, 50, 50] }, { net: 'NB', line: [50, 50, 50, 80] },   // (50,50) 异网共点
	] });
	assert.equal(sh.endpointShort, 1, '异网端点重合=短路');
	assert.ok(sh.endEx[0].includes('50,50'));
	const same = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 50, 50, 50] }, { net: 'A', line: [50, 50, 50, 80] },   // 同网折点
	] });
	assert.equal(same.endpointShort, 0, '同网端点相接=正常折线');
});

test('endpointOnWire:线端点落在异网线内部(T 接)→ 报短路;同网分支 → 不报', () => {
	const t = geomQC({ components: [], netflags: [], wires: [
		{ net: 'NA', line: [0, 50, 50, 50] }, { net: 'NB', line: [30, 50, 30, 80] },   // NB 端点(30,50)在 NA 内部
	] });
	assert.equal(t.endpointOnWire, 1, '异网 T 接=短路');
	assert.ok(t.eowEx[0].includes('30,50'));
	const same = geomQC({ components: [], netflags: [], wires: [
		{ net: 'A', line: [0, 50, 50, 50] }, { net: 'A', line: [30, 50, 30, 80] },   // 同网分支(junction)
	] });
	assert.equal(same.endpointOnWire, 0, '同网分支是正常 junction');
});

test('wireThruComp:排除连本件自己脚的段(脚在体外),保留穿本件体的真穿', () => {
	// R1 脚在体框外(905/945),体框 915-935(电阻/电容等真实件常见)。
	const r1 = { designator: 'R1', bbox: box(915, 491, 935, 499), pins: [{ num: '1', x: 905, y: 495 }, { num: '2', x: 945, y: 495 }] };
	// ① 连 R1 自己脚2(945)的段从体框内伸到脚 → 穿体框但端点在本件脚 → 误报已排除
	const ownPin = geomQC({ components: [r1], netflags: [], wires: [{ net: 'A', line: [920, 495, 945, 495] }] });
	assert.equal(ownPin.wireThruComp.length, 0, '连本件自己脚的段穿体框 = 误报已排除');
	// ② 长线 y=493 横穿 R1 体框、端点(800/1000)远离 R1 脚、不经脚 → 真穿仍报
	const realThru = geomQC({ components: [r1], netflags: [], wires: [{ net: 'B', line: [800, 493, 1000, 493] }] });
	assert.ok(realThru.wireThruComp.length >= 1, '穿本件体且端点不在本件脚 = 真穿仍检测(防过度排除藏真穿)');
});

test('回归:既有字段仍在(含 collinear/endpointShort/endpointOnWire 短路家族)', () => {
	const r = geomQC({ components: [], wires: [], netflags: [] });
	assert.deepEqual(r.overlaps, []);
	assert.deepEqual(r.wireThruComp, []);
	assert.equal(r.crossings, 0);
	assert.deepEqual(r.wireThruPin, []);
	assert.equal(r.collinear, 0);
	assert.equal(r.endpointShort, 0);
	assert.equal(r.endpointOnWire, 0);
});

test('DR4:两器件的可见标注 bbox 重叠 → overlaps 报 attr 对', () => {
	const m = { components: [
		{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: true, bbox: { minX: 0, minY: 8, maxX: 20, maxY: 14 } }] },
		{ designator: 'R2', bbox: { minX: 40, minY: 0, maxX: 50, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: true, bbox: { minX: 12, minY: 8, maxX: 32, maxY: 14 } }] },
	], wires: [], netflags: [] };
	const r = geomQC(m);
	assert.ok(r.overlaps.some(s => s.includes('attr:R1.Name') && s.includes('attr:R2.Name')), JSON.stringify(r.overlaps));
});

test('DR5:标注 bbox 压到别的器件本体 → overlaps 报', () => {
	const m = { components: [
		{ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 }, pins: [], attrs: [] },
		{ designator: 'R9', bbox: { minX: 100, minY: 100, maxX: 110, maxY: 106 }, pins: [], attrs: [{ key: 'Designator', valueVisible: true, bbox: { minX: 5, minY: 5, maxX: 25, maxY: 12 } }] },
	], wires: [], netflags: [] };
	const r = geomQC(m);
	assert.ok(r.overlaps.some(s => s.includes('attr:R9.Designator') && s.includes('U1')), JSON.stringify(r.overlaps));
});

test('不可见标注不计入重叠', () => {
	const m = { components: [
		{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: false, bbox: { minX: 0, minY: 8, maxX: 20, maxY: 14 } }] },
		{ designator: 'B', bbox: { minX: 40, minY: 0, maxX: 50, maxY: 6 }, pins: [], attrs: [{ key: 'Name', valueVisible: false, bbox: { minX: 12, minY: 8, maxX: 32, maxY: 14 } }] },
	], wires: [], netflags: [] };
	assert.equal(geomQC(m).overlaps.filter(s => s.includes('attr:')).length, 0);
});

/* textOnWire 专项测试 (rulebook 行 166)
 * 用到 A1 器件:bbox=[0..20 x 0..10], 脚1@(0,5)(左中), 脚2@(20,5)(右中)
 * attr 'Ref' 可见,bbox=[0..30 x 12..18] — 位于体框正下方
 */
test('textOnWire[正]:别的器件连过来的线穿过标注 bbox → 报 attr:A1.Ref', () => {
	/* 导线 [0,15→50,15] 水平穿过 attr bbox(y 在 12..18 内),
	 * 端点(0,15)和(50,15)都不在 A1 的脚(0,5)或(20,5)上 → 应报 */
	const m = {
		components: [
			{
				designator: 'A1',
				bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
				pins: [{ num: '1', x: 0, y: 5 }, { num: '2', x: 20, y: 5 }],
				attrs: [{ key: 'Ref', valueVisible: true, bbox: { minX: 0, minY: 12, maxX: 30, maxY: 18 } }],
			},
		],
		wires: [{ net: 'SIG', line: [0, 15, 50, 15] }],
		netflags: [],
	};
	const r = geomQC(m);
	assert.ok(r.textOnWire.length >= 1, `应报 textOnWire,实际:${JSON.stringify(r.textOnWire)}`);
	assert.ok(r.textOnWire[0].includes('attr:A1.Ref'), `finding 应含 attr:A1.Ref,实际:${r.textOnWire[0]}`);
});

test('textOnWire[负]:穿过标注 bbox 的线其端点在本件自己脚上 → 不报(无 false positive)', () => {
	/* A1 自身脚2@(20,5),从(20,5)出发的线段向右到(50,5),纵坐标=5。
	 * 将 attr bbox 设在 y 范围包含 5 的位置([18..20 x 3..8]),
	 * 且线段 x 范围(20..50)会穿过 minX=18..maxX=20+ 的左侧,
	 * 使 segInRect 判定"穿过",但端点(20,5)恰好在 A1 脚2 → 应被排除不报 */
	const m = {
		components: [
			{
				designator: 'A1',
				bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
				pins: [{ num: '1', x: 0, y: 5 }, { num: '2', x: 20, y: 5 }],
				attrs: [{ key: 'Ref', valueVisible: true, bbox: { minX: 15, minY: 3, maxX: 35, maxY: 8 } }],
			},
		],
		wires: [{ net: 'VCC', line: [20, 5, 50, 5] }],
		netflags: [],
	};
	const r = geomQC(m);
	assert.equal(r.textOnWire.length, 0, `端点在本件脚上的线不应报 textOnWire,实际:${JSON.stringify(r.textOnWire)}`);
});

test('DR2:不同未命名 wire group 的正交中段交叉也必须报', () => {
	const r=geomQC({components:[],netflags:[],wires:[
		{id:'wire-a#0',net:'',line:[0,10,20,10]},
		{id:'wire-b#0',net:'',line:[10,0,10,20]},
	]});
	assert.equal(r.crossings,1);
	assert.ok(r.crossEx[0].includes('@unnamed:wire-a'));
});

test('DR2:同一未命名 wire group 的分段连接不误报', () => {
	const r=geomQC({components:[],netflags:[],wires:[
		{id:'wire-a#0',net:'',line:[0,10,10,10]},
		{id:'wire-a#1',net:'',line:[10,10,10,20]},
	]});
	assert.equal(r.crossings,0);
	assert.equal(r.endpointShort,0);
	assert.equal(r.endpointOnWire,0);
});

test('DR2:分属不同 primitive 但经端点/T 接连续的未命名支线属于同一电气网', () => {
	const r=geomQC({components:[],netflags:[],wires:[
		{id:'trunk',line:[0,0,40,0]},
		{id:'bend',line:[40,0,40,30]},
		{id:'tap',line:[20,0,20,20]},
	]});
	assert.equal(r.endpointShort,0);
	assert.equal(r.endpointOnWire,0);
});

test('DR2:命名线把身份传播到相连无名支线，但不同命名网仍报短路', () => {
	const ok=geomQC({components:[],netflags:[],wires:[
		{net:'A',line:[0,0,20,0]},{line:[20,0,20,20]},
	]});
	assert.equal(ok.endpointShort,0);
	const bad=geomQC({components:[],netflags:[],wires:[
		{net:'A',line:[0,0,20,0]},{line:[20,0,20,20]},{net:'B',line:[20,20,40,20]},
	]});
	assert.ok(bad.endpointShort>0||bad.endpointOnWire>0);
});
