// 几何严标检查器单测(RED 验证:无实现)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrtho, checkGrid, checkNoCross, checkNoThru, checkNoOverlap, checkTextOverlap, checkWireThruText, checkLabelCrowd, checkDensity, checkBodyClearance, checkPage, checkModuleSpacing, checkCellSpacing, checkConnectorMountingPins, checkConnectorPinSemantics, checkHighSpeedIntent, checkPassiveFootprints, checkAnnotPlace, checkAnnotSide, checkAnnotFull, checkRegionCoverage, checkDrc, judgeTokens, auditTokenCoverage, checkLabelAlign, checkFlagAlign, checkFlagOrient, checkAdjacency } from './token_conformance.mjs';

/* IC U1(电源脚P1在(0,0)接VCC)+ 去耦cap C1(电源脚接VCC、地脚接GND)。nets=权威pin→net。 */
const adjNets = { U1: { '1': 'VCC', '2': 'GND', '3': 'SIG' }, C1: { '1': 'VCC', '2': 'GND' } };
const mkU1 = () => ({ designator: 'U1', bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, pins: [{ num: '1', x: 0, y: 20 }, { num: '2', x: 0, y: 10 }, { num: '3', x: 40, y: 20 }] });

test('T-ADJACENCY 不相邻:cap仅靠net标签连(与IC脚不同wire分量)→ ✗', () => {
	const model = {
		components: [mkU1(), { designator: 'C1', bbox: { minX: 50, minY: 15, maxX: 56, maxY: 25 }, pins: [{ num: '1', x: 53, y: 25 }, { num: '2', x: 53, y: 15 }] }],
		/* cap 的桩 [53,25→70,25] 到一个 net 标签点,不与 U1.1(0,20)同分量 */
		wires: [{ line: [53, 25, 70, 25], net: 'VCC' }, { line: [0, 20, -20, 20], net: 'VCC' }],
		netflags: [],
	};
	const r = checkAdjacency(model, { nets: adjNets });
	assert.equal(r.token, 'T-ADJACENCY');
	assert.equal(r.conform, false, '仅net标签远连 → 不相邻 ✗');
	assert.equal(r.deviations[0].kind, 'not-direct');
});

test('T-ADJACENCY 相邻:cap电源脚与IC电源脚同一wire连通分量+近 → ✓', () => {
	const model = {
		components: [mkU1(), { designator: 'C1', bbox: { minX: 10, minY: 15, maxX: 16, maxY: 25 }, pins: [{ num: '1', x: 13, y: 20 }, { num: '2', x: 13, y: 10 }] }],
		/* 直连:U1.1(0,20) — cap.1(13,20) 同一条线 → 同分量、近 */
		wires: [{ line: [0, 20, 13, 20], net: 'VCC' }],
		netflags: [],
	};
	const r = checkAdjacency(model, { nets: adjNets });
	assert.equal(r.conform, true, '直连+近 → 相邻 ✓');
});

test('T-ADJACENCY 无netlist → 跳过(不臆测)', () => {
	assert.equal(checkAdjacency({ components: [], wires: [] }, {}).conform, true);
});

test('T-ADJACENCY live evidence contract: missing authoritative netlist fails once at the root cause', () => {
	const r=checkAdjacency({components:[],wires:[]},{requireEvidence:true});
	assert.equal(r.conform,false);
	assert.deepEqual(r.deviations,[{kind:'missing-authoritative-netlist'}]);
	assert.equal(r.detail.evidenceRequired,true);
	const report=judgeTokens({components:[],wires:[],netflags:[]},{drc:{error:0,warn:0,info:0},requireNetlistEvidence:true});
	assert.equal(report.tier2.find(x=>x.token==='T-ADJACENCY').conform,false);
});

test('T-LABEL-CROWD locates overlapping label text and wire-through-label geometry',()=>{
	const model={components:[],netflags:[
		{kind:'sig',net:'A',wireId:'w1',x:0,y:10,textX:0,textY:10,alignMode:6,bbox:{minX:0,minY:2,maxX:20,maxY:10}},
		{kind:'sig',net:'B',wireId:'w2',x:0,y:15,textX:0,textY:15,alignMode:6,bbox:{minX:0,minY:7,maxX:20,maxY:15}},
	],wires:[{id:'w1',net:'A',line:[0,10,30,10]},{id:'w2',net:'B',line:[0,15,30,15]}]};
	const r=checkLabelCrowd(model);
	assert.equal(r.conform,false);
	assert.ok(r.deviations.some(d=>d.kind==='label-text-overlap'&&d.a==='w1'&&d.b==='w2'));
	assert.ok(r.deviations.some(d=>d.kind==='label-wire-through'));
});

test('T-ANNOT-SIDE audits every fitted component, including multi-pin devices',()=>{
	const component=(valueY)=>({designator:'U1',bbox:{minX:0,minY:0,maxX:40,maxY:40},pins:[{},{},{}],attrs:[
		{key:'Designator',value:'U1',valueVisible:true,bbox:{minX:0,minY:-20,maxX:10,maxY:-10}},
		{key:'Name',value:'MODEL',valueVisible:true,bbox:{minX:0,minY:valueY,maxX:25,maxY:valueY+8}},
	]});
	assert.equal(checkAnnotSide({components:[component(-35)]}).conform,true);
	const bad=checkAnnotSide({components:[component(50)]});
	assert.equal(bad.conform,false);
	assert.equal(bad.deviations[0].designator,'U1');
	const corner={designator:'U2',bbox:{minX:10,minY:10,maxX:30,maxY:30},pins:[{},{},{}],attrs:[
		{key:'Designator',value:'U2',valueVisible:true,bbox:{minX:0,minY:0,maxX:8,maxY:8}},
		{key:'Name',value:'MODEL',valueVisible:true,bbox:{minX:12,minY:0,maxX:28,maxY:8}},
	]};
	assert.equal(checkAnnotSide({components:[corner]}).conform,true,'corner annotation shares the above side');
});

test('T-ORPHAN requires unique live module and cell membership with object-level diagnostics',()=>{
	const model={components:[{designator:'U1'},{designator:'C1'}]};
	const r=checkRegionCoverage(model,{moduleRegions:[{id:'m',members:['U1']}],cellRegions:[{id:'c',members:['U1','C1']}],requireEvidence:true});
	assert.equal(r.conform,false);
	assert.deepEqual(r.deviations,[{kind:'orphan-component',regionKind:'module',designator:'C1'}]);
	assert.equal(checkRegionCoverage(model,{moduleRegions:[{id:'m',members:['U1','C1']}],cellRegions:[{id:'c',members:['U1','C1']}],requireEvidence:true}).conform,true);
});

/* 忠实语义:cap 用导线连到它服务的 IC 脚(贴近),即使同网【另一】IC 脚凑巧几何更近【但未连】,仍算 direct(✓)。
 * (不据"绝对最近脚"判 not-direct —— 那会冤判贴在自家脚上的电容;但仍要求"确连到某同网脚"防 net 标签远连。) */
test('T-ADJACENCY 贴脚直连:同网另一IC脚更近但未连 → 仍 ✓(不冤判)', () => {
	const nets = { U1: { '1': 'VCC', '2': 'GND', '3': 'SIG' }, U2: { '1': 'VCC', '2': 'GND', '3': 'SIG2' }, C1: { '1': 'VCC', '2': 'GND' } };
	const model = {
		components: [
			mkU1(),                                                                                  /* U1.1 VCC @ (0,20) */
			{ designator: 'U2', bbox: { minX: 20, minY: 15, maxX: 28, maxY: 25 }, pins: [{ num: '1', x: 24, y: 20 }, { num: '2', x: 24, y: 10 }, { num: '3', x: 28, y: 20 }] }, /* U2.1 VCC @ (24,20) 更近但未与 cap 连 */
			{ designator: 'C1', bbox: { minX: 10, minY: 15, maxX: 16, maxY: 25 }, pins: [{ num: '1', x: 13, y: 20 }, { num: '2', x: 13, y: 10 }] },
		],
		wires: [{ line: [0, 20, 13, 20], net: 'VCC' }],   /* cap.1(13,20) 仅与 U1.1(0,20) 同线;U2.1(24,20) 更近(11)但不同分量 */
		netflags: [],
	};
	const r = checkAdjacency(model, { nets });
	assert.equal(r.conform, true, '连到自家服务脚 U1.1(13)<阈值 → ✓,不因 U2.1 更近未连而冤判');
});

/* 防作弊:确连到某同网脚但【太远】(>阈值)→ too-far(贴脚必须真贴近,不能拉长线蒙混)。 */
test('T-ADJACENCY 连了但太远 → too-far ✗', () => {
	const nets = { U1: { '1': 'VCC', '2': 'GND', '3': 'SIG' }, C1: { '1': 'VCC', '2': 'GND' } };
	const model = {
		components: [mkU1(), { designator: 'C1', bbox: { minX: 295, minY: 15, maxX: 301, maxY: 25 }, pins: [{ num: '1', x: 298, y: 20 }, { num: '2', x: 298, y: 10 }] }],
		wires: [{ line: [0, 20, 298, 20], net: 'VCC' }],   /* 直连但 298 远 > decap 阈值 200 */
		netflags: [],
	};
	const r = checkAdjacency(model, { nets, adjacency: { decap: 200, pull: 110 } });
	assert.equal(r.conform, false);
	assert.equal(r.deviations[0].kind, 'too-far');
});

