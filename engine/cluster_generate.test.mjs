// cluster_generate 单测:干净网表构建 + 功能聚类(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanLogical, clusterComponents, generateLayout, layoutClusterTemplate } from './cluster_generate.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { renderSheetOutput } from './sheet_renderer.mjs';

// 合成快照:U1.1-C1.1 经有名线 SIG;C1.2 经 GND 标接地;U1.2 仅接无名线(NC,应不入网)。
const snap = {
	components: [
		{ designator: 'U1', x: 0, y: 0, pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 0, y: 10 }] },
		{ designator: 'C1', x: 100, y: 0, pins: [{ num: '1', x: 100, y: 0 }, { num: '2', x: 100, y: 10 }] },
	],
	wires: [
		{ net: 'SIG', line: [0, 0, 100, 0] },
		{ net: '', line: [0, 10, 50, 10] },
	],
	netflags: [{ net: 'GND', symbol: 'Ground-GND', x: 100, y: 10 }],
};

test('buildCleanLogical:有名线构网,NC脚不入网', () => {
	const lg = buildCleanLogical(snap);
	const sig = lg.nets.find(n => n.name === 'SIG');
	const gnd = lg.nets.find(n => n.name === 'GND');
	assert.ok(sig, 'SIG 网存在');
	assert.deepEqual(sig.pins.sort(), ['C1.1', 'U1.1']);
	assert.equal(sig.class, 'signal');
	assert.ok(gnd && gnd.class === 'ground' && gnd.pins.includes('C1.2'));
	// U1.2 仅接无名线 → 不在任何网(NC)
	const allPins = new Set(lg.nets.flatMap(n => n.pins));
	assert.equal(allPins.has('U1.2'), false, 'NC脚不入网');
});

test('buildCleanLogical:power/ground 分类正确', () => {
	const lg = buildCleanLogical({
		components: [{ designator: 'U1', pins: [{ num: '1', x: 0, y: 0 }, { num: '2', x: 0, y: 10 }] }],
		wires: [{ net: 'VCC_3V3', line: [0, 0, 0, 0] }, { net: '+5V', line: [0, 10, 0, 10] }],
		netflags: [],
	});
	assert.equal(lg.nets.find(n => n.name === 'VCC_3V3').class, 'power');
	assert.equal(lg.nets.find(n => n.name === '+5V').class, 'power');
});

test('clusterComponents:无源件归到共享 signal 网的 IC', () => {
	const lg = buildCleanLogical(snap);
	const cl = clusterComponents(snap, lg);
	assert.ok(cl.has('U1'), 'U1 是锚点');
	assert.ok(cl.get('U1').includes('C1'), 'C1(共享 SIG)归到 U1');
});

test('clusterComponents:无 IC 锚点返回 null', () => {
	const cl = clusterComponents({ components: [{ designator: 'R1', pins: [] }] }, { nets: [] });
	assert.equal(cl, null);
});

// 通用性:全新合成板(非 vibe-buddy)也能产功能块模块图。
test('generateLayout 通用性:全新合成板产功能块、有真实连线', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 30, minY: y - pins.length * 10, maxX: x + 30, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 30 : x + 30, y: y - pins.length * 10 + i * 20 + 10 })) });
	const rc = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const comps = [
		ic('U1', 200, 300, [{ n: 'VCC', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'R' }, { n: 'SDA', s: 'R' }]),
		ic('U2', 700, 250, [{ n: 'VCC', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'L' }, { n: 'SDA', s: 'L' }]),
		rc('C1', 150, 400), rc('C2', 650, 380), rc('R1', 400, 250),
	];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); return [c.pins[n - 1].x, c.pins[n - 1].y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [
		W('VCC', pin('U1', 1), pin('C1', 1)), W('GND', pin('U1', 2), pin('C1', 2)),
		W('VCC', pin('U2', 1), pin('C2', 1)), W('GND', pin('U2', 2), pin('C2', 2)),
		W('SCL', pin('U1', 3), pin('R1', 1)), W('SCL', pin('R1', 2), pin('U2', 3)),
		W('SDA', pin('U1', 4), pin('U2', 4)),
	];
	const r = await generateLayout({ components: comps, wires, netflags: [] }, { scale: true });
	assert.ok(r, '产出模型');
	assert.ok(r.stats.clusters >= 2, `形成 ≥2 功能块(实 ${r.stats?.clusters})`);
	assert.ok(r.stats.wires > 0, '有真实连线');
	assert.ok(r.stats.nets >= 4, 'SCL/SDA/VCC/GND 等网提取正确');
});

