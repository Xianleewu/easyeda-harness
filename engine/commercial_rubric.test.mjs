import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC, THRESHOLDS, crOrthogonality, crGridSnap, crRotation, crSpacing, crNamedRatio, crLabelToLine, crLabelPlacement, crDrc, scoreAll } from './commercial_rubric.mjs';

test('RUBRIC 含 CR-01..CR-10 且字段完整', () => {
	const ids = RUBRIC.map(r => r.id);
	for (let n = 1; n <= 10; n++) assert.ok(ids.includes(`CR-${String(n).padStart(2, '0')}`), `缺 CR-0${n}`);
	for (const r of RUBRIC) {
		assert.ok(r.dimension && r.desc, `${r.id} 缺字段`);
		assert.ok(['drc', 'geom', 'geom+image-region', 'image-region', 'image-full'].includes(r.evidence), `${r.id} evidence 非法`);
		assert.ok(['block', 'flag'].includes(r.severity), `${r.id} severity 非法`);
	}
});

test('阈值常量存在且为冻结值', () => {
	assert.equal(THRESHOLDS.GRID, 5);
	assert.equal(THRESHOLDS.ORTHO_MIN_PCT, 94);
	assert.equal(THRESHOLDS.GRID_SNAP_MIN_PCT, 95);
	assert.deepEqual(THRESHOLDS.ROT_ALLOWED, [0, 90, 180, 270]);
	assert.equal(THRESHOLDS.LABEL_TO_LINE_MED_MAX, 12);
});

test('零特定电路字面量(无具体器件/网名指纹)', () => {
	const src = RUBRIC.map(r => r.desc).join(' ');
	assert.doesNotMatch(src, /AMS1117|AO3400|ESP32|RK3576|VCC3V3_|VDD_CPU/i);
});

test('CR-02 全正交线 → 100% 通过', () => {
	const model = { wires: [{ line: [0, 0, 10, 0, 10, 10] }] }; // 1 横 1 竖
	const r = crOrthogonality(model);
	assert.equal(r.id, 'CR-02');
	assert.equal(r.seg, 2);
	assert.equal(r.orthoPct, 100);
	assert.equal(r.pass, true);
});

test('CR-02 一段 45° 计入 deg45 且不算正交', () => {
	const model = { wires: [{ line: [0, 0, 10, 10] }] }; // 斜 45
	const r = crOrthogonality(model);
	assert.equal(r.deg45, 1);
	assert.equal(r.orthoPct, 0);
	assert.equal(r.pass, false);
});

test('CR-03 全部脚落 5 栅格 → 通过', () => {
	const model = { components: [{ pins: [{ x: 0, y: 5 }, { x: 10, y: 15 }] }] };
	const r = crGridSnap(model);
	assert.equal(r.id, 'CR-03');
	assert.equal(r.snapPct, 100);
	assert.equal(r.pass, true);
});

test('CR-03 半数脱格 → 不通过', () => {
	const model = { components: [{ pins: [{ x: 3, y: 5 }, { x: 10, y: 15 }] }] };
	const r = crGridSnap(model);
	assert.equal(r.snapPct, 50);
	assert.equal(r.pass, false);
});

test('CR-04 全四正交旋转、无镜像 → 通过', () => {
	const model = { components: [{ rotation: 0, mirror: false }, { rotation: 90, mirror: false }] };
	const r = crRotation(model);
	assert.equal(r.badRot, 0);
	assert.equal(r.mirrorPct, 0);
	assert.equal(r.pass, true);
});

test('CR-04 出现 45 度旋转 → 不通过', () => {
	const model = { components: [{ rotation: 45, mirror: false }] };
	const r = crRotation(model);
	assert.equal(r.badRot, 1);
	assert.equal(r.pass, false);
});

test('CR-05 间距居中 → 通过', () => {
	// 三件均匀间隔 40
	const mk = (x) => ({ x, y: 0, bbox: { minX: x - 5, minY: -5, maxX: x + 5, maxY: 5 }, pins: [] });
	const model = { components: [mk(0), mk(40), mk(80)] };
	const r = crSpacing(model);
	assert.equal(r.id, 'CR-05');
	assert.equal(r.minNN, 40);
	assert.equal(r.pass, true);
});

