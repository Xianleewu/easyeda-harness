// label_resolve 单测:跨模块同名网标 L10 碰撞消解(门精确、只接受严格改善)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabelCollisions } from './label_resolve.mjs';
import { labelQC } from './label_qc.mjs';
import { geomQC } from './geom_qc.mjs';

// 两模块同名网 SIG 的命名 stub 都落 y=1000 且 x 范围【真重叠】(830–850)→ 真 L10(导线互压);附近有空闲 y 可重路由。
// (跨列同 y 但 x 不重叠的同名标签不是 L10——见 wire_label_qc L10 的 x 重叠判定,那是合法的跨模块双标签。)
// 器件置于 y=500–600,远离 y=1000 的 stub,使消解重路由不会撞 wireThruComp。
function collidingModel() {
	const comp = (d, x0, x1) => ({ designator: d, bbox: { minX: x0, minY: 500, maxX: x1, maxY: 600 }, pins: [] });
	return {
		components: [comp('A', 700, 740), comp('B', 900, 940)],
		wires: [
			{ net: 'SIG', line: [800, 1000, 840, 1000] },     // A 侧命名 stub(左逃逸→右标签) x 800–840 len40
			{ net: 'SIG', line: [860, 1000, 820, 1000] },     // B 侧命名 stub(右逃逸→左标签) x 820–860(与 A 重叠 820–840)len40
		],
		netflags: [
			{ kind: 'sig', net: 'SIG', x: 840, y: 1000, textX: 840, textY: 1000, rot: 0, alignMode: 6 },
			{ kind: 'sig', net: 'SIG', x: 820, y: 1000, textX: 820, textY: 1000, rot: 0, alignMode: 8 },
		],
	};
}

test('label_resolve:消解前有 L10、消解后 L10=0 且无新增 geom/label 硬伤', () => {
	const m = collidingModel();
	assert.ok(labelQC(m).some(f => f.rule === 'L10-dup-named-stub'), '前提:存在 L10');
	resolveLabelCollisions(m);
	const lh = labelQC(m).filter(f => f.severity === 'hard');
	const g = geomQC(m);
	assert.equal(lh.length, 0, 'L10/其余标签硬伤清零');
	assert.equal(g.overlaps.length + g.wireThruComp.length + g.crossings + g.offgrid, 0, '无新增几何硬伤');
	// 两个 SIG 网标现处不同 y。
	const ys = m.netflags.filter(f => f.net === 'SIG').map(f => f.y);
	assert.notEqual(ys[0], ys[1], '两标签已错开 y');
});

test('label_resolve:无碰撞模型原样返回(幂等)', () => {
	const m = { components: [], wires: [{ net: 'A', line: [0, 0, 30, 0] }], netflags: [{ kind: 'sig', net: 'A', x: 30, y: 0, alignMode: 6 }] };
	const before = JSON.stringify(m);
	resolveLabelCollisions(m);
	assert.equal(JSON.stringify(m), before, '无 L10 → 不动');
});

test('label_resolve:命名段移动后仍正交、网标仍落段端点(L8 附着保持)', () => {
	const m = collidingModel();
	resolveLabelCollisions(m);
	for (const w of m.wires) {
		const l = w.line;
		for (let i = 0; i + 3 < l.length; i += 2) {
			const horiz = Math.abs(l[i + 1] - l[i + 3]) < 1, vert = Math.abs(l[i] - l[i + 2]) < 1;
			assert.ok(horiz || vert, '所有段正交');
		}
	}
	for (const f of m.netflags.filter(x => x.kind === 'sig')) {
		const onEnd = m.wires.some(w => (w.net || '') === f.net && w.line.length >= 2 &&
			((Math.abs(w.line[0] - f.x) < 1 && Math.abs(w.line[1] - f.y) < 1) ||
				(Math.abs(w.line[w.line.length - 2] - f.x) < 1 && Math.abs(w.line[w.line.length - 1] - f.y) < 1)));
		assert.ok(onEnd, `网标 ${f.net} 落在同名导线端点`);
	}
});