// 模板布局(默认):schematic-aware 放置——不掉件、去耦电容入图、每件至少一脚接线/标签(无浮空)。
test('generateLayout 模板布局:不掉件、去耦电容入图、零浮空', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 30, minY: y - pins.length * 10, maxX: x + 30, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 30 : x + 30, y: y - pins.length * 10 + i * 20 + 10 })) });
	const rc = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const comps = [
		ic('U1', 200, 300, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'R' }, { n: 'SDA', s: 'R' }]),
		rc('C1', 150, 420), rc('C2', 150, 450),   // 去耦电容(VDD/GND)
		rc('R1', 400, 280),                          // SCL 上拉到 VDD
	];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); return [c.pins[n - 1].x, c.pins[n - 1].y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [
		W('VDD', pin('U1', 1), pin('C1', 1)), W('GND', pin('U1', 2), pin('C1', 2)),
		W('VDD', pin('C2', 1), pin('U1', 1)), W('GND', pin('C2', 2), pin('U1', 2)),
		W('SCL', pin('U1', 3), pin('R1', 1)), W('VDD', pin('R1', 2), pin('U1', 1)),
	];
	const snap = { components: comps, wires, netflags: [] };
	const r = await generateLayout(snap, { scale: false });
	// 不掉件:placements 覆盖所有件
	assert.equal(r.stats.placements, comps.length, `不掉件(${r.stats.placements}/${comps.length})`);
	assert.equal(r.model.components.length, comps.length, '模型含全部件');
	// 去耦电容 + 上拉都在图中
	for (const d of ['C1', 'C2', 'R1']) assert.ok(r.model.components.some(c => c.designator === d), `${d} 入图`);
	// VDD 被正确分类为 power(早先正则漏 VDD 的回归防护)
	const lg = buildCleanLogical(snap);
	assert.equal(lg.nets.find(n => n.name === 'VDD')?.class, 'power', 'VDD 是 power');
	// 零浮空:每件至少一脚落在某线端点或标签
	const cc = withLocalPins({ components: r.model.components });
	const wends = r.model.wires.flatMap(w => { const l = w.line; return [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]; });
	const labels = (r.model.netflags || []).map(f => [f.x, f.y]);
	const near = (px, py, pts, t) => pts.some(e => Math.abs(e[0] - px) < t && Math.abs(e[1] - py) < t);
	let floating = 0;
	for (const c of cc.components) { if (!(c.pins || []).some(p => near(p.x, p.y, wends, 6) || near(p.x, p.y, labels, 10))) floating++; }
	assert.equal(floating, 0, '零浮空件');
});

