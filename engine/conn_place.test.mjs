import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connPlace, compactBlocks } from './conn_place.mjs';

test('两相连模块 → 摆相邻(连接长最小)', () => {
	// A: 100宽,脚 a.1 在右边沿(x=100);B: 100宽,脚 b.1 在左边沿(x=0)。共享网 N。
	const subs = [
		{ id: 'A', w: 100, h: 40, pins: [{ ref: 'A.1', x: 100, y: 20 }] },
		{ id: 'B', w: 100, h: 40, pins: [{ ref: 'B.1', x: 0, y: 20 }] },
	];
	const nets = [{ class: 'signal', pins: ['A.1', 'B.1'] }];
	const pos = connPlace(subs, nets, { pad: 40, base: 0 });
	const a = pos.get('A'), b = pos.get('B');
	// A 在 (0,0);B 应摆在 A 右侧相邻 → A.1(100,20) 与 B.1(B.X+0,20) 近
	const aPin = { x: a.X + (a.mir ? 0 : 100), y: a.y };
	const bPinX = b.X + (b.mir ? 100 : 0);
	const gap = Math.abs((a.X + 100) - bPinX);   // A 右脚 x 到 B 左脚 x
	assert.ok(gap <= 40 + 1, `相连脚应相邻(gap=${gap})`);
});

test('需镜像才相邻:B 的共享脚在右边沿 → 摆 A 右侧时镜像使脚朝左', () => {
	const subs = [
		{ id: 'A', w: 100, h: 40, pins: [{ ref: 'A.1', x: 100, y: 20 }] },
		{ id: 'B', w: 100, h: 40, pins: [{ ref: 'B.1', x: 100, y: 20 }] },   // B 脚在【右】
	];
	const nets = [{ class: 'signal', pins: ['A.1', 'B.1'] }];
	const pos = connPlace(subs, nets, { pad: 40, base: 0 });
	const b = pos.get('B');
	// 摆 A 右侧时,B.1(x=100)默认朝右(远离A);镜像后 x→0 朝左(近A)→ 应选镜像
	// 验证:镜像后 B 左脚 x = B.X,与 A 右脚(100)的 gap ≤ pad
	if (b.X > pos.get('A').X) assert.equal(b.mir, true, 'B 摆右侧应镜像使脚朝左');
});

test('不叠压:模块间留 PAD 缝', () => {
	const subs = [
		{ id: 'A', w: 100, h: 40, pins: [{ ref: 'A.1', x: 100, y: 20 }] },
		{ id: 'B', w: 100, h: 40, pins: [{ ref: 'B.1', x: 0, y: 20 }] },
	];
	const pos = connPlace(subs, [{ class: 'signal', pins: ['A.1', 'B.1'] }], { pad: 40, base: 0 });
	const a = pos.get('A'), b = pos.get('B');
	const ov = a.X < b.X + 100 && a.X + 100 > b.X && a.Y < b.Y + 40 && a.Y + 40 > b.Y;
	assert.ok(!ov, '不叠压');
});

test('三模块链 A-B-C → 顺次相邻', () => {
	const subs = [
		{ id: 'A', w: 80, h: 40, pins: [{ ref: 'A.1', x: 80, y: 20 }] },
		{ id: 'B', w: 80, h: 40, pins: [{ ref: 'B.1', x: 0, y: 20 }, { ref: 'B.2', x: 80, y: 20 }] },
		{ id: 'C', w: 80, h: 40, pins: [{ ref: 'C.1', x: 0, y: 20 }] },
	];
	const nets = [{ class: 'signal', pins: ['A.1', 'B.1'] }, { class: 'signal', pins: ['B.2', 'C.1'] }];
	const pos = connPlace(subs, nets, { pad: 40, base: 0 });
	assert.equal(pos.size, 3, '三模块都放置');
	// 无两模块叠压
	const arr = [...pos.entries()];
	for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
		const [ia, a] = arr[i], [ib, b] = arr[j]; const sa = subs.find(s => s.id === ia), sb = subs.find(s => s.id === ib);
		const ov = a.X < b.X + sb.w && a.X + sa.w > b.X && a.Y < b.Y + sb.h && a.Y + sa.h > b.Y;
		assert.ok(!ov, `${ia}/${ib} 不叠压`);
	}
});