/* 2脚去耦电容(竖置,体心 cy=100) + 电源flag/地flag。屏幕坐标 y 向下:电源须落较小 y(视觉上)、地较大 y(视觉下)。 */
const mkCapFlags = (powY, gndY) => ({
	components: [{ designator: 'C9', bbox: { minX: 95, minY: 90, maxX: 105, maxY: 110 }, pins: [{ num: '1', x: 100, y: 88 }, { num: '2', x: 100, y: 112 }] }],
	netflags: [
		{ kind: 'power', net: 'VCC', x: 100, y: powY, textX: 100, textY: powY, bbox: { minX: 94, minY: powY, maxX: 106, maxY: powY + 11 } },
		{ kind: 'ground', net: 'GND', x: 100, y: gndY, textX: 100, textY: gndY, bbox: { minX: 89, minY: gndY - 20, maxX: 111, maxY: gndY } },
	],
	wires: [
		{net:'VCC',line:powY<100?[100,powY,100,88]:[100,112,100,powY]},
		{net:'GND',line:gndY<100?[100,gndY,100,88]:[100,112,100,gndY]},
	],
});

test('T-FLAG-ORIENT 反向:电源flag在视觉下(小y)、地在上(大y)→ ✗(抓肉眼可见的反向)', () => {
	const r = checkFlagOrient(mkCapFlags(70, 130));
	assert.equal(r.token, 'T-FLAG-ORIENT');
	assert.equal(r.conform, false);
	assert.ok(r.deviations.length >= 1, '反向必报');
});

test('T-FLAG-ORIENT 正确:电源flag视觉上(大y)、地视觉下(小y)→ ✓', () => {
	const r = checkFlagOrient(mkCapFlags(132, 68));
	assert.equal(r.conform, true);
	assert.equal(r.deviations.length, 0);
});

test('T-ORTHO 严标:有1段斜线即不符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0], net: '' }, { line: [0,0,10,10], net: '' }] });
	assert.equal(r.token, 'T-ORTHO');
	assert.equal(r.conform, false);
	assert.equal(r.deviations.length, 1);
});

test('T-ORTHO 全正交 → 符合', () => {
	const r = checkOrtho({ wires: [{ line: [0,0,10,0,10,10], net: '' }] });
	assert.equal(r.token, 'T-ORTHO');
	assert.equal(r.conform, true);
	assert.equal(r.deviations.length, 0);
});

test('T-GRID 严标:任一脚脱格即不符合', () => {
	const ok = checkGrid({ components: [{ pins: [{x:0,y:0},{x:10,y:15}], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 } }] });
	assert.equal(ok.token, 'T-GRID');
	assert.equal(ok.conform, true);
	const bad = checkGrid({ components: [{ pins: [{x:3,y:5}], bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }] });
	assert.equal(bad.conform, false);
	assert.equal(bad.deviations.length, 1);
});

test('T-NOCROSS 0 crossing → 符合', () => {
	const r = checkNoCross({ wires: [{ line: [0,0,10,0], net: 'A' }, { line: [20,0,30,0], net: 'B' }], components: [] });
	assert.equal(r.token, 'T-NOCROSS');
	assert.equal(r.conform, true);
});

test('T-NOCROSS 只短接(中段相接)无交叉也不符合', () => {
	// 两段共线重叠（中段相接），geomQC 记 collinear
	const model = { wires: [{ line: [0,0,20,0], net: 'A' }, { line: [10,0,30,0], net: 'B' }], components: [] };
	const r = checkNoCross(model);
	// shorts > 0 意味着中段相接，必定不符合
	if (r.detail.shorts > 0) {
		assert.equal(r.conform, false);
		assert(r.deviations.some(d => d.kind === 'mid-segment-touch'));
	}
	// 也验证 conform ↔ deviations 长度一致的不变式
	assert.equal(r.conform, r.deviations.length === 0);
});

test('T-FLAG-ORIENT ignores a nearby flag belonging to an adjacent two-pin component',()=>{
	const model=mkCapFlags(132,68);
	model.components.push({designator:'C10',bbox:{minX:110,minY:90,maxX:120,maxY:110},pins:[{num:'1',x:115,y:88},{num:'2',x:115,y:112}]});
	model.netflags.push({kind:'ground',net:'GND',x:115,y:68,bbox:{minX:104,minY:48,maxX:126,maxY:68}});
	model.wires.push({net:'GND',line:[115,88,115,68]});
	assert.equal(checkFlagOrient(model).conform,true);
});

test('T-NOCROSS 报告包含可直接定位的交叉实例', () => {
	const model = { wires: [
		{ line: [0, 10, 20, 10], net: 'H' },
		{ line: [10, 0, 10, 20], net: 'V' },
	], components: [] };
	const r = checkNoCross(model);
	assert.equal(r.conform, false);
	assert.match(r.deviations[0].examples[0], /HxV@\(10,10\)/);
	assert.deepEqual(r.detail.crossingExamples, r.deviations[0].examples);
});

test('T-NOTHRU 0 wire-thru → 符合', () => {
	const r = checkNoThru({ wires: [{ line: [0,0,10,0], net: 'A' }], components: [{ designator: 'R1', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }] });
	assert.equal(r.token, 'T-NOTHRU');
	assert.equal(r.conform, true);
});

test('T-NOTHRU 报告包含被穿越的器件或引脚', () => {
	const r = checkNoThru({
		wires: [{ line: [0, 10, 30, 10], net: 'SIG' }],
		components: [{ designator: 'U1', bbox: { minX: 10, minY: 5, maxX: 20, maxY: 15 }, pins: [] }],
	});
	assert.equal(r.conform, false);
	assert.match(r.deviations[0].examples[0], /thru U1/);
	assert.equal(r.detail.componentExamples.length, 1);
});

test('T-NOOVERLAP 0 overlap → 符合', () => {
	const r = checkNoOverlap({ components: [{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [] }, { designator: 'R2', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }], wires: [], netflags: [] });
	assert.equal(r.token, 'T-NOOVERLAP');
	assert.equal(r.conform, true);
});

/* T-TEXT-OVERLAP:符号网名文字×(别的符号名/字形/标注)相交。geomQC 只查字形漏网名→此 token 补瞎尺。 */
test('T-TEXT-OVERLAP[C9/R4 验收]:VCC_3V3 电源符号与 GND 地符号挨太近,名压对方字形 → ✗ 抓到', () => {
	// power 名在脚上方、ground 名在脚下方；脚位过近时文字仍会相交。
	const model = { components: [], wires: [], netflags: [
		{ kind: 'ground', net: 'GND', x: 100, y: 92, textX: 100, textY: 92 },
		{ kind: 'power', net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 },
	] };
	const r = checkTextOverlap(model);
	assert.equal(r.token, 'T-TEXT-OVERLAP');
	assert.equal(r.conform, false, `C9/R4 那处 GND×VCC_3V3 必须被抓到,实际:${JSON.stringify(r.deviations)}`);
	assert.ok(r.deviations.some(d => (d.a + d.b).includes('VCC_3V3') && (d.a + d.b).includes('GND')), JSON.stringify(r.deviations));
});

test('T-TEXT-OVERLAP[live 无 kind]:netflag 缺 f.kind → 按 classOfNet(net) 推,仍抓到', () => {
	// live readGeometry 的 netflag 无 kind;net 名 GND→ground、VCC_3V3→power
	const model = { components: [], wires: [], netflags: [
		{ net: 'GND', x: 100, y: 92, textX: 100, textY: 92 },
		{ net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 },
	] };
	assert.equal(checkTextOverlap(model).conform, false, 'live 路径(无 kind)也必须抓到,否则 gating live judge 判瞎');
});

test('T-TEXT-OVERLAP[名×标注]:电源符号网名压邻近电阻位号 → ✗', () => {
	const model = { components: [
		{ designator: 'R8', bbox: { minX: 90, minY: 120, maxX: 110, maxY: 128 }, pins: [],
			attrs: [{ key: 'Designator', value: 'R8', valueVisible: true, bbox: { minX: 88, minY: 92, maxX: 130, maxY: 98 } }] },
	], wires: [], netflags: [
		{ kind: 'power', net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 },
	] };
	const r = checkTextOverlap(model);
	assert.ok(r.deviations.some(d => (d.a + d.b).includes('VCC_3V3') && (d.a + d.b).includes('R8.Designator')), JSON.stringify(r.deviations));
});

test('T-TEXT-OVERLAP[负]:孤立电源符号 + 远处地符号 → 名不压,✓', () => {
	const model = { components: [], wires: [], netflags: [
		{ kind: 'power', net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 },
		{ kind: 'ground', net: 'GND', x: 400, y: 400, textX: 400, textY: 400 },
	] };
	assert.equal(checkTextOverlap(model).conform, true);
});

test('T-TEXT-OVERLAP[负]:名贴自身字形外缘=相切非相交,不自压', () => {
	const r = checkTextOverlap({ components: [], wires: [], netflags: [{ kind: 'power', net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 }] });
	assert.equal(r.conform, true, `单个符号不应自压,实际:${JSON.stringify(r.deviations)}`);
});