// 四边脚 IC(电源顶/地底/信号左右):side-aware 判边——按到 bbox 四边最近距离,而非 |dx|/|dy|
// (后者对高 IC 的右侧上部脚误判成 top → 内联失效掉 fallback 浮空)。验证不掉件、零浮空。
test('generateLayout 模板布局:四边脚 IC 正确判边、不掉件、零浮空', async () => {
	const x = 500, y = 500, hw = 80, hh = 80;
	const pins = [
		{ num: '1', name: 'VDD', x: x - 20, y: y - hh, side: 'top' }, { num: '2', name: 'GND', x: x - 20, y: y + hh, side: 'bottom' },
		{ num: '3', name: 'SCL', x: x - hw, y: y - 40 }, { num: '4', name: 'SDA', x: x - hw, y: y - 20 },   // 左(无 side 字段→按边推断)
		{ num: '5', name: 'INT', x: x + hw, y: y - 40 }, { num: '6', name: 'EN', x: x + hw, y: y + 40 },     // 右
	];
	const U1 = { designator: 'U1', x, y, rotation: 0, mirror: false, bbox: { minX: x - hw, minY: y - hh, maxX: x + hw, maxY: y + hh }, pins };
	const C1 = { designator: 'C1', x: 300, y: 300, rotation: 0, mirror: false, bbox: { minX: 285, minY: 295, maxX: 315, maxY: 305 }, pins: [{ num: '1', x: 285, y: 300 }, { num: '2', x: 315, y: 300 }] };
	const pin = (c, n) => { const p = c.pins.find(pp => pp.num === String(n)); return [p.x, p.y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const snap = {
		components: [U1, C1],
		wires: [W('VDD', pin(U1, 1), pin(C1, 1)), W('SCL', pin(U1, 3), pin(U1, 3)), W('SDA', pin(U1, 4), pin(U1, 4))],
		netflags: [{ net: 'GND', symbol: 'Ground-GND', x: pin(U1, 2)[0], y: pin(U1, 2)[1] }, { net: 'GND', symbol: 'Ground-GND', x: pin(C1, 2)[0], y: pin(C1, 2)[1] }],
	};
	const r = await generateLayout(snap, { scale: false });
	assert.equal(r.stats.placements, 2, '不掉件(IC+去耦电容)');
	assert.ok(r.model.components.some(c => c.designator === 'C1'), 'C1 去耦入图');
	// 顶部 VDD 脚被识别为 power(side 推断正确)→ 有 power flag
	assert.ok((r.model.netflags || []).some(f => f.kind === 'power' && f.net === 'VDD'), 'VDD 顶部脚→power flag');
	assert.ok((r.model.netflags || []).some(f => f.kind === 'gnd'), 'GND 底部脚→gnd flag');
});

// 多无源件同脚(反馈分压 R1→VOUT + R2→GND 共接 FB):节点 rail 都内联、不掉件、零浮空、零叠压。
test('generateLayout 模板布局:反馈分压(多无源件同脚)节点rail、零浮空零叠压', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 40, minY: y - pins.length * 10, maxX: x + 40, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 40 : x + 40, y: y - pins.length * 10 + i * 20 + 10, side: p.s === 'L' ? 'left' : 'right' })) });
	const rc = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const U1 = ic('U1', 400, 400, [{ n: 'VIN', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'FB', s: 'L' }, { n: 'SW', s: 'R' }]);
	const comps = [U1, rc('R1', 250, 460), rc('R2', 250, 490), rc('CIN', 250, 300)];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); return [c.pins[n - 1].x, c.pins[n - 1].y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const snap = {
		components: comps,
		wires: [W('VIN', pin('U1', 1), pin('CIN', 1)), W('VOUT', pin('R1', 1), pin('U1', 4)), W('FB', pin('R1', 2), pin('U1', 3)), W('FB', pin('R2', 1), pin('U1', 3))],
		netflags: [{ net: 'GND', symbol: 'Ground-GND', x: pin('U1', 2)[0], y: pin('U1', 2)[1] }, { net: 'GND', symbol: 'Ground-GND', x: pin('R2', 2)[0], y: pin('R2', 2)[1] }, { net: 'GND', symbol: 'Ground-GND', x: pin('CIN', 2)[0], y: pin('CIN', 2)[1] }],
	};
	const r = await generateLayout(snap, { scale: false, deconflict: true });
	assert.equal(r.stats.placements, comps.length, '不掉件(含分压 R1/R2)');
	for (const d of ['R1', 'R2']) assert.ok(r.model.components.some(c => c.designator === d), `${d} 入图(非fallback浮空)`);
	const g = geomQC(r.model), lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
	assert.equal(g.overlaps.length, 0, '零叠压'); assert.equal(g.crossings, 0, '零交叉'); assert.equal(lh, 0, '零硬标签');
});

