/* source_deliver.build_source 单测:用合成 base + model 验证源式投递构造的关键不变量。零特定电路。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build_source, blockTitleAnnots } from './source_deliver.mjs';
import { classifyNet } from './structured_layout.mjs';

/* 合成 base:DOCHEAD/CANVAS/标题栏框(无 Designator)/真件(Designator+Name attr)/孤儿 NO_CONNECT/
 * 旧 WIRE+LINE+NET+Relevance(挂在旧线上,应删)。 */
const L = (head, atom) => `${JSON.stringify(head)}||${JSON.stringify(atom)}|`;
function makeBase() {
	const lines = [
		L({ type: 'DOCHEAD' }, { docType: 'SCH_PAGE' }),
		L({ type: 'CANVAS', ticket: 1, id: 'CANVAS' }, { originX: 0, originY: 0 }),
		/* 标题栏框 */
		L({ type: 'COMPONENT', ticket: 2, id: 'frame1' }, { partId: 'pidFrame', x: 0, y: 0, rotation: 0, isMirror: false, zIndex: 0 }),
		L({ type: 'ATTR', ticket: 3, id: 'a_frame' }, { x: 10, y: 20, key: 'Page Size', value: 'A4', parentId: 'frame1', zIndex: 1 }),
		/* 真件 R1 */
		L({ type: 'COMPONENT', ticket: 4, id: 'compR1' }, { partId: 'pidR', x: 100, y: -100, rotation: 0, isMirror: false, zIndex: 0 }),
		L({ type: 'ATTR', ticket: 5, id: 'a_des' }, { x: 100, y: -90, key: 'Designator', value: 'R1', valueVisible: true, parentId: 'compR1', zIndex: 2 }),
		L({ type: 'ATTR', ticket: 6, id: 'a_name' }, { x: 100, y: -80, key: 'Name', value: '10k', valueVisible: true, parentId: 'compR1', zIndex: 3 }),
		/* 孤儿 NO_CONNECT(parentId 指向某脚,非组件/线)——必须保留 */
		L({ type: 'ATTR', ticket: 7, id: 'a_nc' }, { x: 0, y: 0, key: 'NO_CONNECT', value: '1', parentId: 'pin_xyz', zIndex: 4 }),
		/* 旧线(应删) */
		L({ type: 'WIRE', ticket: 8, id: 'oldwire' }, { zIndex: 62254 }),
		L({ type: 'LINE', ticket: 9, id: 'oldline' }, { startX: 1, startY: 1, endX: 2, endY: 2, lineGroup: 'oldwire' }),
		L({ type: 'ATTR', ticket: 10, id: 'a_oldnet' }, { x: 1, y: 1, key: 'NET', value: 'OLDNET', valueVisible: true, parentId: 'oldwire', zIndex: 3 }),
		L({ type: 'ATTR', ticket: 11, id: 'a_rel' }, { x: 0, y: 0, key: 'Relevance', value: 'x', parentId: 'oldwire', zIndex: 5 }),
	];
	return lines.join('\n').replace(/\|$/, '');
}

/* model:把 R1 移到 (200,300)(屏幕系),Name 标注移到 (210,320);一条新桩 [200,300,180,300] 网名 NET_A,
 * 网标在 (180,300)。 */
const model = {
	components: [{
		designator: 'R1', x: 200, y: 300, rotation: 90, mirror: true,
		attrs: [{ key: 'Name', value: '10k', x: 210, y: 320 }],
	}],
	wires: [{ line: [200, 300, 180, 300], net: 'NET_A' }],
	netflags: [{ kind: 'sig', net: 'NET_A', textX: 180, textY: 300, x: 180, y: 300 }],
};

function parse(src) {
	return src.split('\n').map(ln => {
		const h = ln.indexOf('||');
		const head = JSON.parse(ln.slice(0, h));
		const atom = JSON.parse(ln.slice(h + 2).replace(/\|$/, ''));
		return { type: head.type, head, atom };
	});
}