/* T-NOTHRU-TEXT:导线穿文字(标注/net标签/符号名)内部。T-NOTHRU 只查穿件体/脚,对穿文字瞎。 */
test('T-NOTHRU-TEXT:*_MIDDLE 信号标签纵向居中在导线上 → 线穿文字中线 → ✗', () => {
	// 标签框纵向居中在 y=100(线所在),线横穿其 x 内部 = 用户肉眼的"线穿文字中线"
	const model = { components: [], wires: [{ net: 'SIGNAL_A', line: [0, 100, 200, 100] }], netflags: [
		{ kind: 'sig', net: 'SIGNAL_A', x: 100, y: 100, textX: 100, textY: 100, bbox: { minX: 50, minY: 97, maxX: 150, maxY: 103 } },
	] };
	const r = checkWireThruText(model);
	assert.equal(r.token, 'T-NOTHRU-TEXT');
	assert.ok(r.deviations.some(d => d.text.includes('SIGNAL_A')), `*_MIDDLE 标签被线穿必须抓到,实际:${JSON.stringify(r.deviations)}`);
});

test('T-NOTHRU-TEXT[符号名]:导线穿电源符号网名 → ✗', () => {
	const model = { components: [], wires: [{ net: 'X', line: [0, 97, 200, 97] }], netflags: [
		{ kind: 'power', net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 },
	] };
	const r = checkWireThruText(model);
	assert.ok(r.deviations.some(d => d.text.includes('VCC_3V3')));
	assert.deepEqual(r.deviations[0].segment, [0, 97, 200, 97]);
	assert.ok(r.deviations[0].textBox.maxX > r.deviations[0].textBox.minX);
});

test('T-NOTHRU-TEXT[live 无 kind]:netflag 缺 kind → classOfNet 推,仍抓穿符号名', () => {
	const model = { components: [], wires: [{ net: 'X', line: [0, 97, 200, 97] }], netflags: [{ net: 'VCC_3V3', x: 100, y: 100, textX: 100, textY: 100 }] };
	assert.equal(checkWireThruText(model).conform, false);
});

test('T-NOTHRU-TEXT[负·正确侧]:标签向外展、线端点在锚不入内部 → ✓', () => {
	const model = { components: [], wires: [{ net: 'SIG', line: [0, 100, 100, 100] }], netflags: [
		{ kind: 'sig', net: 'SIG', x: 100, y: 100, textX: 100, textY: 100, bbox: { minX: 100, minY: 97, maxX: 200, maxY: 103 } },
	] };
	assert.equal(checkWireThruText(model).conform, true, '正确侧标签向外展,自桩不穿内部');
});

test('T-NOTHRU-TEXT:自身连接线同样不得穿过器件标注', () => {
	const model = { components: [
		{ designator: 'R1', bbox: { minX: 90, minY: 95, maxX: 110, maxY: 105 }, pins: [{ num: '1', x: 0, y: 100 }],
			attrs: [{ key: 'Name', value: '10k', valueVisible: true, bbox: { minX: 50, minY: 97, maxX: 150, maxY: 103 } }] },
	], wires: [{ net: 'A', line: [0, 100, 200, 100] }], netflags: [] };
	assert.equal(checkWireThruText(model).conform, false, '自身连接线穿标注也是可见缺陷');
});

test('T-DENSITY:间距太散(中位>50)→不符合', () => {
	const mk = x => ({ x, y: 0, bbox: { minX: x, minY: 0, maxX: x + 2, maxY: 2 }, pins: [] });
	const sparse = checkDensity({ components: [mk(0), mk(200), mk(400)] });
	assert.equal(sparse.token, 'T-DENSITY');
	assert.equal(sparse.conform, false);
	const dense = checkDensity({ components: [mk(0), mk(40), mk(80)] });
	assert.equal(dense.conform, true);
});

test('T-ANNOT-PLACE:2脚件标号/值位置有效但坐标缺失 → 无异常', () => {
	const noCoords = {
		components: [{
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
			pins: [{ x: 0, y: 5 }, { x: 10, y: 5 }],
			attrs: [
				{ key: 'Designator', valueVisible: true }
			]
		}]
	};
	const r = checkAnnotPlace(noCoords);
	assert.equal(r.token, 'T-ANNOT-PLACE');
	// 无坐标的标注被过滤,total=0 → outsidePct=100 → conform=true
	assert.equal(r.conform, true);
});

test('T-ANNOT-FULL: bound value requires both a human value and visible rendering', () => {
	const make = (value, bbox) => ({ components: [{ designator: 'R1', attrs: [
		{ key: 'Designator', value: 'R1', valueVisible: true, bbox: { minX: 0, minY: -10, maxX: 12, maxY: -2 } },
		{ key: 'Value', value, valueVisible: false },
		{ key: 'Name', value: '={Value}', valueVisible: true, bbox },
	] }] });
	const visible = { minX: 0, minY: 0, maxX: 25, maxY: 8 };
	assert.equal(checkAnnotFull(make('10kΩ', visible)).conform, true);
	assert.equal(checkAnnotFull(make('', visible)).conform, false);
	assert.equal(checkAnnotFull(make('10kΩ')).conform, false);
	assert.equal(checkAnnotFull(make('10kΩ', { minX: 0, minY: 0, maxX: 0, maxY: 0 })).conform, false);
});

test('T-NOOVERLAP 报告包含可直接定位的对象对', () => {
	const model = { components: [
		{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, pins: [] },
		{ designator: 'B', bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 }, pins: [] },
	], wires: [], netflags: [] };
	const r = checkNoOverlap(model);
	assert.equal(r.conform, false);
	assert.match(r.deviations[0].examples[0], /A x B/);
});

test('T-NOOVERLAP exposes stable object ids and boxes for deterministic repair',()=>{
	const model={components:[],texts:[],wires:[],netflags:[
		{id:'f1',net:'A',bbox:{minX:0,minY:0,maxX:10,maxY:10}},
		{id:'f2',net:'B',bbox:{minX:5,minY:5,maxX:15,maxY:15}},
	]};
	const d=checkNoOverlap(model).deviations[0];
	assert.equal(d.pairs[0].a.id,'f1');
	assert.equal(d.pairs[0].b.id,'f2');
	assert.deepEqual(d.pairs[0].a.bbox,{minX:0,minY:0,maxX:10,maxY:10});
});

test('T-PAGE 抓到进入图框边带的可见器件标注', () => {
	const model={components:[{designator:'C1',bbox:{minX:100,minY:100,maxX:120,maxY:120},pins:[],attrs:[
		{key:'Designator',valueVisible:true,bbox:{minX:100,minY:185,maxX:115,maxY:193}},
	]}],wires:[],netflags:[]};
	const r=checkPage(model,{sheetBounds:{minX:0,minY:0,maxX:200,maxY:200},titleBlockKeepout:{minX:140,minY:0,maxX:200,maxY:40},requireEvidence:true});
	assert.equal(r.conform,false);
	assert.ok(r.deviations.some(d=>d.kind==='outside-sheet'&&d.id==='C1.Designator'));
});

test('T-PAGE live acceptance requires explicit sheet and title-block evidence', () => {
	assert.equal(checkPage({components:[]},{requireEvidence:true}).conform,false);
});

test('T-ADJACENCY 把端点落在主干内部的 T 分支识别为直接连接', () => {
	const cap={designator:'C1',value:'100nF',bbox:{minX:17,minY:4,maxX:23,maxY:10},pins:[{num:'1',x:20,y:10},{num:'2',x:20,y:0}]};
	const model={components:[mkU1(),cap],wires:[
		{line:[0,20,40,20],net:'VCC'},
		{line:[20,10,20,20],net:''},
	],netflags:[]};
	assert.equal(checkAdjacency(model,{nets:adjNets}).conform,true);
});

test('T-ADJACENCY 接受电容—串联电感—芯片的短直连 LC 链',()=>{
	const u={designator:'U1',bbox:{minX:0,minY:0,maxX:40,maxY:40},pins:[{num:'1',x:40,y:20},{num:'2',x:0,y:10},{num:'3',x:0,y:20}]};
	const l={designator:'L1',value:'4.7uH',bbox:{minX:65,minY:17,maxX:75,maxY:23},pins:[{num:'1',x:60,y:20},{num:'2',x:80,y:20}]};
	const c={designator:'C1',value:'22uF',bbox:{minX:97,minY:5,maxX:103,maxY:15},pins:[{num:'1',x:100,y:20},{num:'2',x:100,y:0}]};
	const nets={U1:{'1':'SW','2':'GND','3':'VIN'},L1:{'1':'SW','2':'VOUT'},C1:{'1':'VOUT','2':'GND'}};
	const wires=[{line:[40,20,60,20],net:'SW'},{line:[80,20,120,20],net:'VOUT'},{line:[100,20,100,20],net:''}];
	assert.equal(checkAdjacency({components:[u,l,c],wires,netflags:[]},{nets}).conform,true);
});

test('T-ADJACENCY bulk capacitor uses the role-specific bulk threshold', () => {
	const nets = { U1: { '1': 'VCC', '2': 'GND', '3': 'SIG' }, C1: { '1': 'VCC', '2': 'GND' } };
	const cap = { designator: 'C1', value: '10uF', bbox: { minX: 270, minY: 15, maxX: 276, maxY: 25 }, pins: [{ num: '1', x: 273, y: 20 }, { num: '2', x: 273, y: 10 }] };
	const r = checkAdjacency({ components: [mkU1(), cap], wires: [{ line: [0, 20, 273, 20], net: 'VCC' }] }, { nets });
	assert.equal(r.conform, true, 'bulk capacitor at 273 is within bulkCap=300');
});