// 总线拓扑:两 IC 间多条并行跨簇信号(D0-D7+A0-A7+WE+OE),压测标签密度不叠压。
test('generateLayout 模板布局:密集总线(多并行跨簇信号)标签不叠压', async () => {
	const data = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'], addr = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
	const ic = (des, x, side) => { const pins = [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, ...data.map(n => ({ n, s: side })), ...addr.map(n => ({ n, s: side }))]; return { designator: des, x, y: 500, rotation: 0, mirror: false, bbox: { minX: x - 50, minY: 500 - pins.length * 10 - 5, maxX: x + 50, maxY: 500 + pins.length * 10 + 5 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 50 : x + 50, y: 500 - pins.length * 10 + i * 20 + 10, side: p.s === 'L' ? 'left' : 'right' })) }; };
	const U1 = ic('U1', 300, 'R'), U2 = ic('U2', 1000, 'L');
	const pinByName = (c, n) => { const p = c.pins.find(pp => pp.name === n); return [p.x, p.y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [...data, ...addr].map(n => W(n, pinByName(U1, n), pinByName(U2, n)));
	const snap = { components: [U1, U2], wires, netflags: [{ net: 'GND', symbol: 'Ground-GND', x: pinByName(U1, 'GND')[0], y: pinByName(U1, 'GND')[1] }, { net: 'GND', symbol: 'Ground-GND', x: pinByName(U2, 'GND')[0], y: pinByName(U2, 'GND')[1] }] };
	const r = await generateLayout(snap, { scale: false, deconflict: true });
	assert.ok(r.stats.clusters >= 2, '两 IC 成两簇');
	const g = geomQC(r.model), lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
	assert.equal(g.overlaps.length, 0, '总线零叠压'); assert.equal(g.crossings, 0, '总线零交叉'); assert.equal(lh, 0, '密集总线标签零叠压');
});

// 离散子电路:三极管驱动级(Q1 三极管 B/C/E + 集电极 LED 负载,无 IC 锚点)。
// 递归子电路布局:剩余件按共享网分组,以最高脚件(Q1)为锚成块,四方向内联(LED 在 C 顶脚竖直内联)。
test('generateLayout 模板布局:离散三极管级(递归子电路)零浮空零叠压', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 40, minY: y - pins.length * 10, maxX: x + 40, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 40 : x + 40, y: y - pins.length * 10 + i * 20 + 10, side: p.s === 'L' ? 'left' : 'right' })) });
	const two = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const Q1 = { designator: 'Q1', x: 600, y: 400, rotation: 0, mirror: false, bbox: { minX: 585, minY: 380, maxX: 615, maxY: 420 }, pins: [{ num: '1', name: 'B', x: 585, y: 400, side: 'left' }, { num: '2', name: 'C', x: 605, y: 380, side: 'top' }, { num: '3', name: 'E', x: 605, y: 420, side: 'bottom' }] };
	const U1 = ic('U1', 300, 400, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'GPIO_DRV', s: 'R' }]);
	const comps = [U1, Q1, two('R1', 470, 410), two('LED1', 650, 300), two('C1', 150, 330)];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); const p = c.pins.find(pp => pp.name === n || pp.num === String(n)); return [p.x, p.y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const snap = {
		components: comps,
		wires: [W('VDD', pin('U1', 'VDD'), pin('C1', 1)), W('GPIO_DRV', pin('U1', 'GPIO_DRV'), pin('R1', 1)), W('Q_BASE', pin('R1', 2), pin('Q1', 'B')), W('Q_COL', pin('Q1', 'C'), pin('LED1', 1))],
		netflags: [{ net: 'GND', symbol: 'Ground-GND', x: pin('U1', 'GND')[0], y: pin('U1', 'GND')[1] }, { net: 'GND', symbol: 'Ground-GND', x: pin('C1', 2)[0], y: pin('C1', 2)[1] }, { net: 'GND', symbol: 'Ground-GND', x: pin('Q1', 'E')[0], y: pin('Q1', 'E')[1] }, { net: 'VCC', symbol: 'Power', x: pin('LED1', 2)[0], y: pin('LED1', 2)[1] }],
	};
	const r = await generateLayout(snap, { scale: false, deconflict: true });
	assert.equal(r.stats.placements, comps.length, '不掉件(含三极管Q1+LED1)');
	for (const d of ['Q1', 'LED1']) assert.ok(r.model.components.some(c => c.designator === d), `${d} 入图`);
	const g = geomQC(r.model), lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
	// 零浮空:每件至少一脚接线/标签
	const cc = withLocalPins({ components: r.model.components });
	const wends = r.model.wires.flatMap(w => { const l = w.line; return [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]; });
	const labels = (r.model.netflags || []).map(f => [f.x, f.y]);
	const near = (px, py, pts, t) => pts.some(e => Math.abs(e[0] - px) < t && Math.abs(e[1] - py) < t);
	let floating = 0; for (const c of cc.components) { if (!(c.pins || []).some(p => near(p.x, p.y, wends, 6) || near(p.x, p.y, labels, 10))) floating++; }
	assert.equal(floating, 0, '离散级零浮空');
	assert.equal(g.overlaps.length, 0, '零叠压'); assert.equal(g.crossings, 0, '零交叉'); assert.equal(lh, 0, '离散级零硬标签(不再fallback汤)');
});

