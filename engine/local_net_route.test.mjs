// local_net_route 测试 —— 全合成夹具,零特定电路内容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLocalNets } from './local_net_route.mjs';

test('两脚本地网 → 加 1 条直连(同 y 正交)', () => {
	const model = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [{ num: '1', x: 10, y: 5 }] },
			{ designator: 'B', bbox: { minX: 50, minY: 0, maxX: 60, maxY: 10 }, pins: [{ num: '1', x: 50, y: 5 }] },
		],
		wires: [],
	};
	const r = routeLocalNets(model, [{ name: 'LOCAL_1', pins: ['A.1', 'B.1'] }]);
	assert.equal(r.added, 1);
	assert.deepEqual(model.wires[0].line, [10, 5, 50, 5]);   // 同 y → 直线
	assert.equal(model.wires[0].net, '');   // 默认无标签
});

test('三脚本地网 → 链式 2 段', () => {
	const model = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'B', bbox: { minX: 20, minY: 0, maxX: 24, maxY: 4 }, pins: [{ num: '1', x: 20, y: 0 }] },
			{ designator: 'C', bbox: { minX: 40, minY: 0, maxX: 44, maxY: 4 }, pins: [{ num: '1', x: 40, y: 0 }] },
		],
		wires: [],
	};
	const r = routeLocalNets(model, [{ name: 'L', pins: ['A.1', 'B.1', 'C.1'] }]);
	assert.equal(r.added, 2, '3 脚链式 2 段');
});

test('对角脚 → L 形正交(3 顶点)', () => {
	const model = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, pins: [{ num: '1', x: 0, y: 0 }] },
			{ designator: 'B', bbox: { minX: 30, minY: 30, maxX: 34, maxY: 34 }, pins: [{ num: '1', x: 30, y: 30 }] },
		],
		wires: [],
	};
	routeLocalNets(model, [{ name: 'L', pins: ['A.1', 'B.1'] }]);
	assert.equal(model.wires[0].line.length, 6, 'L 形=3 顶点');
});

test('跨模块缺失脚(只 1 脚在模型内)→ 跳过并计数', () => {
	const model = { components: [{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, pins: [{ num: '1', x: 0, y: 0 }] }], wires: [] };
	const r = routeLocalNets(model, [{ name: 'L', pins: ['A.1', 'Z.9'] }]);
	assert.equal(r.added, 0);
	assert.equal(r.skipped, 1);
});

test('远距本地网(跨度>200)→ 命名标签对(零跨层走线)', () => {
	const model = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [{ num: '1', x: 10, y: 5 }] },
			{ designator: 'B', bbox: { minX: 500, minY: 300, maxX: 510, maxY: 310 }, pins: [{ num: '1', x: 500, y: 305 }] },
		],
		wires: [], netflags: [],
	};
	const r = routeLocalNets(model, [{ name: 'LOCAL_1', pins: ['A.1', 'B.1'] }]);
	assert.equal(r.labeled, 1, '远距 → 1 条网用标签');
	assert.equal(r.segs, 0, '无跨层直连线段');
	assert.equal(model.netflags.length, 2, '两端各 1 网标');
	assert.equal(model.netflags[0].net, model.netflags[1].net, '同名(合并连通)');
	assert.ok(/^N\d+$/.test(model.netflags[0].net), '合成 collision-safe 名 N<idx>');
	// 每个网标都有短桩连到脚,不跨层
	for (const w of model.wires) { const l = w.line; assert.ok(Math.abs(l[0] - l[l.length - 2]) <= 30 && Math.abs(l[1] - l[l.length - 1]) <= 30, '桩短(<30px)'); }
});

test('名碰撞 → 跳过已用名', () => {
	const model = {
		components: [
			{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pins: [{ num: '1', x: 10, y: 5 }] },
			{ designator: 'B', bbox: { minX: 500, minY: 300, maxX: 510, maxY: 310 }, pins: [{ num: '1', x: 500, y: 305 }] },
		],
		wires: [{ net: 'N1', line: [0, 0, 1, 1] }], netflags: [],   // N1 已占用
	};
	routeLocalNets(model, [{ name: 'LOCAL_1', pins: ['A.1', 'B.1'] }]);
	const syn = model.netflags[0].net;
	assert.notEqual(syn, 'N1', '避开已用 N1');
});

test('opts.label → 用本地网名打标', () => {
	const model = { components: [{ designator: 'A', bbox: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, pins: [{ num: '1', x: 0, y: 0 }] }, { designator: 'B', bbox: { minX: 20, minY: 0, maxX: 24, maxY: 4 }, pins: [{ num: '1', x: 20, y: 0 }] }], wires: [] };
	routeLocalNets(model, [{ name: 'LOCAL_3', pins: ['A.1', 'B.1'] }], { label: true });
	assert.equal(model.wires[0].net, 'LOCAL_3');
});
