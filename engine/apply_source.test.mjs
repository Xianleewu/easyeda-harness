// apply_source 单测:buildSource 纯函数——源记录变换(移器件 y 取负 / 改 LINE 几何 / 改 Name /
// 溢出同网并组 / 未改记录保留原 raw)。守护源式 live 投递这一突破不被改动破坏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSource, parseSource } from './apply_source.mjs';

// 合成源:1 器件 c1 + 2 个 WIRE 组(w1 名 OLD、w2 名 OLD2)。
const SRC = [
	'{"type":"DOCHEAD"}||{"docType":"SCH_PAGE"}|',
	'{"type":"COMPONENT","ticket":1,"id":"c1"}||{"partId":"P1","x":0,"y":0,"rotation":0,"isMirror":false,"attrs":{},"zIndex":1}|',
	'{"type":"WIRE","ticket":2,"id":"w1"}||{"zIndex":1}|',
	'{"type":"LINE","ticket":3,"id":"l1"}||{"startX":5,"startY":-5,"endX":15,"endY":-5,"lineGroup":"w1"}|',
	'{"type":"ATTR","ticket":4,"id":"a1"}||{"key":"Name","value":"OLD","parentId":"w1"}|',
	'{"type":"WIRE","ticket":5,"id":"w2"}||{"zIndex":1}|',
	'{"type":"LINE","ticket":6,"id":"l2"}||{"startX":20,"startY":-20,"endX":30,"endY":-20,"lineGroup":"w2"}|',
	'{"type":"ATTR","ticket":7,"id":"a2"}||{"key":"Name","value":"OLD2","parentId":"w2"}|',
].join('\n');

// 模型:1 器件摆位 + 3 条合成线(GND/SIG/GND;cap=min(3,2)=2,溢出 GND 并入同网 w1)。
const r = {
	placements: [{ designator: 'U1', x: 100, y: 200, rot: 90, mirror: true }],
	model: { wires: [
		{ net: 'GND', line: [0, 0, 10, 0] },
		{ net: 'SIG', line: [40, 0, 50, 0] },
		{ net: 'GND', line: [60, 0, 70, 0] },
	] },
};
const idByDes = new Map([['U1', 'c1']]);

function build() {
	const { newSrc, delivered, synthWireCount, groupCount } = buildSource(SRC, r, idByDes);
	return { recs: parseSource(newSrc).filter(x => x.head), newSrc, delivered, synthWireCount, groupCount };
}

test('移器件:COMPONENT 设合成位(y 取负)+ rotation/mirror', () => {
	const { recs } = build();
	const c = recs.find(x => x.head.type === 'COMPONENT' && x.head.id === 'c1');
	assert.equal(c.data.x, 100);
	assert.equal(c.data.y, -200, 'y 取负');
	assert.equal(c.data.rotation, 90);
	assert.equal(c.data.isMirror, true);
});

test('改 LINE 几何:w1 的 LINE 改成合成线0 [0,0,10,0]', () => {
	const { recs } = build();
	const l1 = recs.find(x => x.head.type === 'LINE' && x.head.id === 'l1');
	assert.deepEqual([l1.data.startX, l1.data.startY, l1.data.endX, l1.data.endY], [0, 0, 10, 0]);
});

test('改 Name:w1→GND、w2→SIG', () => {
	const { recs } = build();
	const a1 = recs.find(x => x.head.id === 'a1');
	const a2 = recs.find(x => x.head.id === 'a2');
	assert.equal(a1.data.value, 'GND');
	assert.equal(a2.data.value, 'SIG');
});

test('溢出同网并组:第3条 GND 段并入 w1(不占新 WIRE)', () => {
	const { recs } = build();
	const w1Lines = recs.filter(x => x.head.type === 'LINE' && x.data.lineGroup === 'w1');
	assert.equal(w1Lines.length, 2, 'w1 应有 2 条 LINE(原 + 并入的溢出 GND)');
	assert.ok(w1Lines.some(l => l.data.startX === 60 && l.data.endX === 70), '溢出段 [60..70] 在 w1');
	// 仍只有 2 个 WIRE 组(没加顶层 WIRE)
	assert.equal(recs.filter(x => x.head.type === 'WIRE').length, 2);
});

test('未改记录保留原 raw(DOCHEAD 逐字不变)', () => {
	const { newSrc } = build();
	assert.ok(newSrc.startsWith('{"type":"DOCHEAD"}||{"docType":"SCH_PAGE"}|'), 'DOCHEAD 原样');
});

test('报告:delivered=cap=2、synthWireCount=3、groupCount=2', () => {
	const { delivered, synthWireCount, groupCount } = build();
	assert.equal(delivered, 2);
	assert.equal(synthWireCount, 3);
	assert.equal(groupCount, 2);
});

test('守卫 missingDes:器件 id 不在源中 → 列出漏匹配(防错项目投半套)', () => {
	const { missingDes } = buildSource(SRC, r, new Map([['U1', 'NOT_IN_SOURCE']]));
	assert.deepEqual(missingDes, ['U1']);
});

test('守卫 droppedOverflow:溢出线无同网组 → 显式记录(防静默断脚)', () => {
	const r2 = { placements: r.placements, model: { wires: [
		{ net: 'GND', line: [0, 0, 10, 0] },
		{ net: 'SIG', line: [40, 0, 50, 0] },
		{ net: 'UNIQUE', line: [60, 0, 70, 0] },   // 溢出且无同网组 → 应记入 droppedOverflow
	] } };
	const { droppedOverflow, packed } = buildSource(SRC, r2, idByDes);
	assert.deepEqual(droppedOverflow, ['UNIQUE']);
	assert.equal(packed, 0);
});