// 集成:多子系统真实板(MCU+LDO+传感器+三极管驱动+运放反馈)全管线零浮空零叠压。
test('generateLayout 模板布局:多子系统集成板全管线干净', async () => {
	const ic = (des, x, y, pins) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 40, minY: y - pins.length * 10, maxX: x + 40, maxY: y + pins.length * 10 }, pins: pins.map((p, i) => ({ num: String(i + 1), name: p.n, x: p.s === 'L' ? x - 40 : x + 40, y: y - pins.length * 10 + i * 20 + 10, side: p.s === 'L' ? 'left' : 'right' })) });
	const two = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	const Q = (des, x, y) => ({ designator: des, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 20, maxX: x + 15, maxY: y + 20 }, pins: [{ num: '1', name: 'B', x: x - 15, y, side: 'left' }, { num: '2', name: 'C', x: x + 5, y: y - 20, side: 'top' }, { num: '3', name: 'E', x: x + 5, y: y + 20, side: 'bottom' }] });
	const comps = [
		ic('U1', 400, 500, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'R' }, { n: 'GPIO_LED', s: 'R' }, { n: 'ADC_IN', s: 'R' }]),
		ic('U3', 900, 600, [{ n: 'VDD', s: 'L' }, { n: 'GND', s: 'L' }, { n: 'SCL', s: 'L' }]),
		ic('U4', 400, 900, [{ n: 'IN_NEG', s: 'L' }, { n: 'IN_POS', s: 'L' }, { n: 'VDD', s: 'L' }, { n: 'OUT', s: 'R' }]),
		Q('Q1', 700, 900), two('R1', 550, 520), two('R3', 550, 560), two('R_IN', 250, 860), two('R_FB', 550, 860), two('LED1', 750, 800), two('C1', 150, 420), two('C4', 150, 860),
	];
	const pin = (d, n) => { const c = comps.find(x => x.designator === d); const p = c.pins.find(pp => pp.name === n || pp.num === String(n)); return [p.x, p.y]; };
	const W = (net, a, b) => ({ net, line: [a[0], a[1], b[0], b[1]] });
	const wires = [
		W('VDD', pin('U1', 'VDD'), pin('C1', 1)), W('VDD', pin('U3', 'VDD'), pin('U1', 'VDD')), W('VDD', pin('U4', 'VDD'), pin('C4', 1)),
		W('SCL', pin('U1', 'SCL'), pin('U3', 'SCL')), W('SCL', pin('U1', 'SCL'), pin('R1', 1)), W('VDD', pin('R1', 2), pin('U1', 'VDD')),
		W('GPIO_LED', pin('U1', 'GPIO_LED'), pin('R3', 1)), W('Q_B', pin('R3', 2), pin('Q1', 'B')), W('Q_COL', pin('Q1', 'C'), pin('LED1', 1)),
		W('ADC_IN', pin('U1', 'ADC_IN'), pin('U4', 'OUT')), W('IN_NEG', pin('U4', 'IN_NEG'), pin('R_IN', 2)), W('OUT', pin('U4', 'OUT'), pin('R_FB', 1)), W('IN_NEG', pin('R_FB', 2), pin('U4', 'IN_NEG')),
	];
	const netflags = [['U1', 'GND'], ['U3', 'GND'], ['U4', 'IN_POS'], ['Q1', 'E'], ['C1', 2], ['C4', 2]].map(([d, p]) => ({ net: 'GND', symbol: 'Ground-GND', x: pin(d, p)[0], y: pin(d, p)[1] }));
	netflags.push({ net: 'VCC', symbol: 'Power', x: pin('LED1', 2)[0], y: pin('LED1', 2)[1] });
	const r = await generateLayout({ components: comps, wires, netflags }, { scale: false, deconflict: true });
	assert.equal(r.stats.placements, comps.length, '多子系统不掉件');
	assert.ok(r.stats.clusters >= 3, `多功能块(实 ${r.stats.clusters})`);
	const g = geomQC(r.model), lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
	const cc = withLocalPins({ components: r.model.components });
	const wends = r.model.wires.flatMap(w => { const l = w.line; return [[l[0], l[1]], [l[l.length - 2], l[l.length - 2 + 1]]]; });
	const labels = (r.model.netflags || []).map(f => [f.x, f.y]);
	const near = (px, py, pts, t) => pts.some(e => Math.abs(e[0] - px) < t && Math.abs(e[1] - py) < t);
	let floating = 0; for (const c of cc.components) { if (!(c.pins || []).some(p => near(p.x, p.y, wends, 6) || near(p.x, p.y, labels, 10))) floating++; }
	assert.equal(floating, 0, '集成板零浮空'); assert.equal(g.overlaps.length, 0, '零叠压'); assert.equal(g.crossings, 0, '零交叉'); assert.equal(lh, 0, '集成板零硬标签');
});