test('T-ADJACENCY accepts two real labelled stubs for a local feedback-divider topology', () => {
	const u = { designator:'U1', bbox:{minX:0,minY:0,maxX:40,maxY:40}, pins:[
		{num:'1',x:40,y:30},{num:'2',x:0,y:10},{num:'3',x:0,y:20},
	] };
	const r1 = { designator:'R1', bbox:{minX:120,minY:10,maxX:130,maxY:30}, pins:[
		{num:'1',x:125,y:0},{num:'2',x:125,y:40},
	] };
	const r2 = { designator:'R2', bbox:{minX:120,minY:-30,maxX:130,maxY:-10}, pins:[
		{num:'1',x:125,y:-40},{num:'2',x:125,y:0},
	] };
	const nets = { U1:{1:'CTRL',2:'GND',3:'VIN'}, R1:{1:'CTRL',2:'VOUT'}, R2:{1:'GND',2:'CTRL'} };
	const model = { components:[u,r1,r2], wires:[
		{id:'a',net:'CTRL',line:[40,30,70,30]},
		{id:'b',net:'CTRL',line:[100,0,125,0]},
	], netflags:[
		{kind:'sig',net:'CTRL',x:70,y:30}, {kind:'sig',net:'CTRL',x:100,y:0},
	] };
	const result = checkAdjacency(model,{nets});
	assert.equal(result.conform,true);
	assert.deepEqual(result.detail.labelledDividerNets,['CTRL']);
});

test('T-ADJACENCY connector termination gets interface threshold while ordinary pulls stay strict', () => {
	const connector = { designator: 'J1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 40 }, pins: [{ num: '1', x: 20, y: 20 }, { num: '2', x: 20, y: 10 }, { num: '3', x: 20, y: 30 }] };
	const resistor = { designator: 'R1', value: '5.1kΩ', bbox: { minX: 157, minY: 15, maxX: 163, maxY: 25 }, pins: [{ num: '1', x: 160, y: 20 }, { num: '2', x: 160, y: 10 }] };
	const nets = { J1: { '1': 'SENSE', '2': 'GND', '3': 'AUX' }, R1: { '1': 'SENSE', '2': 'GND' } };
	const r = checkAdjacency({ components: [connector, resistor], wires: [{ line: [20, 20, 160, 20], net: 'SENSE' }] }, { nets });
	assert.equal(r.conform, true, '140-unit interface termination is within interfaceTermination=140');
	const ordinary = checkAdjacency({ components: [mkU1(), resistor], wires: [{ line: [40, 20, 160, 20], net: 'SIG' }] },
		{ nets: { U1: { '1': 'VCC', '2': 'GND', '3': 'SIG' }, R1: { '1': 'SIG', '2': 'GND' } } });
	assert.equal(ordinary.conform, false, 'ordinary pull at 120 remains outside pull=110');
});

test('T-ADJACENCY audits R/C/L support parts and accepts a directly connected local switch as their anchor', () => {
	const model={components:[
		{designator:'SW1',name:'TACT SWITCH',bbox:{minX:0,minY:0,maxX:10,maxY:10},pins:[{num:'1',x:0,y:5},{num:'2',x:20,y:5}]},
		{designator:'R1',value:'10kΩ',bbox:{minX:25,minY:0,maxX:35,maxY:10},pins:[{num:'1',x:20,y:5},{num:'2',x:40,y:5}]},
	],wires:[{line:[20,5,40,5],net:'CTRL'}],netflags:[]};
	const nets={SW1:{1:'GND',2:'CTRL'},R1:{1:'CTRL',2:'VCC'}};
	const r=checkAdjacency(model,{nets});
	assert.equal(r.conform,true);
	assert.equal(r.detail.checked,1);
});

test('T-ADJACENCY does not classify a two-pin switch itself as a passive support part', () => {
	const model={components:[
		{designator:'U1',bbox:{minX:200,minY:0,maxX:220,maxY:20},pins:[{num:'1',x:200,y:10},{num:'2',x:220,y:10},{num:'3',x:210,y:20}]},
		{designator:'SW1',name:'SWITCH',bbox:{minX:0,minY:0,maxX:10,maxY:10},pins:[{num:'1',x:0,y:5},{num:'2',x:20,y:5}]},
	],wires:[],netflags:[]};
	const nets={U1:{1:'CTRL',2:'VCC',3:'GND'},SW1:{1:'GND',2:'CTRL'}};
	const r=checkAdjacency(model,{nets});
	assert.equal(r.conform,true);
	assert.equal(r.detail.checked,0);
});

test('T-BODY-CLEARANCE:局部器件体过近不能被整页空白掩盖', () => {
	const model = { components: [
		{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 } },
		{ designator: 'C1', bbox: { minX: 25, minY: 0, maxX: 35, maxY: 10 } },
		{ designator: 'U1', bbox: { minX: 500, minY: 500, maxX: 550, maxY: 550 } },
	] };
	const r = checkBodyClearance(model);
	assert.equal(r.conform, false);
	assert.equal(r.deviations[0].gap, 5);
});

test('T-MODULE-SPACING:模块过近、孤立和框内留白分别可判', () => {
	const region = (name, x) => ({ name, box: { minX:x-10,minY:-10,maxX:x+110,maxY:110 }, contentBox: { minX:x,minY:0,maxX:x+100,maxY:100 } });
	assert.equal(checkModuleSpacing({ components:[{},{},{},{}], moduleRegions:[] }).conform, false, '缺模块证据不得盲过');
	assert.ok(checkModuleSpacing({ moduleRegions:[region('a',0),region('b',140)] }).deviations.some(d=>d.kind==='module-gap'), '内容框仅40间距应失败');
	assert.ok(checkModuleSpacing({ moduleRegions:[region('a',0),region('b',400)] }).deviations.some(d=>d.kind==='module-isolated'), '最近模块300间距应失败');
	assert.equal(checkModuleSpacing({ moduleRegions:[region('a',0),region('b',160)] }).conform, true, '60间距且10内边距应通过');
});

test('T-CELL-SPACING:缺证据失败；相关与非相关子区块使用不同最小间隔', () => {
	const cell = (id, x, extra = {}) => ({ id, module:'module-a', box: { minX:x-10,minY:-10,maxX:x+30,maxY:30 }, contentBox: { minX:x,minY:0,maxX:x+20,maxY:20 }, ...extra });
	assert.equal(checkCellSpacing({ components:[{},{},{},{}] }).conform, false, '有足够器件却没有子区块证据必须失败');
	assert.equal(checkCellSpacing({ cellRegions:[cell('input',0),cell('output',70)] }).conform, false, '非相关内容框仅50间隔，小于60');
	assert.equal(checkCellSpacing({ cellRegions:[cell('input',0,{relatedTo:['switch']}),cell('switch',70)] }).conform, true, '直接相关内容框50间隔，大于40');
	assert.equal(checkCellSpacing({ cellRegions:[cell('input',0,{compactWith:['switch']}),cell('switch',25)] }).conform, true, '明确局部紧凑例外可以缩短间隔');
	const overlapped=checkCellSpacing({ cellRegions:[cell('input',0,{compactWith:['switch']}),cell('switch',10)] });
	assert.equal(overlapped.conform, false, 'compactWith 只能缩短间隔，不能允许功能单元内容框相互覆盖');
	assert.equal(overlapped.deviations[0].kind, 'cell-overlap');
	assert.equal(checkCellSpacing({ cellRegions:[cell('a',0,{module:'left'}),cell('b',10,{module:'right'})] }).conform, true, '不同模块由模块间距门禁负责');
	assert.equal(checkCellSpacing({ cellRegions:[{...cell('orphan',0),module:''}] }).conform, false, 'cell 必须声明所属模块');
});

test('T-CONN-MOUNT:按连接器角色和声明触点数识别机械脚并要求逐脚接地', () => {
	const connector = { designator:'CN7', attrs:[{key:'Number of Pins',value:'2P'}], pins:[
		{num:'1',name:'A'},{num:'2',name:'B'},{num:'3',name:'EH1'},{num:'4',name:'EH2'},
	] };
	assert.equal(checkConnectorMountingPins({components:[connector]},{nets:{CN7:{1:'SIG_A',2:'SIG_B',3:'GND',4:'GND'}}}).conform,true);
	const bad = checkConnectorMountingPins({components:[connector]},{nets:{CN7:{1:'SIG_A',2:'SIG_B',3:'GND',4:'NC'}}});
	assert.equal(bad.conform,false);
	assert.deepEqual(bad.deviations.map(d=>d.pin),['CN7.4']);
	assert.equal(checkConnectorMountingPins({components:[connector]}).conform,false,'存在机械脚但无权威网表必须失败');
	assert.equal(checkConnectorMountingPins({components:[connector],connectorMountExceptions:['CN7.4']},{nets:{CN7:{3:'GND',4:'NC'}}}).conform,true,'逐脚显式隔离例外可通过');
});

