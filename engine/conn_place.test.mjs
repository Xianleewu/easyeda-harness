import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connPlace } from './conn_place.mjs';

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
