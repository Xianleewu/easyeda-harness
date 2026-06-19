// design_conformance 单测：项目无关的设计语言合规度量（纯函数）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillEfficiency, auditConformance } from './design_conformance.mjs';

/* 两个 10x10 器件，内容框 100x100 → 面积 200/10000 = 0.02 */
test('fillEfficiency = 器件本体面积 / 内容外接框面积', () => {
	const comps = [
		{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
		{ bbox: { minX: 90, minY: 90, maxX: 100, maxY: 100 } },
	];
	const f = fillEfficiency(comps);
	assert.equal(f.partAreaSum, 200);
	assert.equal(f.contentArea, 10000);
	assert.equal(Math.round(f.ratio * 1000) / 1000, 0.02);
});

test('fillEfficiency 空输入安全', () => {
	const f = fillEfficiency([]);
	assert.equal(f.ratio, 0);
	assert.equal(f.contentArea, 0);
});

test('线穿器件/异网交叉/标签问题 → 映射到 DR 违规清单', () => {
	const snap = { components: [{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }] };
	const r = auditConformance(snap, {
		geom: { wireThruComp: [{}, {}, {}], crossings: 2, overlaps: [] },
		labels: [{ severity: 'hard' }, { severity: 'soft' }],
	});
	const ids = r.violations.map(v => v.rule);
	assert.ok(ids.includes('DR3-wire-through-component'));
	assert.ok(ids.includes('DR2-different-net-crossing'));
	assert.ok(ids.includes('DR8-label-issue'));
	const dr3 = r.violations.find(v => v.rule === 'DR3-wire-through-component');
	assert.equal(dr3.count, 3);
	assert.equal(r.verdict, 'VIOLATES');
});

test('低填充率(散落)→ 触发 compact 违规', () => {
	const snap = {
		components: [
			{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
			{ bbox: { minX: 990, minY: 990, maxX: 1000, maxY: 1000 } },
		],
	};
	const r = auditConformance(snap, { geom: { wireThruComp: [], crossings: 0, overlaps: [] }, labels: [], fillMin: 0.05 });
	const ids = r.violations.map(v => v.rule);
	assert.ok(ids.includes('DR-compact-sprawl'));
});

test('干净图 → CONFORMS', () => {
	const snap = {
		components: [
			{ bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 } },
			{ bbox: { minX: 35, minY: 0, maxX: 65, maxY: 30 } },
		],
	};
	const r = auditConformance(snap, { geom: { wireThruComp: [], crossings: 0, overlaps: [] }, labels: [], fillMin: 0.01 });
	assert.equal(r.verdict, 'CONFORMS');
	assert.equal(r.violations.length, 0);
});