test('T-CONN-MOUNT:语义机械脚不依赖位号或具体连接器型号', () => {
	const connector = { designator:'J12', attrs:[], pins:[{num:'A1',name:'SHIELD'},{num:'A2',name:'VBUS'}] };
	const r = checkConnectorMountingPins({components:[connector]},{nets:{J12:{A1:'CHASSIS_GND',A2:'VBUS'}}});
	assert.equal(r.detail.candidates,1);
	assert.equal(r.conform,true);
});

test('T-PIN-SEMANTICS: live 商业审计缺连接器定义时失败', () => {
	const model={components:[{designator:'J7',pins:[{num:'1',name:'CLK',noConnected:false}]}]};
	const r=checkConnectorPinSemantics(model,{nets:{J7:{1:'BUS_CLK'}},requireEvidence:true});
	assert.equal(r.conform,false);
	assert.ok(r.deviations.some(d=>d.kind==='connector-semantic-profile-missing'));
});

test('T-PIN-SEMANTICS:逐针核对针名、网络、连接状态并要求完整覆盖', () => {
	const model={components:[{designator:'CN2',pins:[
		{num:'A1',name:'CLOCK',noConnected:false},{num:'A2',name:'RESERVED',noConnected:true},
	]}]};
	const nets={CN2:{A1:'LINK_CLK',A2:''}};
	const profile={ref:'CN2',source:'verified interface table',pins:{
		A1:{symbolNames:['CLK'],sourceSignal:'REFCLK+',nets:['LINK_CLK'],state:'connected',semantic:'reference clock'},
		A2:{symbolNames:['RESERVED'],sourceSignal:'RESERVED',nets:[''],state:'nc',semantic:'reserved'},
	}};
	const sourceText=[
		`${JSON.stringify({type:'PAD',id:'p1'})}||${JSON.stringify({num:'A1'})}|`,
		`${JSON.stringify({type:'PAD',id:'p2'})}||${JSON.stringify({num:'A2'})}|`,
	].join('\n');
	const footprintProfiles=[{ref:'CN2',expectedPadCount:2,sourceText}];
	const bad=checkConnectorPinSemantics(model,{nets,profiles:[profile],footprintProfiles,requireEvidence:true});
	assert.equal(bad.conform,false);
	assert.deepEqual(bad.deviations.map(d=>d.kind),['connector-symbol-name-mismatch']);
	profile.pins.A1.symbolNames=['CLOCK'];
	assert.equal(checkConnectorPinSemantics(model,{nets,profiles:[profile],footprintProfiles,requireEvidence:true}).conform,true);
	delete profile.pins.A2;
	assert.ok(checkConnectorPinSemantics(model,{nets,profiles:[profile],footprintProfiles,requireEvidence:true}).deviations.some(d=>d.kind==='connector-semantic-pin-uncovered'));
});