test('build_source:旧线/旧NET/Relevance 全删', () => {
	const out = parse(build_source(makeBase(), model));
	assert.equal(out.filter(r => r.atom && r.atom.value === 'OLDNET').length, 0, '旧 NET 标签应删');
	assert.equal(out.filter(r => r.atom && r.atom.key === 'Relevance').length, 0, 'Relevance 应删');
	assert.equal(out.filter(r => r.head.id === 'oldwire' || r.head.id === 'oldline').length, 0, '旧 WIRE/LINE 应删');
});

test('build_source:孤儿 NO_CONNECT 必须保留(否则 tier1 回归)', () => {
	const out = parse(build_source(makeBase(), model));
	assert.equal(out.filter(r => r.atom && r.atom.key === 'NO_CONNECT').length, 1, 'NO_CONNECT 应保留');
});

test('build_source:组件改位姿,y 取反(source_y=-model_y)', () => {
	const out = parse(build_source(makeBase(), model));
	const c = out.find(r => r.head.id === 'compR1');
	assert.equal(c.atom.x, 200);
	assert.equal(c.atom.y, -300, 'y 应取反');
	assert.equal(c.atom.rotation, 90);
	assert.equal(c.atom.isMirror, true);
});

test('build_source:可见标注按 model 重定位(y 取反)', () => {
	const out = parse(build_source(makeBase(), model));
	const name = out.find(r => r.head.id === 'a_name');
	assert.equal(name.atom.x, 210);
	assert.equal(name.atom.y, -320, '标注 y 应取反');
});

test('build_source:重建 WIRE+LINE+可见 NET 标签(端点吻合 netflag → 可见)', () => {
	const out = parse(build_source(makeBase(), model));
	assert.equal(out.filter(r => r.type === 'WIRE').length, 1, '一条新 WIRE');
	const line = out.find(r => r.type === 'LINE');
	assert.equal(line.atom.startX, 200);
	assert.equal(line.atom.startY, -300, 'LINE y 取反');
	assert.equal(line.atom.endX, 180);
	const net = out.find(r => r.type === 'ATTR' && r.atom.key === 'NET' && r.atom.value === 'NET_A');
	assert.ok(net, '应有新 NET 标签');
	assert.equal(net.atom.valueVisible, true, '端点吻合 netflag → 可见');
	assert.equal(net.atom.y, -300, 'NET 标签 y 取反');
	assert.equal(net.atom.align, 'LEFT_BOTTOM', '左侧标签须按 DR11 使用左下外缘原点并朝电路展开');
});

test('build_source:功能块框 → 每块一虚线圆角 RECT(源);标题不进源(走 API,源/自定义ATTR不渲染)', () => {
	const m = { ...model, blocks: [{ title: 'BLK_X', bbox: { minX: 100, minY: 200, maxX: 300, maxY: 400 } }] };
	const out = parse(build_source(makeBase(), m));
	const rects = out.filter(r => r.type === 'RECT');
	assert.equal(rects.length, 1, '一块 → 一 RECT');
	assert.equal(out.filter(r => r.type === 'TEXT').length, 0, '不产 standalone TEXT(源 TEXT 不渲染)');
	const rc = rects[0].atom;
	assert.equal(rc.strokeStyle, 'SHORT_DASH', '虚线');
	assert.equal(rc.fillStyle, 'NONE', '透明填充');
	assert.ok(rc.radiusX > 0 && rc.radiusY > 0, '圆角');
	assert.ok(rc.dotX1 <= 100 && rc.dotX2 >= 300, '横向含块');
	assert.ok(Math.min(rc.dotY1, rc.dotY2) <= -400 && Math.max(rc.dotY1, rc.dotY2) >= -200, '纵向(源系)含块');
});

