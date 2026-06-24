import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twinPredict } from './eda_twin.mjs';

// 快照件:在原点 rot0,bbox 10x20,1 个脚 + 1 个可见标注
const snap = {
	components: [{
		designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false,
		bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
		pins: [{ num: '1', name: 'A', x: 10, y: 5, type: 'in', noConnected: false }],
		attrs: [{ key: 'Name', value: '10k', x: 2, y: 22, valueVisible: true, bbox: { minX: 2, minY: 22, maxX: 12, maxY: 36 } }],
	}],
};

test('twinPredict:旋转件 bbox 被重算(rot90 → 宽高互换),脚/标注随放置变换', () => {
	const model = { components: [{ designator: 'X1', x: 100, y: 100, rotation: 90, mirror: false }] };
	const g = twinPredict(model, snap);
	const c = g.components[0];
	assert.equal(c.bbox.maxX - c.bbox.minX, 20);   // 原 10 → 旋转后 20
	assert.equal(c.bbox.maxY - c.bbox.minY, 10);   // 原 20 → 旋转后 10
	assert.equal(c.pins[0].x, 95); assert.equal(c.pins[0].y, 110);   // (10,5) rot90 → (-5,10)+origin
	assert.ok(c.attrs[0].bbox, '标注 bbox 应预测出');
});

test('twinPredict:输出与 readGeometry 同形(顶层键齐全)', () => {
	const g = twinPredict({ components: [{ designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false }] }, snap);
	for (const k of ['components', 'wires', 'netflags', 'texts', 'rectangles']) assert.ok(k in g, `缺 ${k}`);
});

test('twinPredict:模型件不在快照 → 抛(fail-closed,不瞎猜)', () => {
	assert.throws(() => twinPredict({ components: [{ designator: 'ZZ', x: 0, y: 0 }] }, snap), /不在快照/);
});

/* Fix2:快照 attr bbox 缺失(null)但可见 → twinPredict 后预测件 attr 有 bbox */
test('twinPredict:快照 attr bbox 缺失但可见 → 预测件 attr 得到非 null bbox', () => {
	const snapNoBbox = {
		components: [{
			designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false,
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
			pins: [{ num: '1', name: 'A', x: 10, y: 5, type: 'in', noConnected: false }],
			attrs: [{ key: 'Name', value: '10k', x: 2, y: 22, valueVisible: true, bbox: null }],
		}],
	};
	const model = { components: [{ designator: 'X1', x: 0, y: 0, rotation: 0, mirror: false }] };
	const g = twinPredict(model, snapNoBbox);
	const attr = g.components[0].attrs[0];
	assert.ok(attr.bbox != null, 'attr bbox 应由 fillVisibleAttrBBoxes 填入');
	assert.ok(attr.bbox.maxX > attr.bbox.minX, '填入的 bbox 宽度应 > 0');
});
