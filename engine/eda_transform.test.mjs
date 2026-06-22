// eda_transform 测试 —— 锁死实测的 EDA 变换真值(R1@(210,700),脚2局部(20,0))。零特定电路内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotOffset, placePin, localOffset, pinLocalOffsets } from './eda_transform.mjs';

test('rotOffset:实测 CCW 旋转真值', () => {
	assert.deepEqual(rotOffset(20, 0, 0), [20, 0]);
	assert.deepEqual(rotOffset(20, 0, 90), [0, 20]);     // 实测 r90
	assert.deepEqual(rotOffset(20, 0, 180), [-20, 0]);   // 实测 r180
	assert.deepEqual(rotOffset(20, 0, 270), [0, -20]);   // 实测 r270
});

test('placePin:局部偏移 → 全局连接点(对齐实测帧)', () => {
	const O = [210, 700];
	assert.deepEqual(placePin(20, 0, ...O, 0, false), [230, 700]);    // r0
	assert.deepEqual(placePin(20, 0, ...O, 90, false), [210, 720]);   // r90
	assert.deepEqual(placePin(20, 0, ...O, 180, false), [190, 700]);  // r180
	assert.deepEqual(placePin(20, 0, ...O, 270, false), [210, 680]);  // r270
	// 镜像实测全帧(翻X后 CW 旋转):M0(-20,0) M90(0,20) M180(20,0) M270(0,-20)
	assert.deepEqual(placePin(20, 0, ...O, 0, true), [190, 700]);     // M0
	assert.deepEqual(placePin(20, 0, ...O, 90, true), [210, 720]);    // M90
	assert.deepEqual(placePin(20, 0, ...O, 180, true), [230, 700]);   // M180
	assert.deepEqual(placePin(20, 0, ...O, 270, true), [210, 680]);   // M270
});

test('localOffset 是 placePin 的逆(往返一致)', () => {
	for (const rot of [0, 90, 180, 270]) for (const mir of [false, true]) {
		const [gx, gy] = placePin(20, -7, 100, 50, rot, mir);
		const [ldx, ldy] = localOffset(gx, gy, 100, 50, rot, mir);
		assert.deepEqual([ldx, ldy], [20, -7], `rot=${rot} mir=${mir} 往返失真`);
	}
});

test('pinLocalOffsets:从快照脚解析局部偏移(基准 rot0)', () => {
	// 一个 rot90 的件:脚全局是旋转后的,解析回局部应是 rot0 基准
	const c = { x: 0, y: 0, rotation: 90, mirror: false, pins: [{ num: '1', x: 0, y: 20 }, { num: '2', x: 0, y: -20 }] };
	const off = pinLocalOffsets(c);
	// 全局(0,20)在 rot90 下,局部=去转90=(20,0)?验证:placePin(20,0,0,0,90)=(0,20) ✓
	const p1 = off.find(o => o.num === '1');
	assert.deepEqual(placePin(p1.ldx, p1.ldy, 0, 0, 90, false), [0, 20], '解析的局部偏移按 rot90 放回应=原全局');
});

test('重排保真:换放置后用局部偏移重算脚位 = EDA 会产生的脚位', () => {
	// 模拟:件原在 (210,700,rot0),脚2全局(230,700)。重排到 (500,300,rot90)。
	const c = { x: 210, y: 700, rotation: 0, mirror: false, pins: [{ num: '2', x: 230, y: 700 }, { num: '1', x: 190, y: 700 }] };
	const off = pinLocalOffsets(c);   // 脚2局部应=(20,0)
	const o2 = off.find(o => o.num === '2');
	assert.deepEqual([o2.ldx, o2.ldy], [20, 0]);
	// 重排到 (500,300,rot90):脚2新全局 = placePin(20,0,500,300,90) = (500,320)
	assert.deepEqual(placePin(o2.ldx, o2.ldy, 500, 300, 90, false), [500, 320]);
});