test('blockTitleAnnots:每块导出一标题(供 API create;create.y 为 y-up → 取框模型底 edge,渲染落框视觉顶)', () => {
	const m = { blocks: [{ title: 'BLK_X', bbox: { minX: 100, minY: 200, maxX: 300, maxY: 400 } }] };
	const a = blockTitleAnnots(m);
	assert.equal(a.length, 1);
	assert.equal(a[0].value, 'BLK_X');
	assert.ok(a[0].x >= 100 - 26 && a[0].x <= 100, '标题 x 在框左内侧');
	/* create.y 是 y-up:取框模型底 edge(maxY 附近)→ 渲染时翻到框视觉顶 */
	assert.ok(a[0].y > 400 - 20 && a[0].y <= 400 + 26, 'create.y 在框模型底 edge(yBot 内缩)');
	assert.ok(a[0].fontSize > 0 && a[0].bold === true);
});

test('build_source:无 model.blocks → 不产 RECT;blockTitleAnnots 空(优雅,旧路径不变)', () => {
	const out = parse(build_source(makeBase(), model));
	assert.equal(out.filter(r => r.type === 'RECT').length, 0);
	assert.equal(blockTitleAnnots(model).length, 0);
	assert.equal(blockTitleAnnots({}).length, 0);
});

/* 夹具用合成通用网名(覆盖 regex 分支),不引用任何具体电路网名 */
test('classifyNet:地/电源/信号 通用约定分类', () => {
	for (const n of ['GND', 'AGND', 'DGND', 'PGND', 'VSS', 'VEE']) assert.equal(classifyNet(n), 'ground', n);
	for (const n of ['+5V', 'VCC_A', 'VBUS_X', '3V3', 'VDD', 'VBAT', '5V_RAIL', 'VOUT1']) assert.equal(classifyNet(n), 'power', n);
	for (const n of ['DATA_P', 'CTRL_CS', 'RST_EN', 'BUS_SD', 'BOOT', 'N1']) assert.equal(classifyNet(n), 'sig', n);
});

const NF = { partId: 'pidNF', ground: { symbol: 'gSym', device: 'gDev' }, power: { symbol: 'pSym', device: 'pDev' } };
const flagModel = {
	components: [{ designator: 'R1', x: 200, y: 300, rotation: 0, mirror: false, attrs: [] }],
	wires: [
		{ line: [200, 300, 180, 300], net: 'GND' },
		{ line: [200, 320, 180, 320], net: 'VCC_A' },
		{ line: [200, 340, 180, 340], net: 'SIG_A' },
	],
	netflags: [
		{ kind: 'ground', net: 'GND', textX: 180, textY: 300, x: 180, y: 300 },
		{ kind: 'power', net: 'VCC_A', textX: 180, textY: 320, x: 180, y: 320 },
		{ kind: 'sig', net: 'SIG_A', textX: 180, textY: 340, x: 180, y: 340 },
	],
};

test('build_source(opts.netflag):power/ground → 符号 COMPONENT,sig → 文本标签', () => {
	const out = parse(build_source(makeBase(), flagModel, { netflag: NF }));
	const nfComps = out.filter(r => r.type === 'COMPONENT' && r.atom.partId === 'pidNF');
	assert.equal(nfComps.length, 2, '2 个 netflag 符号(GND+VCC_A)');
	const gnn = out.filter(r => r.type === 'ATTR' && r.atom.key === 'Global Net Name');
	assert.deepEqual(gnn.map(a => a.atom.value).sort(), ['GND', 'VCC_A']);
	/* 符号 origin = 脚位(source_y 取反):GND flag 在 (180,300) → 源 (180,-300) */
	const gComp = nfComps.find(r => out.some(a => a.atom.parentId === r.head.id && a.atom.value === 'GND'));
	assert.equal(gComp.atom.x, 180);
	assert.equal(gComp.atom.y, -300);
	assert.ok(gnn.every(a => a.atom.valueVisible === true));
	/* sig 网名 SIG_A 仍是可见文本 NET 标签,不是符号 */
	const sigNet = out.find(r => r.type === 'ATTR' && r.atom.key === 'NET' && r.atom.value === 'SIG_A');
	assert.equal(sigNet.atom.valueVisible, true);
	/* 电源地桩【不发】NET 文本(靠符号 Global Net Name 赋网名)——去冗余,防 EDA 把隐藏标签也显示 */
	const gNet = out.find(r => r.type === 'ATTR' && r.atom.key === 'NET' && r.atom.value === 'GND');
	assert.equal(gNet, undefined, 'GND 桩无 NET 文本(由符号承载)');
});

