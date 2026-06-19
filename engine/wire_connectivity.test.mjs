// wire_connectivity 单测:验证合成模型的导线/网标几何确实实现了逻辑网的引脚连通。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireConnectivity } from './wire_connectivity.mjs';

const comp = (d, pins) => ({ designator: d, pins, bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } });

test('连通:两脚经同名命名线 → 无 finding', () => {
	const model = {
		components: [comp('R1', [{ num: '1', x: 0, y: 0 }]), comp('R2', [{ num: '1', x: 100, y: 0 }])],
		wires: [{ net: 'NET', line: [0, 0, 100, 0] }], netflags: [],
	};
	const logical = { nets: [{ name: 'NET', class: 'signal', pins: ['R1.1', 'R2.1'] }] };
	assert.deepEqual(wireConnectivity({ model, logical }), []);
});

test('连通:跨模块经两段同名命名线(非接触、靠网名)→ 无 finding', () => {
	const model = {
		components: [comp('R1', [{ num: '1', x: 0, y: 0 }]), comp('R2', [{ num: '1', x: 500, y: 0 }])],
		wires: [{ net: 'SIG', line: [0, 0, 30, 0] }, { net: 'SIG', line: [500, 0, 470, 0] }], netflags: [],
	};
	const logical = { nets: [{ name: 'SIG', class: 'signal', pins: ['R1.1', 'R2.1'] }] };
	assert.deepEqual(wireConnectivity({ model, logical }), []);
});

test('断连:一脚的簇不带该网名 → WC-disconnected', () => {
	const model = {
		components: [comp('R1', [{ num: '1', x: 0, y: 0 }]), comp('R2', [{ num: '1', x: 500, y: 0 }])],
		wires: [{ net: 'SIG', line: [0, 0, 30, 0] }], netflags: [],
	};
	const logical = { nets: [{ name: 'SIG', class: 'signal', pins: ['R1.1', 'R2.1'] }] };
	const f = wireConnectivity({ model, logical });
	assert.ok(f.some(x => x.where.net === 'SIG' && x.severity === 'hard'), '应检出 SIG 断连');
});

test('连通:经无名逃逸线中转到命名 stub → 无 finding', () => {
	const model = {
		components: [comp('U1', [{ num: '5', x: 0, y: 0 }]), comp('J1', [{ num: '2', x: 500, y: 0 }])],
		wires: [
			{ net: '', line: [0, 0, 0, 50, 40, 50] }, { net: 'TX', line: [40, 50, 60, 50] },
			{ net: '', line: [500, 0, 500, 50, 460, 50] }, { net: 'TX', line: [460, 50, 440, 50] },
		], netflags: [],
	};
	const logical = { nets: [{ name: 'TX', class: 'signal', pins: ['U1.5', 'J1.2'] }] };
	assert.deepEqual(wireConnectivity({ model, logical }), []);
});

test('连通:脚靠无名线 T 接(端点贴命名线中段)到命名线 → 无 finding（T 接 union 修复）', () => {
	// B.1 的连通靠无名线端点(30,50)落在命名线 NET [0,50→50,50] 的内部(T 接)。
	// EDA 几何连通会连上;原 union 只连每条线自身相邻顶点、漏 T 接 → 会误报 B.1 断连。
	const model = {
		components: [comp('A', [{ num: '1', x: 0, y: 50 }]), comp('B', [{ num: '1', x: 30, y: 80 }])],
		wires: [
			{ net: 'NET', line: [0, 50, 50, 50] },
			{ net: '', line: [30, 50, 30, 80] },
		], netflags: [],
	};
	const logical = { nets: [{ name: 'NET', class: 'signal', pins: ['A.1', 'B.1'] }] };
	assert.deepEqual(wireConnectivity({ model, logical }), []);
});

test('断连:脚悬空(不在任何线/簇上)仍正确报 WC-disconnected（T 接修复不掩盖真断连）', () => {
	const model = {
		components: [comp('A', [{ num: '1', x: 0, y: 50 }]), comp('B', [{ num: '1', x: 30, y: 800 }])],
		wires: [{ net: 'NET', line: [0, 50, 50, 50] }], netflags: [],
	};
	const logical = { nets: [{ name: 'NET', class: 'signal', pins: ['A.1', 'B.1'] }] };
	assert.ok(wireConnectivity({ model, logical }).some(x => x.severity === 'hard'), 'B.1 悬空应报断连');
});

test('单脚网/缺参数:不报/抛错', () => {
	assert.deepEqual(wireConnectivity({ model: { components: [comp('R1', [{ num: '1', x: 0, y: 0 }])], wires: [], netflags: [] }, logical: { nets: [{ name: 'X', class: 'signal', pins: ['R1.1'] }] } }), []);
	assert.throws(() => wireConnectivity({}));
});