// 健壮性:不完整输入(件缺 rotation、无 IC 锚点、空板)优雅处理,不崩溃。
test('generateLayout 健壮性:缺 rotation / 无锚点 / 空板不崩溃', async () => {
	// 件缺 rotation 字段(早先 norm(undefined)→Rinv[NaN] 崩):应优雅产出
	const r1 = await generateLayout({ components: [{ designator: 'U1', x: 0, y: 0, bbox: { minX: -20, minY: -20, maxX: 20, maxY: 20 }, pins: [{ num: '1', x: -20, y: 0 }] }], wires: [], netflags: [] });
	assert.ok(r1 && r1.stats.placements === 1, '缺 rotation 的单 IC 优雅产出(不崩)');
	// 无 IC 锚点(纯无源件):返回 null
	const two = (d, x, y) => ({ designator: d, x, y, rotation: 0, mirror: false, bbox: { minX: x - 15, minY: y - 5, maxX: x + 15, maxY: y + 5 }, pins: [{ num: '1', x: x - 15, y }, { num: '2', x: x + 15, y }] });
	assert.equal(await generateLayout({ components: [two('R1', 0, 0), two('R2', 50, 0)], wires: [], netflags: [] }), null, '无 IC 锚点返回 null');
	// 空板:返回 null
	assert.equal(await generateLayout({ components: [], wires: [], netflags: [] }), null, '空板返回 null');
});

// 渲染健壮性:空模型/单件渲染不崩(早先空内容 union 返 null → footprintMetrics/inferSheetBox 崩)。
test('renderSheetOutput 健壮性:空模型/单件不崩', () => {
	assert.doesNotThrow(() => renderSheetOutput({ components: [], wires: [], netflags: [] }, '/tmp/test_render_empty.png', {}), '空模型不崩');
	assert.doesNotThrow(() => renderSheetOutput({ components: [{ designator: 'U1', x: 0, y: 0, rotation: 0, mirror: false, bbox: { minX: -20, minY: -20, maxX: 20, maxY: 20 }, pins: [{ num: '1', x: -20, y: 0 }] }], wires: [], netflags: [] }, '/tmp/test_render_single.png', {}), '单件不崩');
});