test('T-PIN-SEMANTICS:空连接器封装或缺失焊盘映射必须失败',()=>{
	const model={components:[{designator:'P8',pins:[{num:'1',name:'SIG'}]}]};
	const profiles=[{ref:'P8',source:'table',pins:{1:{symbolNames:['SIG'],sourceSignal:'TXp0',nets:['LINK_P'],state:'connected'}}}];
	const r=checkConnectorPinSemantics(model,{nets:{P8:{1:'LINK_P'}},profiles,footprintProfiles:[{ref:'P8',expectedPadCount:1,sourceText:''}],requireEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-pads-missing'));
});

test('T-PIN-SEMANTICS:跨引脚拓扑复核覆盖连接器并拒绝意外短接',()=>{
	const model={components:[
		{designator:'J1',pins:[{num:'1',name:'DETECT_A',noConnected:false},{num:'2',name:'DETECT_B',noConnected:false}]},
		{designator:'J2',pins:[{num:'A',name:'CTRL',noConnected:false}]},
	]};
	const profiles=[
		{ref:'J1',source:'connector table',pins:{1:{sourceSignal:'DETECT_A',nets:['SENSE_A'],state:'connected'},2:{sourceSignal:'DETECT_B',nets:['SENSE_B'],state:'connected'}}},
		{ref:'J2',source:'connector table',pins:{A:{sourceSignal:'CTRL',nets:['CTRL'],state:'connected'}}},
	];
	const topologyProfiles=[{id:'interface-detect',refs:['J1','J2'],source:'protocol specification',status:'PASS',note:'relationships reviewed',relations:[
		{id:'detect-isolation',kind:'different-net',endpoints:[{ref:'J1',pin:'1'},{ref:'J1',pin:'2'}]},
		{id:'optional-detect-isolation',kind:'not-same-net',endpoints:[{ref:'J1',pin:'2'},{ref:'J2',pin:'A'}]},
		{id:'control-series',kind:'through-component',endpoints:[{ref:'J1',pin:'1'},{ref:'J2',pin:'A'}],via:{ref:'R7',pins:['1','2']}},
	]}];
	const nets={J1:{1:'SENSE_A',2:'SENSE_B'},J2:{A:'CTRL'},R7:{1:'SENSE_A',2:'CTRL'}};
	let r=checkConnectorPinSemantics(model,{nets,profiles,topologyProfiles,requireTopologyEvidence:true});
	assert.equal(r.conform,true);
	assert.equal(r.detail.topologyCoveredConnectors,2);
	r=checkConnectorPinSemantics(model,{nets:{...nets,J1:{1:'SENSE_A',2:'SENSE_A'}},profiles,topologyProfiles,requireTopologyEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-topology-unexpected-short'&&d.id==='detect-isolation'));
	const optional={...nets,J2:{A:''}};
	assert.equal(checkConnectorPinSemantics(model,{nets:optional,profiles,topologyProfiles,requireTopologyEvidence:true}).deviations.some(d=>d.id==='optional-detect-isolation'),false,'not-same-net 允许一端按逐脚合同声明为 NC');
});

test('T-PIN-SEMANTICS:live 模式缺跨引脚拓扑复核时逐连接器失败关闭',()=>{
	const model={components:[{designator:'P4',pins:[{num:'1',name:'SIG',noConnected:false}]}]};
	const profiles=[{ref:'P4',source:'table',pins:{1:{sourceSignal:'SIG',nets:['N'],state:'connected'}}}];
	const r=checkConnectorPinSemantics(model,{nets:{P4:{1:'N'}},profiles,requireTopologyEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-topology-profile-missing'&&d.designator==='P4'));
});

test('T-PIN-SEMANTICS:证据声明的连接器若从候选模型消失也必须失败',()=>{
	const profiles=[{ref:'J9',source:'table',pins:{1:{sourceSignal:'SIG',nets:['N'],state:'connected'}}}];
	const topologyProfiles=[{id:'review',refs:['J9'],source:'spec',status:'PASS',note:'reviewed',relations:[]}];
	const r=checkConnectorPinSemantics({components:[]},{nets:{},profiles,topologyProfiles,requireEvidence:true,requireTopologyEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-semantic-component-missing'&&d.designator==='J9'));
	assert.ok(r.deviations.some(d=>d.kind==='connector-topology-component-missing'&&d.designator==='J9'));
});

test('T-PIN-SEMANTICS:封装证据必须绑定当前器件且源 UUID 一致，重复焊盘需定向声明',()=>{
	const model={components:[{designator:'J9',attrs:[{key:'Footprint',value:'fp-live'}],pins:[{num:'1',name:'SIG'}]}]};
	const profiles=[{ref:'J9',source:'table',pins:{1:{sourceSignal:'SIG',nets:['N'],state:'connected'}}}];
	const row=(type,atom,id)=>`${JSON.stringify({type,...(id?{id}:{})})}||${JSON.stringify(atom)}|`;
	const sourceText=[row('DOCHEAD',{docType:'FOOTPRINT',uuid:'fp-other'}),row('PAD',{num:'1'},'p1'),row('PAD',{num:'1'},'p2')].join('\n');
	const footprint={ref:'J9',footprintUuid:'fp-live',expectedPadCount:2,sourceText};
	let r=checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-source-uuid-mismatch'));
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-pad-number-duplicate'));
	footprint.sourceText=sourceText.replace('fp-other','fp-live');footprint.allowedDuplicatePads=['1'];
	assert.equal(checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true}).conform,true);
	r=checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true,requireLiveFootprintEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-live-source-unverified'));
	assert.equal(r.deviations.some(d=>d.kind==='connector-footprint-pin-unmapped'),false,'unavailable source reports one root cause, not per-pin cascades');
	footprint.liveSourceVerified=true;
	assert.equal(checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true,requireLiveFootprintEvidence:true}).conform,true);
	footprint.libraryUuid='declared-library';footprint.liveSourceLibraryUuid='other-library';
	r=checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true,requireLiveFootprintEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-library-mismatch'));
	delete footprint.libraryUuid;delete footprint.liveSourceLibraryUuid;
	model.components[0].attrs[0].value='fp-stale';
	r=checkConnectorPinSemantics(model,{nets:{J9:{1:'N'}},profiles,footprintProfiles:[footprint],requireEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='connector-footprint-binding-mismatch'));
});

test('T-HIGHSPEED:差分网必须有完整的约束和端点合同', () => {
	const nets={J1:{1:'LINK0_P',2:'LINK0_N'},J2:{A:'LINK0_P',B:'LINK0_N'}};
	const missing=checkHighSpeedIntent({}, {nets,requireEvidence:true});
	assert.ok(missing.deviations.some(d=>d.kind==='highspeed-profile-missing'));
	const profile={source:'verified protocol table',protocol:'serial link',impedanceOhm:90,maxIntraPairSkewMil:5,pairs:[{
		id:'lane0',positive:'LINK0_P',negative:'LINK0_N',endpoints:{positive:[{ref:'J1',pin:'1'},{ref:'J2',pin:'A'}],negative:[{ref:'J1',pin:'2'},{ref:'J2',pin:'B'}]},
	}]};
	assert.equal(checkHighSpeedIntent({}, {nets,profiles:[profile],requireEvidence:true}).conform,true);
	profile.pairs[0].endpoints.negative=[{ref:'J1',pin:'2'}];
	assert.ok(checkHighSpeedIntent({}, {nets,profiles:[profile],requireEvidence:true}).deviations.some(d=>d.kind==='highspeed-endpoints-mismatch'));
});

test('T-HIGHSPEED:权威网表中新增的差分对不能漏出合同覆盖', () => {
	const nets={J1:{1:'BUS0_P',2:'BUS0_N',3:'BUS1_P',4:'BUS1_N'},J2:{1:'BUS0_P',2:'BUS0_N',3:'BUS1_P',4:'BUS1_N'}};
	const profile={source:'table',protocol:'link',impedanceOhm:85,maxIntraPairSkewMil:4,pairs:[{id:'p0',positive:'BUS0_P',negative:'BUS0_N',endpoints:{positive:[{ref:'J1',pin:'1'},{ref:'J2',pin:'1'}],negative:[{ref:'J1',pin:'2'},{ref:'J2',pin:'2'}]}}]};
	const r=checkHighSpeedIntent({}, {nets,profiles:[profile],requireEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='highspeed-pair-uncovered'&&d.positive==='BUS1_P'));
});

test('T-PASSIVE:每个 R/C 都需要逐项电气依据和当前绑定封装源',()=>{
	const rec=(type,id,atom)=>`${JSON.stringify({type,id})}||${JSON.stringify(atom)}|`;
	const fp=[rec('PAD','p1',{layerId:1,num:'1',centerX:-28,centerY:0,defaultPad:{width:31.5,height:35.4},hole:null}),rec('PAD','p2',{layerId:1,num:'2',centerX:28,centerY:0,defaultPad:{width:31.5,height:35.4},hole:null})].join('\n');
	const model={components:[{designator:'R1',attrs:[{key:'Footprint',value:'fp'}]}]};
	let r=checkPassiveFootprints(model,{profiles:[],footprintSources:[],requireEvidence:true,requireLiveFootprintEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='passive-electrical-profile-missing'));
	r=checkPassiveFootprints(model,{profiles:[{ref:'R1',status:'PASS',source:'datasheet',note:'stress checked'}],footprintSources:[{footprintUuid:'fp',verified:true,sourceText:fp}],requireEvidence:true,requireLiveFootprintEvidence:true});
	assert.equal(r.conform,true);
	assert.equal(r.detail.checked,1);
	r=checkPassiveFootprints(model,{profiles:[{ref:'R1',status:'PASS',source:'datasheet',note:'stress checked'}],footprintSources:[{footprintUuid:'fp',verified:false}],requireEvidence:true,requireLiveFootprintEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='passive-footprint-live-source-unverified'));
});

test('T-HIGHSPEED:差分端点必须与连接器来源信号及极性一致',()=>{
	const nets={J1:{1:'LINK_P',2:'LINK_N'},J2:{1:'LINK_P',2:'LINK_N'}};
	const connectorProfiles=[
		{ref:'J1',pins:{1:{sourceSignal:'GND'},2:{sourceSignal:'RXn0'}}},
		{ref:'J2',pins:{1:{sourceSignal:'TXp0'},2:{sourceSignal:'TXn0'}}},
	];
	const profiles=[{source:'table',protocol:'serial',impedanceOhm:85,maxIntraPairSkewMil:5,pairs:[{
		id:'lane0',positive:'LINK_P',negative:'LINK_N',endpoints:{positive:[{ref:'J1',pin:'1'},{ref:'J2',pin:'1'}],negative:[{ref:'J1',pin:'2'},{ref:'J2',pin:'2'}]},
	}]}];
	const r=checkHighSpeedIntent({}, {nets,profiles,connectorProfiles,requireEvidence:true});
	assert.ok(r.deviations.some(d=>d.kind==='highspeed-endpoint-source-polarity-mismatch'&&d.endpoint==='J1.1'));
});

test('T-CONN-MOUNT:网络符号直接压在机械脚端点仍失败，必须有可读短支线', () => {
	const connector={designator:'P3',attrs:[{key:'Number of Pins',value:'1P'}],pins:[{num:'1',x:0,y:0},{num:'2',x:10,y:0}]};
	const r=checkConnectorMountingPins({components:[connector],netflags:[{id:'ground-flag',net:'GND',x:10,y:0}]},{nets:{P3:{1:'SIG',2:'GND'}}});
	assert.equal(r.conform,false);
	assert.ok(r.deviations.some(d=>d.kind==='connector-mount-flag-direct-pin-overlap'&&d.pin==='P3.2'));
});

test('T-CONN-MOUNT:同侧机械脚必须汇到一条母线和一个向下地符号',()=>{
	const c={id:'c',designator:'P4',bbox:{minX:0,minY:0,maxX:40,maxY:60},attrs:[{key:'Number of Pins',value:'1P'}],pins:[
		{num:'1',name:'SIG',x:0,y:10,rot:180},{num:'2',name:'SHIELD',x:40,y:20,rot:0},{num:'3',name:'SHIELD',x:40,y:40,rot:0},
	]};
	const nets={P4:{1:'SIG',2:'GND',3:'GND'}};
	const split={components:[c],wires:[{line:[40,20,55,20],net:'GND'},{line:[40,40,55,40],net:'GND'}],netflags:[
		{id:'g1',net:'GND',x:55,y:20,rotation:0},{id:'g2',net:'GND',x:55,y:40,rotation:0},
	]};
	assert.ok(checkConnectorMountingPins(split,{nets}).deviations.some(d=>d.kind==='connector-mount-ground-not-shared'));
	const shared={components:[c],wires:[
		{line:[40,20,55,20],net:''},{line:[40,40,55,40],net:''},{line:[55,40,55,0],net:''},
	],netflags:[{id:'g',net:'GND',x:55,y:0,rotation:0}]};
	assert.equal(checkConnectorMountingPins(shared,{nets}).conform,true);
	const upsideDown={...shared,wires:[
		{line:[40,20,55,20],net:''},{line:[40,40,55,40],net:''},{line:[55,20,55,60],net:''},
	],netflags:[{id:'g',net:'GND',x:55,y:60,rotation:180}]};
	assert.ok(checkConnectorMountingPins(upsideDown,{nets}).deviations.some(d=>d.kind==='connector-mount-ground-not-downward'));
});

test('T-FLAG-ALIGN:普通 NET 标签不得冒充 GND 符号，同时仍输出同侧分组证据',()=>{
	const model={components:[{
		designator:'P1',bbox:{minX:0,minY:0,maxX:40,maxY:50},pins:[
			{num:'1',x:40,y:10},{num:'2',x:40,y:20},{num:'3',x:40,y:30},{num:'4',x:40,y:40},
		],
	}],wires:[
		{line:[40,10,60,10],net:'GND'},{line:[40,20,60,20],net:'GND'},
		{line:[40,30,80,30],net:'SIG_A'},{line:[40,40,80,40],net:'SIG_B'},
	],netflags:[
		{kind:'sig',net:'GND',x:60,y:10},{kind:'sig',net:'GND',x:60,y:20},
		{kind:'sig',net:'SIG_A',x:80,y:30},{kind:'sig',net:'SIG_B',x:80,y:40},
	]};
	const r=checkFlagAlign(model);
	assert.equal(r.conform,false,JSON.stringify(r.deviations));
	assert.equal(r.deviations.filter(d=>d.kind==='power-or-ground-uses-signal-label').length,2);
	assert.deepEqual(r.detail.checked.map(x=>[x.symbolClass,x.axis,x.spread]),[
		['ground','x',0],['sig','x',0],
	]);
});

test('T-FLAG-ALIGN:带电压后缀的 Power Good/Enable 名称仍是普通控制信号',()=>{
	const model={components:[{designator:'U1',bbox:{minX:0,minY:0,maxX:20,maxY:20},pins:[
		{num:'1',x:20,y:5},{num:'2',x:20,y:15},
	]}],wires:[{line:[20,5,40,5],net:'PG_3V3'},{line:[20,15,40,15],net:'EN_5V'}],netflags:[
		{kind:'sig',net:'PG_3V3',x:40,y:5},{kind:'sig',net:'EN_5V',x:40,y:15},
	]};
	assert.equal(checkFlagAlign(model).conform,true);
});

test('T-ANNOT-FULL:全部装配器件须显示位号和值/型号；无源件须为人读数值', () => {
	const box = { minX: 0, minY: 0, maxX: 20, maxY: 8 };
	const human = { designator: 'R1', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'R1', bbox: box }, { key: 'Name', valueVisible: true, value: '10k', bbox: box }] };
	const humanC = { designator: 'C1', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'C1', bbox: box }, { key: 'Name', valueVisible: true, value: '100nF', bbox: box }] };
	assert.equal(checkAnnotFull({ components: [human, humanC] }).conform, true, '人读值 10k/100nF → 符合');
	/* formula ={Value}(渲染空白)= 假过 → 必须报不符合 */
	const formula = { designator: 'R2', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'R2', bbox: box }, { key: 'Name', valueVisible: true, value: '={Value}', bbox: box }] };
	assert.equal(checkAnnotFull({ components: [formula] }).conform, false, 'formula ={Value} 不是人读值');
	/* 厂商料号(长串)= 不是人读值 → 不符合 */
	const partno = { designator: 'C2', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'C2', bbox: box }, { key: 'Name', valueVisible: true, value: 'CC0603KRX7R9BB104', bbox: box }] };
	assert.equal(checkAnnotFull({ components: [partno] }).conform, false, '料号不是人读值');
	/* 缺值 → 不符合；连接器也须显示型号 */
	const bare = { designator: 'R3', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'R3', bbox: box }] };
	assert.equal(checkAnnotFull({ components: [bare] }).conform, false, '缺人读值');
	const connector = { designator: 'J1', pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'J1', bbox: box }, { key: 'Name', valueVisible: true, value: 'CONN', bbox: box }] };
	assert.equal(checkAnnotFull({ components: [connector] }).conform, true, '连接器型号可见才通过');
	assert.equal(checkAnnotFull({ components: [{ ...connector, attrs: connector.attrs.slice(0, 1) }] }).conform, false, '连接器缺型号必须失败');
});