test('CR-05 过挤(间距 5) → 不通过', () => {
	const mk = (x) => ({ x, y: 0, bbox: { minX: x, minY: 0, maxX: x + 2, maxY: 2 }, pins: [] });
	const model = { components: [mk(0), mk(5)] };
	const r = crSpacing(model);
	assert.equal(r.pass, false);
});

test('CR-07 命名占比统计,恒不扣分', () => {
	const model = { wires: [
		{ attrs: [{ key: 'Name', value: 'NETA' }] },
		{ attrs: [{ key: 'Name', value: 'NETB' }] },
		{ attrs: [] },
	] };
	const r = crNamedRatio(model);
	assert.equal(r.named, 2);
	assert.equal(r.total, 3);
	assert.equal(r.namedPct, 67);
	assert.equal(r.pass, true);
});

test('CR-06 标签贴在线顶点 → 距离 0 通过', () => {
	const model = { wires: [{ line: [0, 0, 20, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 0 }] }] };
	const r = crLabelToLine(model);
	assert.equal(r.medDist, 0);
	assert.equal(r.pass, true);
});

test('CR-06 标签飘远(距 50) → 不通过', () => {
	const model = { wires: [{ line: [0, 0, 20, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 50 }] }] };
	const r = crLabelToLine(model);
	assert.equal(r.medDist, 50);
	assert.equal(r.pass, false);
});

// 横放 2 脚件:body y∈[-2,2],脚在 x=±10;标号/阻值同侧(上方),垂直偏移 10/10,在 body 外
const goodPassive = () => ({
	pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
	bbox: { minX: -8, minY: -2, maxX: 8, maxY: 2 },
	attrs: [
		{ key: 'Designator', valueVisible: true, x: -2, y: 12 },
		{ key: 'Name', valueVisible: true, x: -2, y: 10 },
	],
});

test('CR-10 标号/阻值在外、垂直偏移、同侧 → 通过', () => {
	const r = crLabelPlacement({ components: [goodPassive()] });
	assert.equal(r.outsidePct, 100);
	assert.equal(r.sameSidePct, 100);
	assert.equal(r.pass, true);
});

test('CR-10 标签压在 body 内 → 不通过', () => {
	const bad = goodPassive();
	bad.attrs = [{ key: 'Designator', valueVisible: true, x: 0, y: 0 }, { key: 'Name', valueVisible: true, x: 0, y: 0 }];
	const r = crLabelPlacement({ components: [bad] });
	assert.ok(r.outsidePct < 100);
	assert.equal(r.pass, false);
});

test('CR-01 error=0 通过,error>0 不通过', () => {
	assert.equal(crDrc({ error: 0, warn: 3, info: 0 }).pass, true);
	assert.equal(crDrc({ error: 2, warn: 0, info: 0 }).pass, false);
});

test('scoreAll 汇总:全好板 commercialPass=true', () => {
	const model = {
		components: [{ rotation: 0, mirror: false, x: 0, y: 0, bbox: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
			pins: [{ x: -10, y: 0 }, { x: 10, y: 0 }],
			attrs: [{ key: 'Designator', valueVisible: true, x: -2, y: 12 }, { key: 'Name', valueVisible: true, x: -2, y: 10 }] },
			{ rotation: 90, mirror: false, x: 40, y: 0, bbox: { minX: 35, minY: -5, maxX: 45, maxY: 5 },
			pins: [{ x: 40, y: -10 }, { x: 40, y: 10 }],
			attrs: [{ key: 'Designator', valueVisible: true, x: 50, y: 2 }, { key: 'Name', valueVisible: true, x: 50, y: -2 }] }],
		wires: [{ line: [0, 0, 40, 0], attrs: [{ key: 'Name', value: 'NETA', x: 0, y: 0 }] }],
	};
	const r = scoreAll(model, { drc: { error: 0, warn: 0, info: 0 } });
	assert.equal(r.rules.length, 10);
	assert.equal(r.blockFail, 0);
	assert.equal(r.commercialPass, true);
});
