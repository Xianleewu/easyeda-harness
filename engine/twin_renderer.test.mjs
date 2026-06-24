import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTwin } from './twin_renderer.mjs';
import { existsSync, statSync, rmSync } from 'node:fs';

test('renderTwin:产出 PNG 文件(冒烟)', () => {
	const out = '/tmp/twin_smoke.png';
	const g = { components: [{ designator: 'X1', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 }, pins: [{ x: 10, y: 5 }], attrs: [{ key: 'Name', value: '1k', valueVisible: true, bbox: { minX: 0, minY: 22, maxX: 12, maxY: 36 } }] }], wires: [{ net: 'N', line: [10, 5, 30, 5] }], netflags: [], texts: [], rectangles: [] };
	renderTwin(g, out, { width: 600 });
	assert.ok(existsSync(out) && statSync(out).size > 0);
	rmSync(out, { force: true });
});
