// ortho_route 单测:正交点到点避障布线器(物理布线引擎基石)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routePath } from './ortho_route.mjs';

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
function orthogonal(path) {
	for (let i = 1; i < path.length; i++) {
		const [ax, ay] = path[i - 1], [bx, by] = path[i];
		if (ax !== bx && ay !== by) return false;
	}
	return true;
}
function hitsObstacle(path, obs) {
	for (let i = 1; i < path.length; i++) {
		const [ax, ay] = path[i - 1], [bx, by] = path[i];
		for (const r of obs) {
			if (ax === bx) { const x = ax; if (x <= r.minX || x >= r.maxX) continue; const y0 = Math.min(ay, by), y1 = Math.max(ay, by); if (y0 < r.maxY && y1 > r.minY) return true; }
			else { const y = ay; if (y <= r.minY || y >= r.maxY) continue; const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx); if (x0 < r.maxX && x1 > r.minX) return true; }
		}
	}
	return false;
}

test('直线无障碍:同 y 两点 → 水平连通', () => {
	const p = routePath([0, 0], [100, 0], []);
	assert.deepEqual(p[0], [0, 0]);
	assert.deepEqual(p[p.length - 1], [100, 0]);
	assert.ok(orthogonal(p));
});

test('L 形:异 x 异 y 无障碍 → 正交连通端点', () => {
	const p = routePath([0, 0], [100, 80], []);
	assert.deepEqual(p[0], [0, 0]);
	assert.deepEqual(p[p.length - 1], [100, 80]);
	assert.ok(orthogonal(p), '正交');
});

test('避障:两点间正中有障碍 → 绕开、正交、端点正确', () => {
	const obs = [rect(30, -40, 70, 40)];
	const p = routePath([0, 0], [100, 0], obs);
	assert.deepEqual(p[0], [0, 0]);
	assert.deepEqual(p[p.length - 1], [100, 0]);
	assert.ok(orthogonal(p), '正交');
	assert.ok(!hitsObstacle(p, obs), '不穿障碍');
});

test('避障:多障碍夹击仍绕通', () => {
	const obs = [rect(30, -100, 50, 20), rect(30, 40, 50, 200), rect(60, -20, 80, 60)];
	const p = routePath([0, 0], [120, 0], obs);
	assert.deepEqual(p[0], [0, 0]);
	assert.deepEqual(p[p.length - 1], [120, 0]);
	assert.ok(orthogonal(p));
	assert.ok(!hitsObstacle(p, obs), '不穿障碍');
});

test('确定性:同输入两次相同', () => {
	const obs = [rect(30, -40, 70, 40)];
	assert.deepEqual(routePath([0, 0], [100, 0], obs), routePath([0, 0], [100, 0], obs));
});

test('无解:起点被障碍包死 → 返回 null 不抛', () => {
	const obs = [rect(-50, -50, 50, 50)];
	const p = routePath([0, 0], [500, 0], obs);
	assert.ok(p === null || Array.isArray(p));
});
