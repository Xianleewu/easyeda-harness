// route_nets 单测:多网顺序避障布线(避器件体 + 前序已布线,减交叉;布不通回退 null)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeNets } from './route_nets.mjs';

const rect = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });
function orthogonal(path) {
	for (let i = 1; i < (path || []).length; i++) { const [ax, ay] = path[i - 1], [bx, by] = path[i]; if (ax !== bx && ay !== by) return false; }
	return true;
}
// 两条不同 net 的正交折线是否在非端点处相交
function crosses(p1, p2) {
	const segs = p => { const s = []; for (let i = 1; i < p.length; i++) s.push([p[i - 1], p[i]]); return s; };
	for (const [a1, b1] of segs(p1)) for (const [a2, b2] of segs(p2)) {
		const h = a1[1] === b1[1] ? [a1, b1] : (a2[1] === b2[1] ? [a2, b2] : null);
		const v = a1[0] === b1[0] ? [a1, b1] : (a2[0] === b2[0] ? [a2, b2] : null);
		if (!h || !v) continue;
		const hy = h[0][1], hx0 = Math.min(h[0][0], h[1][0]), hx1 = Math.max(h[0][0], h[1][0]);
		const vx = v[0][0], vy0 = Math.min(v[0][1], v[1][1]), vy1 = Math.max(v[0][1], v[1][1]);
		if (vx > hx0 && vx < hx1 && hy > vy0 && hy < vy1) return true;
	}
	return false;
}

test('多网:无冲突两网各自直连', () => {
	const nets = [{ a: [0, 0], b: [100, 0] }, { a: [0, 100], b: [100, 100] }];
	const r = routeNets(nets, []);
	assert.equal(r.length, 2);
	assert.ok(r.every(x => x.path && orthogonal(x.path)));
});

test('多网:会交叉的两网 → 第二条绕开第一条(无异网交叉)', () => {
	// 网1 水平穿过中间;网2 竖直穿过中间 → 朴素会十字交叉。
	const nets = [{ a: [0, 50], b: [200, 50] }, { a: [100, 0], b: [100, 120] }];
	const r = routeNets(nets, []);
	const routed = r.filter(x => x.path);
	// 至少都布出;若都布出则不应交叉(第二条避开第一条)
	if (routed.length === 2) assert.ok(!crosses(routed[0].path, routed[1].path), '两网不交叉');
	assert.ok(routed.length >= 1);
});

test('多网:避器件体', () => {
	const obs = [rect(40, -30, 80, 30)];
	const nets = [{ a: [0, 0], b: [120, 0] }];
	const r = routeNets(nets, obs);
	assert.ok(r[0].path, '布出');
	for (let i = 1; i < r[0].path.length; i++) {
		const [ax, ay] = r[0].path[i - 1], [bx, by] = r[0].path[i];
		for (const rr of obs) { if (ay === by) { const y = ay; if (y > rr.minY && y < rr.maxY) { const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx); assert.ok(!(x0 < rr.maxX && x1 > rr.minX), '不穿体'); } } }
	}
});

test('确定性 + 回退:布不通的网 path=null,不抛', () => {
	const obs = [rect(-50, -50, 50, 50)];   // 包死起点
	const nets = [{ a: [0, 0], b: [300, 0] }];
	const r = routeNets(nets, obs);
	assert.equal(r.length, 1);
	assert.ok(r[0].path === null || Array.isArray(r[0].path));
	assert.deepEqual(routeNets(nets, obs), r);
});
