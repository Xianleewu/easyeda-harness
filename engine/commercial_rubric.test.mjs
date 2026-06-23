import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC, THRESHOLDS } from './commercial_rubric.mjs';

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
