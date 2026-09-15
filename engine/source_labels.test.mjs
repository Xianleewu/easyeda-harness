/* source_labels 单测:从源解析 net 标签 + 真字体标定 + 富化进裁判,使标签重叠被真度量。零特定电路。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrateFont, parseNetLabels, enrichNetLabels, assertNetLabelCoverage } from './source_labels.mjs';
import { judgeTokens } from './token_conformance.mjs';

const L = (head, atom) => `${JSON.stringify(head)}||${JSON.stringify(atom)}|`;

test('calibrateFont:从组件可见 attr bbox 标定真字体(中位)', () => {
	const comps = [{
		attrs: [
			{ key: 'Designator', value: 'UX', valueVisible: true, bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 } }, /* 2 字 → 宽/字=10 */
			{ key: 'Name', value: 'ABC', valueVisible: true, bbox: { minX: 0, minY: 0, maxX: 30, maxY: 10 } },       /* 3 字 → 宽/字=10 */
		],
	}];
	const f = calibrateFont(comps);
	assert.equal(f.charW, 10);
	assert.equal(f.charH, 10);
});

test('parseNetLabels:bbox 方向按【真实 align】(END/RIGHT→左展;null/LEFT→右展)——非按几何推断', () => {
	/* align END_CENTER → 锚在右、文字向左展(左列正确朝向) */
	const left = [
		L({ type: 'ATTR', id: 'a1' }, { x: 180, y: -300, value: 'SIG', valueVisible: true, key: 'NET', parentId: 'w1', align: 'END_CENTER' }),
	].join('\n');
	const lab = parseNetLabels(left, { charW: 7, charH: 10 })[0];
	assert.equal(lab.x, 180);
	assert.equal(lab.y, 300, 'y 取反到屏幕系');
	assert.equal(lab.alignMode, 8, 'END/RIGHT→文字向左展→alignMode 8');
	assert.equal(lab.bbox.maxX, 180);
	assert.equal(lab.bbox.minX, 180 - 3 * 7, '向左展 [x-w,x]');

	/* align 缺省(null)/LEFT→ 文字【向右展】；适用于电路右侧标签。 */
	const nul = L({ type: 'ATTR', id: 'a2' }, { x: 180, y: -300, value: 'SIG', valueVisible: true, key: 'NET', parentId: 'w2' });
	const ln = parseNetLabels(nul, { charW: 7, charH: 10 })[0];
	assert.equal(ln.alignMode, 6, 'LEFT/null→文字向右展→alignMode 6');
	assert.equal(ln.bbox.minX, 180, '向右展 [x,x+w]');
	assert.equal(ln.bbox.maxX, 180 + 3 * 7);
});

test('parseNetLabels:隐藏 NET(valueVisible 假)不计入', () => {
	const src = L({ type: 'ATTR', id: 'a' }, { x: 10, y: -10, value: 'X', valueVisible: false, key: 'NET', parentId: 'w' });
	assert.equal(parseNetLabels(src).length, 0);
});

test('parseNetLabels preserves source rotation for the live alignment gate',()=>{
	const src=L({type:'ATTR',id:'a'},{x:10,y:-10,value:'X',valueVisible:true,key:'NET',parentId:'w',align:'LEFT_BOTTOM',rotation:90});
	assert.equal(parseNetLabels(src)[0].rotation,90);
});

test('parseNetLabels:EasyEDA 未命名直连线的空 NET 属性不产生可见标签', () => {
	const src = L({ type: 'ATTR', id: 'a' }, { x: 10, y: -10, value: '', valueVisible: true, key: 'NET', parentId: 'w' });
	assert.equal(parseNetLabels(src).length, 0);
});

test('enrichNetLabels + judgeTokens:两标签靠太近 → 重叠被抓 ✗(尺子诚实,不再平凡过)', () => {
	/* 两条同侧桩,列端 y 仅差 4 < 字高 10 → 标签 bbox 竖向重叠 */
	const src = [
		L({ type: 'WIRE', id: 'w1' }, { zIndex: 1 }),
		L({ type: 'LINE', id: 'l1' }, { startX: 200, startY: -300, endX: 180, endY: -300, lineGroup: 'w1' }),
		L({ type: 'ATTR', id: 'a1' }, { x: 180, y: -300, value: 'AAAA', valueVisible: true, key: 'NET', parentId: 'w1' }),
		L({ type: 'WIRE', id: 'w2' }, { zIndex: 1 }),
		L({ type: 'LINE', id: 'l2' }, { startX: 200, startY: -304, endX: 180, endY: -304, lineGroup: 'w2' }),
		L({ type: 'ATTR', id: 'a2' }, { x: 180, y: -304, value: 'BBBB', valueVisible: true, key: 'NET', parentId: 'w2' }),
	].join('\n');
	/* 用真字体(高 10)→ y 差 4 < 10 → 重叠 */
	const comps = [{ designator: 'X', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [],
		attrs: [{ key: 'Name', value: 'AB', valueVisible: true, bbox: { minX: 0, minY: 0, maxX: 14, maxY: 10 } }] }];
	const model = enrichNetLabels({ components: comps, netflags: [], wires: [] }, src);
	assert.equal(model._labelCount, 2);
	assert.equal(model._font.charH, 10);
	const rep = judgeTokens(model, {});
	const ovl = rep.tier2.find(r => r.token === 'T-NOOVERLAP');
	assert.equal(ovl.conform, false, '两标签重叠 → T-NOOVERLAP 必须 ✗');
	const la = rep.tier2.find(r => r.token === 'T-LABEL-ALIGN');
	assert.ok(la.detail.labels >= 2, 'checkLabelAlign 现在看得见标签(labels≥2)');
});

test('enrichNetLabels:无源文本 → 原样返回(不伪造)', () => {
	const m = { components: [], netflags: [{ kind: 'x' }], wires: [] };
	assert.equal(enrichNetLabels(m, '').netflags.length, 1);
});

test('assertNetLabelCoverage:完整源与富化标签数量一致才通过', () => {
	const src = [
		L({ type: 'DOC', id: 'd' }, { name: 'page' }),
		L({ type: 'ATTR', id: 'a1' }, { x: 10, y: -10, value: 'A', valueVisible: true, key: 'NET', parentId: 'w1' }),
		L({ type: 'ATTR', id: 'a2' }, { x: 20, y: -20, value: 'B', valueVisible: true, key: 'NET', parentId: 'w2' }),
	].join('\n');
	const model = enrichNetLabels({ components: [], netflags: [], wires: [] }, src);
	assert.deepEqual(assertNetLabelCoverage(model, src), { expected: 2, actual: 2 });
});

test('assertNetLabelCoverage:缺源或未富化时失败关闭', () => {
	assert.throws(() => assertNetLabelCoverage({ components: [], netflags: [] }, ''), /COVERAGE_UNKNOWN/);
	const src = L({ type: 'ATTR', id: 'a' }, { x: 10, y: -10, value: 'A', valueVisible: true, key: 'NET', parentId: 'w' });
	assert.throws(() => assertNetLabelCoverage({ components: [], netflags: [] }, src), /COVERAGE_MISMATCH/);
});
