import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFromParts } from './bridge_windows.mjs';

test('regionFromParts 空 → null', () => {
	assert.equal(regionFromParts([]), null);
});

test('regionFromParts 围住器件且满足 aspect', () => {
	const parts = [
		{ bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
		{ bbox: { minX: 90, minY: 90, maxX: 100, maxY: 100 } },
	];
	const r = regionFromParts(parts, { aspect: 2, pad: 0 });
	assert.ok(r.left <= 0 && r.right >= 100);
	const w = r.right - r.left, h = r.top - r.bottom;
	assert.ok(Math.abs(w / h - 2) < 1e-6); // 满足 aspect
});