test('compactBlocks: 消空洞 → 整体 bbox 缩小且两块不重叠', () => {
	const subs = [{ id: 'A', w: 100, h: 100 }, { id: 'B', w: 100, h: 100 }];
	const pos = new Map([
		['A', { X: 60, Y: 60, mir: false }],
		['B', { X: 500, Y: 500, mir: false }],   // 远,留大洞
	]);
	const area = m => {
		let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
		for (const [id, p] of m) { const s = subs.find(z => z.id === id); x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X + s.w); y1 = Math.max(y1, p.Y + s.h); }
		return (x1 - x0) * (y1 - y0);
	};
	const out = compactBlocks(pos, subs, { pad: 40, base: 60 });
	assert.ok(area(out) < area(pos), `压实后 bbox 应更小(${area(out)} < ${area(pos)})`);
	const a = out.get('A'), b = out.get('B');
	const overlap = a.X < b.X + 100 && b.X < a.X + 100 && a.Y < b.Y + 100 && b.Y < a.Y + 100;
	assert.ok(!overlap, '两块不应重叠');
});

test('compactBlocks: mir 透传、块数不变、确定性、不改原 pos', () => {
	const subs = [{ id: 'A', w: 80, h: 80 }, { id: 'B', w: 80, h: 80 }, { id: 'C', w: 80, h: 80 }];
	const pos = new Map([
		['A', { X: 60, Y: 60, mir: true }],
		['B', { X: 400, Y: 60, mir: false }],
		['C', { X: 60, Y: 400, mir: true }],
	]);
	const o1 = compactBlocks(pos, subs, { pad: 40, base: 60 });
	const o2 = compactBlocks(pos, subs, { pad: 40, base: 60 });
	assert.equal(o1.size, 3, '块数不变');
	assert.equal(o1.get('A').mir, true, 'A.mir 透传');
	assert.equal(o1.get('C').mir, true, 'C.mir 透传');
	for (const id of ['A', 'B', 'C']) assert.deepEqual(o1.get(id), o2.get(id), `${id} 确定性`);
	assert.equal(pos.get('B').X, 400, '不就地改原 pos(immutable)');
});

test('compactBlocks: 末位坐标吸格到 10 的倍数', () => {
	const subs = [{ id: 'A', w: 73, h: 51 }, { id: 'B', w: 67, h: 49 }];
	const pos = new Map([['A', { X: 60, Y: 60, mir: false }], ['B', { X: 300, Y: 300, mir: false }]]);
	const out = compactBlocks(pos, subs, { pad: 40, base: 60 });
	for (const [, p] of out) { assert.equal(p.X % 10, 0, 'X 吸格'); assert.equal(p.Y % 10, 0, 'Y 吸格'); }
});

test('compactBlocks: 单调守卫 → BLF 重排不更小时原样返回(永不变差)', () => {
	// A 高瘦、B 矮,已紧邻摆在 A 右侧(connPlace 式);BLF 重排此 2 块不会更小 → 应原样返回。
	const subs = [{ id: 'A', w: 100, h: 300 }, { id: 'B', w: 100, h: 40 }];
	const pos = new Map([
		['A', { X: 60, Y: 60, mir: false }],
		['B', { X: 200, Y: 60, mir: false }],
	]);
	const area = m => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [id, p] of m) { const s = subs.find(z => z.id === id); x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X + s.w); y1 = Math.max(y1, p.Y + s.h); } return (x1 - x0) * (y1 - y0); };
	const out = compactBlocks(pos, subs, { pad: 60, base: 60 });
	assert.ok(area(out) <= area(pos), '压实绝不大于原排布(单调)');
	assert.deepEqual(out.get('A'), { X: 60, Y: 60, mir: false }, '守卫触发 → A 原样');
	assert.deepEqual(out.get('B'), { X: 200, Y: 60, mir: false }, '守卫触发 → B 原样');
});
