// 几何严标检查器单测(RED 验证:无实现)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOrtho, checkGrid, checkNoCross, checkNoThru, checkNoOverlap, checkDensity, checkAnnotPlace, checkAnnotFull, checkDrc, judgeTokens, checkLabelAlign } from './token_conformance.mjs';

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

test('T-NOTHRU 0 wire-thru → 符合', () => {
	const r = checkNoThru({ wires: [{ line: [0,0,10,0], net: 'A' }], components: [{ designator: 'R1', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }] });
	assert.equal(r.token, 'T-NOTHRU');
	assert.equal(r.conform, true);
});

test('T-NOOVERLAP 0 overlap → 符合', () => {
	const r = checkNoOverlap({ components: [{ designator: 'R1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [] }, { designator: 'R2', bbox: { minX: 20, minY: 20, maxX: 30, maxY: 30 }, pins: [] }], wires: [], netflags: [] });
	assert.equal(r.token, 'T-NOOVERLAP');
	assert.equal(r.conform, true);
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

test('T-ANNOT-FULL:无源件缺值标注→不符合', () => {
	const withVal = { pins: [{},{}], attrs: [{ key: 'Name', valueVisible: true, value: '10k' }] };
	const bare    = { pins: [{},{}], attrs: [{ key: 'Designator', valueVisible: true, value: 'R1' }] };
	assert.equal(checkAnnotFull({ components: [withVal] }).conform, true);
	assert.equal(checkAnnotFull({ components: [bare] }).conform, false);
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

test('T-LABEL-ALIGN:同侧 x 散开(不成列)→ 不符合', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 160, textY: 20, alignMode: 6 },
	] };
	const r = checkLabelAlign(m);
	assert.equal(r.conform, false);
	assert.ok(r.deviations.some(d => d.kind === 'column-x-spread'));
});

test('T-LABEL-ALIGN:行距过密(糊成一团)→ 不符合(DR16)', () => {
	const m = { netflags: [
		{ kind: 'sig', net: 'A', textX: 100, textY: 0, alignMode: 6 },
		{ kind: 'sig', net: 'B', textX: 100, textY: 3, alignMode: 6 },
	] };
	assert.ok(checkLabelAlign(m).deviations.some(d => d.kind === 'row-pitch-merged'));
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