test('build_source:允许内置地符号隐藏冗余网名但保留网络绑定', () => {
	const model = { ...flagModel, netflags: flagModel.netflags.map(f => f.kind === 'ground' ? { ...f, nameVisible: false } : f) };
	const out = parse(build_source(makeBase(), model, { netflag: NF }));
	const gnd = out.find(r => r.type === 'ATTR' && r.atom.key === 'Global Net Name' && r.atom.value === 'GND');
	assert.ok(gnd);
	assert.equal(gnd.atom.valueVisible, false);
});

test('build_source:side-facing supply preserves pose and centered outward name',()=>{
	const model={components:[],wires:[{line:[100,50,130,50],net:'VCC_A'}],netflags:[{
		kind:'power',net:'VCC_A',x:100,y:50,textX:85,textY:50,rotation:90,nameSide:'left',nameVisible:true,
	}]};
	const out=parse(build_source(makeBase(),model,{netflag:NF}));
	const gnn=out.find(r=>r.type==='ATTR'&&r.atom.key==='Global Net Name'&&r.atom.value==='VCC_A');
	const comp=out.find(r=>r.type==='COMPONENT'&&r.head.id===gnn.atom.parentId);
	const symbol=out.find(r=>r.type==='ATTR'&&r.atom.parentId===comp.head.id&&r.atom.key==='Symbol');
	assert.equal(comp.atom.rotation,90);
	assert.deepEqual([gnn.atom.x,gnn.atom.y,gnn.atom.align],[85,-50,'RIGHT_MIDDLE']);
	assert.deepEqual([symbol.atom.x,symbol.atom.y],[130,-50]);
});

test('build_source:无 opts.netflag → power/ground 降级为可见文本标签(不丢)', () => {
	const out = parse(build_source(makeBase(), flagModel));
	assert.equal(out.filter(r => r.type === 'COMPONENT' && r.atom.partId === 'pidNF').length, 0, '无符号');
	const gNet = out.find(r => r.type === 'ATTR' && r.atom.key === 'NET' && r.atom.value === 'GND');
	assert.equal(gNet.atom.valueVisible, true, '降级:GND 变可见文本标签');
});

test('build_source: shared page partId does not delete ordinary components or the sheet', () => {
	const base = makeBase();
	const records = parse(base);
	const part = records.find(r => r.type === 'COMPONENT' && r.head.id !== 'frame1');
	const nf = { ...NF, partId: part.atom.partId };
	const out = parse(build_source(base, flagModel, { netflag: nf }));
	assert.ok(out.some(r => r.head.id === part.head.id));
	assert.ok(out.some(r => r.head.id === 'frame1'));
});

test('writer rejects a ground symbol on a signal even when its net name is valid', () => {
	assert.throws(() => build_source(makeBase(), { components: [], wires: [],
		netflags: [{ kind: 'ground', net: 'SIGNAL_A', x: 0, y: 0 }] }, { netflag: NF }), /role mismatch/);
	assert.doesNotThrow(() => build_source(makeBase(), { components: [], wires: [],
		netflags: [{ kind: 'power', net: 'CUSTOM_RAIL', x: 0, y: 0 }] },
		{ netflag: NF, netRoles: { CUSTOM_RAIL: 'power' } }));
});

test('build_source:框架与 DOCHEAD/CANVAS 原样保留,末行无结尾 |', () => {
	const src = build_source(makeBase(), model);
	const out = parse(src);
	assert.ok(out.find(r => r.type === 'DOCHEAD'));
	assert.ok(out.find(r => r.type === 'CANVAS'));
	assert.ok(out.find(r => r.head.id === 'frame1'), '标题栏框保留');
	assert.equal(src.split('\n').slice(0, -1).every(l => l.endsWith('|')), true, '非末行均以 | 结尾');
	assert.equal(src.endsWith('|'), false, '末行无结尾 |');
});