test('T-ANNOT-PLACE:标号阻值同侧(都在件上方)→符合', () => {
	// 横放2脚件,body y∈[-2,2],脚在 x=±10;标号/阻值都在上方(y=10,12)同侧
	const c = { pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }], bbox: { minX: -8, minY: -2, maxX: 8, maxY: 2 },
		attrs: [{ key: 'Designator', valueVisible: true, x: -2, y: 12 }, { key: 'Name', valueVisible: true, x: -2, y: 10 }] };
	const r = checkAnnotPlace({ components: [c] });
	assert.equal(r.detail.sameSidePct, 100);
	assert.equal(r.conform, true);
});

test('T-ANNOT-PLACE:标号阻值异侧(一上一下)→不符合', () => {
	const c = { pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }], bbox: { minX: -8, minY: -2, maxX: 8, maxY: 2 },
		attrs: [{ key: 'Designator', valueVisible: true, x: -2, y: 12 }, { key: 'Name', valueVisible: true, x: -2, y: -12 }] };
	const r = checkAnnotPlace({ components: [c] });
	assert.equal(r.detail.sameSidePct, 0);
	assert.equal(r.conform, false);
});

test('T-DRC:全0→符合;缺/非数→不符合(fail-closed)', () => {
	assert.equal(checkDrc({ error: 0, warn: 0, info: 0 }).conform, true);
	assert.equal(checkDrc({ error: 0, warn: 1, info: 0 }).conform, false);
	assert.equal(checkDrc({}).conform, false);
});

test('T-LABEL-ALIGN:同侧扇出共列 x → 符合', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 100, textY: 20, alignMode: 6 },
		{ kind: 'sig', net: 'C', textX: 100, textY: 40, alignMode: 6 },
	] };
	assert.equal(checkLabelAlign(m).conform, true);
});

test('T-LABEL-ALIGN:同侧一列内 x 渐漂(跨度>xTol)→ 不符合(column-x-spread)', () => {
	/* 相邻间隔均 ≤xTol 但整列跨度 > xTol = 列没真对齐(渐漂),应判不符合 */
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 104, textY: 20, alignMode: 6 },
		{ kind: 'sig', net: 'C', textX: 108, textY: 40, alignMode: 6 },
	] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, false);
	assert.ok(r.deviations.some(d => d.kind === 'column-x-spread'));
});

test('T-LABEL-ALIGN:小模块单侧单标签(孤立但干净)→ 不因此判不符合', () => {
	/* 多列推广后,单标签列无可对齐对象,不应被判不符合(防散由生成器按构造保证) */
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 500, textY: 0, alignMode: 8 },
	] };
	assert.equal(checkLabelAlign(m).conform, true);
});

test('T-LABEL-ALIGN:多模块两条合法列(各≥2、列内共x、行距够)→ 符合', () => {
	const m = { netflags: [
		/* 模块A 右列 x=100 */
		{ kind: 'sig', net: 'A1', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'A2', textX: 100, textY: 20, alignMode: 6 },
		/* 模块B 右列 x=500(另一列) */
		{ kind: 'sig', net: 'B1', textX: 500, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B2', textX: 500, textY: 20, alignMode: 6 },
	] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, true, '两条各自对齐的列应符合(多模块)');
});

test('T-LABEL-ALIGN:行距过密(糊成一团)→ 不符合(DR16)', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 100, textY: 3, alignMode: 6 },
	] };
	assert.ok(checkLabelAlign(m).deviations.some(d => d.kind === 'row-pitch-merged'));
});

/* Fix5:alignMode 既非 6 也非 8 → bad-alignmode 偏差 + conform===false */
test('T-LABEL-ALIGN:alignMode 非 6/8 (e.g. 2) → bad-alignmode 偏差且不符合', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'CLK', textX: 0, textY: 0, alignMode: 2 },
	] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, false, 'alignMode=2 应使 conform=false');
	assert.ok(r.deviations.some(d => d.kind === 'bad-alignmode'), '应有 bad-alignmode 偏差');
});

/* ③ per-side 锚点:信号标签 *_MIDDLE(线穿文字中线)报违规;*_BOTTOM/*_TOP 合规。 */
test('T-LABEL-ALIGN:live 标签 align=LEFT_MIDDLE → anchor-middle 违规', () => {
	const m = { netflags: [{ kind: 'sig', net: 'SIGNAL_A', textX: 0, textY: 0, alignMode: 8, align: 'LEFT_MIDDLE' }] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, false, '*_MIDDLE 信号标签必须报违规');
	assert.ok(r.deviations.some(d => d.kind === 'anchor-middle' && d.net === 'SIGNAL_A'), JSON.stringify(r.deviations));
});

test('T-LABEL-ALIGN[③]:model anchor=RIGHT_MIDDLE 也报;LEFT_BOTTOM 合规', () => {
	assert.ok(checkLabelAlign({ netflags: [{ kind: 'sig', net: 'A', textX: 0, textY: 0, alignMode: 6, anchor: 'RIGHT_MIDDLE' }] }).deviations.some(d => d.kind === 'anchor-middle'));
	const ok = checkLabelAlign({ netflags: [{ kind: 'sig', net: 'B', textX: 0, textY: 0, alignMode: 8, align: 'LEFT_BOTTOM' }] });
	assert.ok(!ok.deviations.some(d => d.kind === 'anchor-middle'), 'LEFT_BOTTOM 不应报 anchor-middle');
});

test('T-LABEL-ALIGN[③ 负]:无 align/anchor 信息 → 不臆判 anchor-middle', () => {
	const r = checkLabelAlign({ netflags: [{ kind: 'sig', net: 'C', textX: 0, textY: 0, alignMode: 8 }] });
	assert.ok(!r.deviations.some(d => d.kind === 'anchor-middle'), '无锚信息不应臆判');
});

test('T-LABEL-ALIGN:horizontal endpoint text rotated 90 degrees is rejected',()=>{
	const r=checkLabelAlign({netflags:[{kind:'sig',net:'A',textX:0,textY:0,alignMode:6,align:'LEFT_BOTTOM',rotation:90}]});
	assert.ok(r.deviations.some(d=>d.kind==='label-not-horizontal'));
});

test('T-FLAG-ORIENT:non-ground power symbols require a visible net name',()=>{
	const model=mkCapFlags(132,68);
	model.netflags[0].nameVisible=false;
	const r=checkFlagOrient(model);
	assert.ok(r.deviations.some(d=>d.kind==='power-flag-name-hidden'));
});

test('T-FLAG-ORIENT:visible power names must remain horizontal',()=>{
	const model=mkCapFlags(132,68);
	model.netflags[0].nameVisible=true;
	model.netflags[0].nameRotation=90;
	assert.ok(checkFlagOrient(model).deviations.some(d=>d.kind==='power-flag-name-not-horizontal'));
});

test('T-FLAG-ORIENT:upward power symbol rejects a net name rendered below its anchor',()=>{
	const model=mkCapFlags(132,68);
	model.netflags[0].nameVisible=true;
	model.netflags[0].rotation=0;
	model.netflags[0].nameBox={minX:90,minY:124,maxX:110,maxY:132};
	assert.ok(checkFlagOrient(model).deviations.some(d=>d.kind==='power-flag-name-not-outward'));
});

test('T-FLAG-ORIENT:side-facing power name must be vertically centered on its stub',()=>{
	const bad={components:[],wires:[],netflags:[{id:'p',kind:'power',net:'+V',x:100,y:50,rotation:270,
		nameVisible:true,nameRotation:0,bbox:{minX:104,minY:44,maxX:111,maxY:56},nameBox:{minX:115,minY:50,maxX:130,maxY:58}}]};
	const rb=checkFlagOrient(bad);
	assert.ok(rb.deviations.some(d=>d.kind==='power-flag-name-cross-axis-offset'&&d.offset===4));
	const good={...bad,netflags:[{...bad.netflags[0],nameBox:{minX:115,minY:46,maxX:130,maxY:54}}]};
	assert.equal(checkFlagOrient(good).conform,true);
});

