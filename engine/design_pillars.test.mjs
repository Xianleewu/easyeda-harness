// design_pillars 单测：六支柱设计语言审计(每维打分 1-4 + PASS/FLAG/BLOCK)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditPillars } from './design_pillars.mjs';

const packed = { components: [
	{ bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 } },
	{ bbox: { minX: 32, minY: 0, maxX: 62, maxY: 30 } },
] };
const sprawled = { components: [
	{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
	{ bbox: { minX: 990, minY: 990, maxX: 1000, maxY: 1000 } },
] };
const cleanGeom = { wireThruComp: [], crossings: 0, diagonals: 0, overlaps: [] };

function pillar(r, id) { return r.pillars.find(p => p.id === id); }

test('紧凑支柱:高填充率 → PASS/高分;严重散落 → BLOCK/低分', () => {
	const hi = auditPillars(packed, { geom: cleanGeom, labels: [] });
	const lo = auditPillars(sprawled, { geom: cleanGeom, labels: [] });
	assert.equal(pillar(hi, 'compactness').verdict, 'PASS');
	assert.ok(pillar(hi, 'compactness').score >= 3);
	assert.equal(pillar(lo, 'compactness').verdict, 'BLOCK');
	assert.equal(pillar(lo, 'compactness').score, 1);
});

test('布线支柱:干净 → PASS/4;线穿器件 → BLOCK;仅异网交叉 → FLAG', () => {
	const clean = auditPillars(packed, { geom: cleanGeom, labels: [] });
	assert.equal(pillar(clean, 'routing').verdict, 'PASS');
	assert.equal(pillar(clean, 'routing').score, 4);

	const wtc = auditPillars(packed, { geom: { wireThruComp: [{}, {}, {}], crossings: 0, diagonals: 0, overlaps: [] }, labels: [] });
	assert.equal(pillar(wtc, 'routing').verdict, 'BLOCK');
	assert.equal(pillar(wtc, 'routing').evidence.wireThroughComponent, 3);

	const cross = auditPillars(packed, { geom: { wireThruComp: [], crossings: 2, diagonals: 0, overlaps: [] }, labels: [] });
	assert.equal(pillar(cross, 'routing').verdict, 'FLAG');
});

test('标签支柱:有 hard 标签问题 → BLOCK;无 → PASS', () => {
	const bad = auditPillars(packed, { geom: cleanGeom, labels: [{ severity: 'hard' }, { severity: 'soft' }] });
	assert.equal(pillar(bad, 'labels').verdict, 'BLOCK');
	assert.equal(pillar(bad, 'labels').evidence.hardLabelIssues, 1);
	const ok = auditPillars(packed, { geom: cleanGeom, labels: [{ severity: 'soft' }] });
	assert.equal(pillar(ok, 'labels').verdict, 'PASS');
});

test('惯例支柱:存在尖头网口 → FLAG;无 → PASS', () => {
	const withPorts = { components: packed.components, netflags: [{ type: 'netport' }, { type: 'netflag' }] };
	const r = auditPillars(withPorts, { geom: cleanGeom, labels: [] });
	assert.equal(pillar(r, 'conventions').verdict, 'FLAG');
	assert.equal(pillar(r, 'conventions').evidence.netPorts, 1);
});

const posSnap = { components: [
	{ designator: 'J1', bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 } },      // 左
	{ designator: 'U1', bbox: { minX: 500, minY: 0, maxX: 540, maxY: 40 } },   // 中(控制器)
	{ designator: 'LED1', bbox: { minX: 1000, minY: 0, maxX: 1020, maxY: 20 } },// 右
	{ designator: 'R1', bbox: { minX: 510, minY: 0, maxX: 530, maxY: 20 } },    // 贴近 U1
] };
const rolesOK = {
	controller: 'U1',
	parts: [{ ref: 'J1', role: 'connector' }, { ref: 'U1', role: 'controller' }, { ref: 'LED1', role: 'indicator' }, { ref: 'R1', role: 'support' }],
	modules: [
		{ id: 'a', column: 'left', parts: ['J1'] },
		{ id: 'b', column: 'center', parts: ['U1'] },
		{ id: 'c', column: 'right', parts: ['LED1'] },
		{ id: 'd', column: 'right', parts: ['R1'] },
	],
};
const logicalOK = { nets: [{ name: 'IO', class: 'signal', pins: ['U1.5', 'R1.1'] }] };

test('结构支柱:模块按列序(左<中<右)→ PASS;违序 → 降级', () => {
	const ok = auditPillars(posSnap, { geom: cleanGeom, labels: [], roles: rolesOK, logical: logicalOK });
	assert.equal(pillar(ok, 'structure').verdict, 'PASS');

	const bad = { ...rolesOK, modules: [
		{ id: 'a', column: 'right', parts: ['J1'] },   // 连接器被判右但实际在左 → 违序
		{ id: 'b', column: 'center', parts: ['U1'] },
		{ id: 'c', column: 'left', parts: ['LED1'] },  // 指示被判左但在右 → 违序
	] };
	const r = auditPillars(posSnap, { geom: cleanGeom, labels: [], roles: bad, logical: logicalOK });
	assert.notEqual(pillar(r, 'structure').verdict, 'PASS');
});

test('支撑件支柱:支撑件贴近所服务件 → PASS;远离 → 降级', () => {
	const near = auditPillars(posSnap, { geom: cleanGeom, labels: [], roles: rolesOK, logical: logicalOK });
	assert.equal(pillar(near, 'support').verdict, 'PASS');

	const farSnap = { components: posSnap.components.map(c => c.designator === 'R1' ? { ...c, bbox: { minX: 0, minY: 900, maxX: 20, maxY: 920 } } : c) };
	const r = auditPillars(farSnap, { geom: cleanGeom, labels: [], roles: rolesOK, logical: logicalOK });
	assert.notEqual(pillar(r, 'support').verdict, 'PASS');
});

test('结构/支撑件支柱:无 role 信息 → PENDING(不打分、不阻塞)', () => {
	const r = auditPillars(packed, { geom: cleanGeom, labels: [] });
	assert.equal(pillar(r, 'structure').verdict, 'PENDING');
	assert.equal(pillar(r, 'support').verdict, 'PENDING');
	assert.equal(pillar(r, 'structure').score, null);
});

test('总判决:任一支柱 BLOCK → BLOCKED;否则 APPROVED', () => {
	const blocked = auditPillars(sprawled, { geom: cleanGeom, labels: [] }); // compactness BLOCK
	assert.equal(blocked.verdict, 'BLOCKED');
	const approved = auditPillars(packed, { geom: cleanGeom, labels: [] });
	assert.equal(approved.verdict, 'APPROVED');
});

test('总分只累计已打分支柱(PENDING 不计)', () => {
	const r = auditPillars(packed, { geom: cleanGeom, labels: [] });
	assert.equal(r.scored, 4);            // 4 个非 PENDING 支柱
	assert.equal(r.maxScore, 16);         // 4 维 * 4
	assert.ok(r.totalScore <= 16 && r.totalScore >= 4);
});
