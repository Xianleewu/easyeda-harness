// preserve_deliver 单测:布局质量检测 + 保留模型构建(纯函数)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessLayout, buildPreserveModel, netflagCreateRotation } from './preserve_deliver.mjs';

// 好布局:真实连线为主(wireRatio 高)、件分散有坐标、电容贴近 IC。
const goodSnap = {
	components: [
		{ designator: 'U1', x: 100, y: 100 }, { designator: 'C1', x: 120, y: 110 },
		{ designator: 'C2', x: 130, y: 90 }, { designator: 'R1', x: 200, y: 150 },
		{ designator: 'U2', x: 400, y: 300 }, { designator: 'C3', x: 420, y: 310 },
	],
	wires: Array.from({ length: 20 }, (_, i) => ({ net: 'N' + i, line: [0, i, 10, i] })),
	netflags: Array.from({ length: 4 }, (_, i) => ({ symbol: 'Ground-GND', net: 'GND', x: i, y: 0 })),
};

// 坏布局:网标汤(wireRatio 低)、件散开、电容远离 IC。
const badSnap = {
	components: [
		{ designator: 'U1', x: 100, y: 100 }, { designator: 'C1', x: 900, y: 900 },
		{ designator: 'C2', x: 1500, y: 50 }, { designator: 'U2', x: 50, y: 1600 },
	],
	wires: Array.from({ length: 10 }, (_, i) => ({ net: 'N' + i, line: [0, i, 10, i] })),
	netflags: Array.from({ length: 40 }, (_, i) => ({ symbol: 'Power-5V', net: '+5V', x: i, y: 0 })),
};

test('assessLayout 识别好布局:真实连线为主则 good', () => {
	const a = assessLayout(goodSnap);
	assert.equal(a.good, true, JSON.stringify(a.reasons));
	assert.ok(a.stats.wireRatio >= 0.5);
});

test('assessLayout 识别坏布局:网标汤(连线占比低)则 not good', () => {
	const a = assessLayout(badSnap);
	assert.equal(a.good, false);
	assert.ok(a.reasons.some(r => /连线占比低|标签汤/.test(r)));
});

test('assessLayout 退化坐标(件重叠)判差', () => {
	const a = assessLayout({ components: [{ designator: 'U1', x: 0, y: 0 }, { designator: 'C1', x: 5, y: 5 }], wires: [{ net: 'A', line: [0, 0, 1, 1] }], netflags: [] });
	assert.equal(a.good, false);
	assert.ok(a.reasons.some(r => /退化|重叠/.test(r)));
});

test('assessLayout 空输入安全', () => {
	const a = assessLayout({ components: [], wires: [], netflags: [] });
	assert.equal(a.good, false);
});

test('buildPreserveModel 保留件位、映射电源/地符号', () => {
	const m = buildPreserveModel({
		components: [{ designator: 'U1', x: 100, y: 200, rotation: 90, mirror: true }, { designator: '', x: 0, y: 0 }],
		wires: [{ net: 'VCC', line: [0, 0, 10, 0] }],
		netflags: [{ symbol: 'Ground-GND', net: 'GND', x: 5, y: 5, rotation: 0 }, { symbol: 'Power-5V', net: '+5V', x: 7, y: 7 }],
	});
	// 无 designator 的件被过滤
	assert.equal(m.components.length, 1);
	assert.deepEqual(m.components[0], { designator: 'U1', x: 100, y: 200, rotation: 90, mirror: true });
	assert.equal(m.wires[0].net, 'VCC');
	assert.equal(m.netflags[0].flagId, 'Ground');
	assert.equal(m.netflags[1].flagId, 'Power');
});

// createNetFlag 旋转镜像约定补偿:90↔270 互换,0/180 不变。
// 实测真实 bug:直接传 270 → 符号被翻转为 90 → +5V 符号 bbox 朝左压住 C17/C18/C19。
test('netflagCreateRotation 补偿镜像约定(90↔270,0/180不变)', () => {
	assert.equal(netflagCreateRotation(0), 0);
	assert.equal(netflagCreateRotation(90), 270);
	assert.equal(netflagCreateRotation(180), 180);
	assert.equal(netflagCreateRotation(270), 90);
	// 容错:undefined/越界归一
	assert.equal(netflagCreateRotation(undefined), 0);
	assert.equal(netflagCreateRotation(450), 270); // 450%360=90 → 270
});