test('T-LABEL-ALIGN:左侧标签按 DR11 使用 LEFT_BOTTOM/mode6 朝电路展开', () => {
	const wires = [{ line: [0, 0, 20, 0], net: 'A' }];
	const bad = checkLabelAlign({ wires, netflags: [{ kind: 'sig', net: 'A', x: 0, y: 0, textX: 0, textY: 0, alignMode: 8, align: 'RIGHT_BOTTOM' }] });
	assert.ok(bad.deviations.some(d => d.kind === 'anchor-wrong-side' && d.expect === 'LEFT_BOTTOM'));
	const good = checkLabelAlign({ wires, netflags: [{ kind: 'sig', net: 'A', x: 0, y: 0, textX: 0, textY: 0, alignMode: 6, align: 'LEFT_BOTTOM' }] });
	assert.ok(!good.deviations.some(d => d.kind === 'anchor-wrong-side'));
});

test('T-LABEL-ALIGN:右侧标签按 DR12 使用 RIGHT_BOTTOM/mode8 朝电路展开', () => {
	const wires = [{ line: [0, 0, 20, 0], net: 'A' }];
	const good = checkLabelAlign({ wires, netflags: [{ kind: 'sig', net: 'A', x: 20, y: 0, textX: 20, textY: 0, alignMode: 8, align: 'RIGHT_BOTTOM' }] });
	assert.ok(!good.deviations.some(d => d.kind === 'anchor-wrong-side'));
});

test('T-LABEL-ALIGN:完整 live 标签锚点必须是同网水平短桩自由端，禁止垂直补线', () => {
	const label = { kind: 'sig', net: 'A', x: 0, y: 15, textX: 0, textY: 15, alignMode: 6, align: 'LEFT_BOTTOM' };
	const bad = checkLabelAlign({ wires: [{ net: 'A', line: [0, 0, 0, 15] }], netflags: [label], _labelCoverage:{expected:1,actual:1} });
	assert.ok(bad.deviations.some(d => d.kind === 'label-anchor-not-free-horizontal-end'));
	const good = checkLabelAlign({ wires: [{ net: 'A', line: [0, 15, 20, 15] }], netflags: [label], _labelCoverage:{expected:1,actual:1} });
	assert.ok(!good.deviations.some(d => d.kind === 'label-anchor-not-free-horizontal-end' || d.kind === 'label-anchor-off-wire'));
});

test('T-FLAG-ALIGN:同一器件上侧的不同网络端点须共水平基线', () => {
	const component={designator:'J1',bbox:{minX:0,minY:0,maxX:20,maxY:20},pins:[{num:'1',x:5,y:20},{num:'2',x:15,y:20}]};
	const wires=[{line:[5,20,5,35],net:'SIG_A'},{line:[15,20,15,45],net:'SIG_B'}];
	const netflags=[{id:'a',kind:'sig',net:'SIG_A',x:5,y:35},{id:'b',kind:'sig',net:'SIG_B',x:15,y:45}];
	const bad=checkFlagAlign({components:[component],wires,netflags});
	assert.equal(bad.conform,false);
	assert.equal(bad.deviations[0].component,'J1');
	assert.equal(bad.deviations[0].side,'top');
	assert.equal(bad.deviations[0].spread,10);
	const aligned=checkFlagAlign({components:[component],wires:[{line:[5,20,5,35]},{line:[15,20,15,35]}],netflags:[{id:'a',kind:'sig',net:'SIG_A',x:5,y:35},{id:'b',kind:'sig',net:'SIG_B',x:15,y:35}]});
	assert.equal(aligned.conform,true);
});

test('T-FLAG-ALIGN:同侧多个地符号也必须共轴', () => {
	const component={designator:'P1',bbox:{minX:0,minY:0,maxX:20,maxY:20},pins:[{num:'1',x:5,y:20},{num:'2',x:15,y:20}]};
	const r=checkFlagAlign({components:[component],wires:[{line:[5,20,5,30]},{line:[15,20,15,40]}],netflags:[{id:'g1',net:'GND',x:5,y:30},{id:'g2',net:'AGND',x:15,y:40}]});
	assert.equal(r.conform,false);assert.equal(r.deviations[0].symbolClass,'ground');
});

test('T-FLAG-ALIGN:同网名的远端符号不会靠全局网名误并到本器件', () => {
	const component={designator:'J2',bbox:{minX:0,minY:0,maxX:20,maxY:20},pins:[{num:'1',x:5,y:20}]};
	const r=checkFlagAlign({components:[component],wires:[{line:[5,20,5,35],net:'GND'},{line:[200,100,220,100],net:'GND'}],netflags:[{id:'local',net:'GND',x:5,y:35},{id:'remote',net:'GND',x:200,y:100}]});
	assert.equal(r.conform,true);
	assert.equal(r.detail.groups,0);
});

test('T-FLAG-ALIGN:同一器件同侧即使形成两组标签列也必须收敛到一条轴', () => {
	const component={designator:'J8',bbox:{minX:0,minY:0,maxX:20,maxY:30},pins:[1,2,3,4].map((num,i)=>({num:String(num),x:0,y:5+i*5}))};
	const wires=[
		{line:[0,5,-20,5]},{line:[0,10,-20,10]},
		{line:[0,15,-40,15]},{line:[0,20,-40,20]},
	];
	const netflags=[
		{id:'a',kind:'sig',net:'A',x:-20,y:5},{id:'b',kind:'sig',net:'B',x:-20,y:10},
		{id:'c',kind:'sig',net:'C',x:-40,y:15},{id:'d',kind:'sig',net:'D',x:-40,y:20},
	];
	const r=checkFlagAlign({components:[component],wires,netflags});
	assert.equal(r.conform,false);
	assert.ok(r.deviations.some(d=>d.kind==='same-side-signal-axis-spread'&&d.spread===20));
});

test('T-FLAG-ALIGN:电源或地符号压在线段中部不算连接，必须落在线端点或引脚',()=>{
	const mid=checkFlagAlign({components:[],wires:[{line:[0,0,20,0],net:'+V'}],netflags:[{id:'p',kind:'power',net:'+V',x:10,y:0}]});
	assert.ok(mid.deviations.some(d=>d.kind==='flag-anchor-not-wire-or-pin-endpoint'));
	const split=checkFlagAlign({components:[],wires:[{line:[0,0,10,0],net:'+V'},{line:[10,0,20,0],net:'+V'}],netflags:[{id:'p',kind:'power',net:'+V',x:10,y:0}]});
	assert.equal(split.conform,true,JSON.stringify(split.deviations));
});

test('judgeTokens 闭环包含 T-FLAG-ALIGN，轴线偏差会阻止整体验收', () => {
	const model = {
		components: [{
			designator: 'J1',
			bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
			pins: [{ num: '1', x: 5, y: 20 }, { num: '2', x: 15, y: 20 }],
		}],
		wires: [{ line: [5, 20, 5, 35], net: 'SIG_A' }, { line: [15, 20, 15, 50], net: 'SIG_B' }],
		netflags: [{ id: 'a', kind: 'sig', net: 'SIG_A', x: 5, y: 35 }, { id: 'b', kind: 'sig', net: 'SIG_B', x: 15, y: 50 }],
	};
	const report = judgeTokens(model, { drc: { error: 0, warn: 0, info: 0 } });
	const axis = report.tier2.find(r => r.token === 'T-FLAG-ALIGN');
	assert.equal(axis?.conform, false);
	assert.equal(report.conform, false);
});

test('设计 token 注册表与裁判结果一一对应，缺检/重复/未知检查均 fail-closed', () => {
	const report = judgeTokens({ components: [], wires: [], netflags: [] }, { drc: { error: 0, warn: 0, info: 0 } });
	assert.deepEqual(report.coverage, {
		complete: true,
		expected: 27,
		checked: 27,
		missing: [],
		duplicate: [],
		unexpected: [],
	});
	const bad = auditTokenCoverage(
		[{ token: 'T-A' }, { token: 'T-A' }, { token: 'T-UNKNOWN' }],
		[{ id: 'T-A' }, { id: 'T-B' }],
	);
	assert.equal(bad.complete, false);
	assert.deepEqual(bad.missing, ['T-B']);
	assert.deepEqual(bad.duplicate, ['T-A']);
	assert.deepEqual(bad.unexpected, ['T-UNKNOWN']);
});

test('judgeTokens 三层结构、无合成分、DRC≠0则不符合', () => {
	const rep = judgeTokens({ components: [], wires: [] }, { drc: { error: 0, warn: 24, info: 0 } });
	assert.ok(rep.tier1 && Array.isArray(rep.tier2) && Array.isArray(rep.tier3));
	assert.equal(rep.tier1.conform, false);
	assert.equal(rep.conform, false);
	assert.equal(rep.score, undefined);
	assert.equal(rep.commercialPass, undefined);
	assert.ok(rep.tier2.find(r => r.token === 'T-ORTHO'));
});
