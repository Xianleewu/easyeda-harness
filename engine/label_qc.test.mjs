// label_qc 单测:L4「导线穿标」的自有布线豁免(只防异网穿标,不误报标签压自身网逃逸)。
// 回归 XHARD2 压测发现:support 单件信号端点 / densefanout 控制器的标签(alignMode8 文字左生长)会回压到
// 自身网的无名竖直逃逸段 → 旧 L4 误判为硬伤。修:按共享端点聚簇,标签锚点同簇 + 同网或无名的导线豁免。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelQC } from './label_qc.mjs';

const sig = (net, x, y, alignMode) => ({ kind: 'sig', net, x, y, textX: x, textY: y, rot: 0, alignMode });
const L4 = m => labelQC(m).filter(f => f.rule === 'L4-wire-thru-label');

// 标签 NETA 在 (200,100),alignMode 8 → 文字框约 [158,200]×[100,108](len=max(40,4*6+18)=42)。
test('L4 豁免:标签压在自身网的无名逃逸链上不报', () => {
	// 链:无名竖直 [175,90-100] → 无名水平 [175-200,100] → 命名 stub [200... ] 接标签锚点(同簇)。
	const m = {
		components: [], netflags: [sig('NETA', 200, 100, 8)],
		wires: [
			{ net: '', line: [175, 90, 175, 100] },     // 自身无名竖直逃逸(穿过文字框)
			{ net: '', line: [175, 100, 200, 100] },    // 自身无名水平
			{ net: 'NETA', line: [200, 100, 200, 100] },// 退化命名段触锚点(建簇)
		],
	};
	assert.equal(L4(m).length, 0, '标签压自身网无名逃逸链 → 不算 L4');
});

test('L4 仍报:异网导线穿过标签文字框', () => {
	const m = {
		components: [], netflags: [sig('NETA', 200, 100, 8)],
		wires: [
			{ net: 'NETA', line: [240, 100, 200, 100] },  // 自身 stub 触锚点
			{ net: 'NETB', line: [175, 95, 175, 113] },   // 异网竖直穿文字框 [158,200]
		],
	};
	assert.ok(L4(m).length >= 1, '异网导线穿标必报');
});

test('L4 仍报:与标签不连通的无名导线穿过文字框', () => {
	const m = {
		components: [], netflags: [sig('NETA', 200, 100, 8)],
		wires: [
			{ net: 'NETA', line: [240, 100, 200, 100] },
			{ net: '', line: [175, 95, 175, 113] },       // 无名但独立、不在标签簇内
		],
	};
	assert.ok(L4(m).length >= 1, '异簇无名导线穿标必报(无名不等于豁免)');
});
