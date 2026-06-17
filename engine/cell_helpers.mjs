// 可复用电路单元布局原语库（cell helper SDK）
//
// 目的：新电路 pack 用这些 helper 拼装模块几何，而不是手摆每一条导线和网标。
// 每个 helper 都是纯函数（不修改入参，返回新对象），并在构造期就 fail-fast
// 拒绝已知坏几何：斜线、悬空网标、超长命名 stub、空网名、净空不足。
//
// 约定（与 engine/geom_qc.mjs、engine/label_qc.mjs、engine/wire_label_qc.mjs 对齐）：
//   - EDA 坐标 y 朝上。
//   - 网标方向：左向 rot=180 alignMode=6（左下角原点）；右向 rot=0 alignMode=8（右下角原点）。
//   - GND 符号朝向：下=rot0 上=rot180 左=rot270 右=rot90。
//   - 信号网命名段只允许单条水平 stub；竖直汇流段必须无网名（否则 EDA 竖排网名）。
//   - 网标锚点必须落在同网命名导线外端点（杜绝悬空标签）。
import { layoutTune } from './layout_config.mjs';

const EPS = 1e-6;

/* 栅格与净空常量（禁止 hardcode 魔法数字） */
export const GRID = 10;
export const HALF_GRID = 5;
export const STUB_MAX = 55;          /* 与 wire_label_qc 对齐：通用网名水平 stub 上限 */
export const LABEL_KEEPOUT = 12;     /* 与 label_qc CLR 对齐：网标须离器件 ≥ 该净空 */
export const GND_MIN_CLEARANCE = 15; /* GND/电源符号引线最小净空 */

/* ── 栅格对齐 ── */
export function snap(v, grid = GRID) {
	if (!Number.isFinite(v)) throw new Error(`snap: value must be finite, got ${v}`);
	if (!Number.isFinite(grid) || grid <= 0) throw new Error(`snap: grid must be > 0, got ${grid}`);
	return Math.round(v / grid) * grid;
}
export const q5 = v => snap(v, HALF_GRID);
export const q10 = v => snap(v, GRID);

/* ── 正交约束（可执行约束：构造期拒绝斜线） ── */
function isPoint(p) {
	return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

export function assertOrthSegment(x1, y1, x2, y2) {
	const horiz = Math.abs(y1 - y2) < EPS;
	const vert = Math.abs(x1 - x2) < EPS;
	if (!horiz && !vert) {
		throw new Error(`non-orthogonal segment (${x1},${y1})->(${x2},${y2})`);
	}
	return [x1, y1, x2, y2];
}

/* 校验折线每相邻两点轴向对齐，返回扁平 [x,y,...] */
export function orthPolyline(points) {
	if (!Array.isArray(points) || points.length < 2) {
		throw new Error('orthPolyline requires >= 2 points');
	}
	const flat = [];
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (!isPoint(p)) {
			throw new Error(`orthPolyline: bad point at index ${i}`);
		}
		if (i > 0) {
			const prev = points[i - 1];
			assertOrthSegment(prev[0], prev[1], p[0], p[1]);
		}
		flat.push(p[0], p[1]);
	}
	return flat;
}

/* 构造一条（正交校验过的）导线对象 */
export function wire(net, points) {
	return { net: net ?? '', line: orthPolyline(points) };
}

/* L 形正交拐角路由：from -> 拐点 -> to；prefer 决定先走水平还是竖直 */
export function elbow(from, to, prefer = 'h') {
	if (!isPoint(from) || !isPoint(to)) {
		throw new Error('elbow: from/to must be [x,y] points');
	}
	const [x1, y1] = from;
	const [x2, y2] = to;
	if (Math.abs(x1 - x2) < EPS || Math.abs(y1 - y2) < EPS) {
		return [[x1, y1], [x2, y2]];
	}
	const corner = prefer === 'v' ? [x1, y2] : [x2, y1];
	return [[x1, y1], corner, [x2, y2]];
}

/* ── 模块矩形（compact region + 互锁检测） ── */
function assertRect(r, who = 'rect') {
	const ok = r && ['minX', 'minY', 'maxX', 'maxY'].every(k => Number.isFinite(r[k]));
	if (!ok) throw new Error(`${who}: requires finite {minX,minY,maxX,maxY}`);
	if (r.maxX < r.minX || r.maxY < r.minY) throw new Error(`${who}: max < min`);
}

export function moduleRect(bbox, gap = 0) {
	assertRect(bbox, 'moduleRect');
	if (!Number.isFinite(gap) || gap < 0) throw new Error(`moduleRect: gap must be >= 0`);
	return {
		minX: bbox.minX - gap,
		minY: bbox.minY - gap,
		maxX: bbox.maxX + gap,
		maxY: bbox.maxY + gap,
	};
}

/* 一组点/矩形的包围矩形（声明模块占用区域用） */
export function regionOf(items, pad = 0) {
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error('regionOf: needs >= 1 point or rect');
	}
	const xs = [];
	const ys = [];
	for (const it of items) {
		if (isPoint(it)) {
			xs.push(it[0]);
			ys.push(it[1]);
		} else {
			assertRect(it, 'regionOf item');
			xs.push(it.minX, it.maxX);
			ys.push(it.minY, it.maxY);
		}
	}
	return {
		minX: Math.min(...xs) - pad,
		minY: Math.min(...ys) - pad,
		maxX: Math.max(...xs) + pad,
		maxY: Math.max(...ys) + pad,
	};
}

export function rectsOverlap(a, b, margin = 0) {
	assertRect(a, 'rectsOverlap a');
	assertRect(b, 'rectsOverlap b');
	return a.minX - margin < b.maxX && b.minX < a.maxX + margin
		&& a.minY - margin < b.maxY && b.minY < a.maxY + margin;
}

export function rectContains(r, x, y) {
	assertRect(r, 'rectContains');
	return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/* ── 网标 ── */
const SIDE_FLAG = {
	left: { rot: 180, alignMode: 6 },
	right: { rot: 0, alignMode: 8 },
};

export function sigFlag(net, x, y, side) {
	if (!net) throw new Error('sigFlag: requires a non-empty net name (no fake/floating labels)');
	const spec = SIDE_FLAG[side];
	if (!spec) throw new Error(`sigFlag: side must be 'left' or 'right', got ${side}`);
	return { kind: 'sig', net, x, y, textX: x, textY: y, rot: spec.rot, alignMode: spec.alignMode };
}

/* ── 标签列接入（左/右两侧通用） ──
 * 一组同网引脚 → 无网名水平逃出 → 无网名竖直汇流 → 单条命名水平 stub → 网标。
 * opts: { side:'left'|'right', escX, tapY?, stub? }
 *   escX 为竖直汇流列 x；命名 stub 端点 labelX = escX ∓ stub。
 * 返回 { wires, flags }。命名段仅一条水平 stub（满足 L7/L9/L10），网标落在 stub 外端点（满足 L8）。
 */
export function attachLabelColumn(net, pins, opts = {}) {
	if (!net) throw new Error('attachLabelColumn: requires a non-empty net name');
	if (!Array.isArray(pins) || pins.length === 0) throw new Error('attachLabelColumn: needs >= 1 pin point');
	for (const p of pins) {
		if (!isPoint(p)) throw new Error('attachLabelColumn: pins must be [x,y] points');
	}
	const { side = 'left' } = opts;
	if (!SIDE_FLAG[side]) throw new Error(`attachLabelColumn: side must be 'left' or 'right'`);
	if (!Number.isFinite(opts.escX)) throw new Error('attachLabelColumn: opts.escX (bus column x) is required');
	const escX = opts.escX;
	const stub = opts.stub ?? layoutTune.stub_len;
	if (!(stub > 0) || stub > STUB_MAX) {
		throw new Error(`attachLabelColumn: stub length ${stub} must be in (0, ${STUB_MAX}]`);
	}
	const tapY = Number.isFinite(opts.tapY) ? opts.tapY : q10(pins[0][1]);
	const labelX = side === 'left' ? escX - stub : escX + stub;

	const wires = [];
	/* 无网名水平逃出到汇流列 */
	for (const p of pins) {
		if (Math.abs(p[0] - escX) > EPS) {
			wires.push(wire('', [[p[0], p[1]], [escX, p[1]]]));
		}
	}
	/* 无网名竖直汇流（覆盖各逃出点 y 与 tapY） */
	const ys = [...new Set([...pins.map(p => p[1]), tapY])].sort((a, b) => a - b);
	for (let i = 0; i + 1 < ys.length; i++) {
		if (Math.abs(ys[i] - ys[i + 1]) > EPS) {
			wires.push(wire('', [[escX, ys[i]], [escX, ys[i + 1]]]));
		}
	}
	/* 单条命名水平 stub + 网标（锚点落在 stub 外端点） */
	wires.push(wire(net, [[escX, tapY], [labelX, tapY]]));
	const flags = [sigFlag(net, labelX, tapY, side)];
	return { wires, flags };
}

/* 单引脚标签 stub（attachLabelColumn 的便捷封装） */
export function labelStub(net, point, opts = {}) {
	if (!isPoint(point)) throw new Error('labelStub: point must be [x,y]');
	const escX = Number.isFinite(opts.escX)
		? opts.escX
		: (opts.side === 'right' ? point[0] + (opts.escGap ?? layoutTune.esc_gap) : point[0] - (opts.escGap ?? layoutTune.esc_gap));
	return attachLabelColumn(net, [point], { ...opts, escX, tapY: opts.tapY ?? point[1] });
}

/* ── GND / 电源 / NC ── */
const GND_ROT = { down: 0, up: 180, left: 270, right: 90 };

function dirTarget(x, y, dir, len) {
	if (dir === 'down') return [x, y - len];
	if (dir === 'up') return [x, y + len];
	if (dir === 'left') return [x - len, y];
	if (dir === 'right') return [x + len, y];
	throw new Error(`direction must be up/down/left/right, got ${dir}`);
}

export function gndStub(from, opts = {}) {
	if (!isPoint(from)) throw new Error('gndStub: from must be [x,y]');
	const { dir = 'down', len = 25, net = 'GND' } = opts;
	if (!(len >= GND_MIN_CLEARANCE)) {
		throw new Error(`gndStub: len ${len} < min clearance ${GND_MIN_CLEARANCE}`);
	}
	const rot = GND_ROT[dir];
	if (rot == null) throw new Error(`gndStub: direction must be up/down/left/right, got ${dir}`);
	const [tx, ty] = dirTarget(from[0], from[1], dir, len);
	return {
		wires: [wire(net, [[from[0], from[1]], [tx, ty]])],
		flags: [{ kind: 'gnd', net, x: tx, y: ty, rot }],
	};
}

export function powerStub(net, from, opts = {}) {
	if (!net) throw new Error('powerStub: requires a non-empty net name');
	if (!isPoint(from)) throw new Error('powerStub: from must be [x,y]');
	const { dir = 'up', len = 50, rot = 0 } = opts;
	if (!(len >= GND_MIN_CLEARANCE)) {
		throw new Error(`powerStub: len ${len} < min clearance ${GND_MIN_CLEARANCE}`);
	}
	const [tx, ty] = dirTarget(from[0], from[1], dir, len);
	return {
		wires: [wire(net, [[from[0], from[1]], [tx, ty]])],
		flags: [{ kind: 'power', net, x: tx, y: ty, rot }],
	};
}

export function ncMark(ref, pin) {
	if (!ref) throw new Error('ncMark: requires a component ref');
	if (pin == null || pin === '') throw new Error('ncMark: requires a pin');
	return { ref: String(ref), pin: String(pin) };
}

/* ── 器件属性放置（位号/值，离器件体留净空，不与引脚/边框重叠） ── */
const ATTR_ALIGN = { top: 7, bottom: 7, left: 9, right: 7 };

export function attributeAnchor(bbox, opts = {}) {
	assertRect(bbox, 'attributeAnchor');
	const { side = 'top', gap = GRID } = opts;
	if (!(gap >= HALF_GRID)) throw new Error(`attributeAnchor: gap ${gap} < min ${HALF_GRID}`);
	const cx = (bbox.minX + bbox.maxX) / 2;
	const cy = (bbox.minY + bbox.maxY) / 2;
	if (side === 'top') return { x: cx, y: bbox.maxY + gap, alignMode: ATTR_ALIGN.top };
	if (side === 'bottom') return { x: cx, y: bbox.minY - gap, alignMode: ATTR_ALIGN.bottom };
	if (side === 'left') return { x: bbox.minX - gap, y: cy, alignMode: ATTR_ALIGN.left };
	if (side === 'right') return { x: bbox.maxX + gap, y: cy, alignMode: ATTR_ALIGN.right };
	throw new Error(`attributeAnchor: side must be top/bottom/left/right, got ${side}`);
}

/* ── 构造期校验器（门禁规则的构造期镜像，供 pack/测试自检） ── */
export function assertOrthogonalWires(wires) {
	const bad = [];
	for (const w of wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const horiz = Math.abs(l[i + 1] - l[i + 3]) < EPS;
			const vert = Math.abs(l[i] - l[i + 2]) < EPS;
			if (!horiz && !vert) {
				bad.push({ net: w.net || '', seg: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
			}
		}
	}
	if (bad.length) {
		throw new Error(`assertOrthogonalWires: ${bad.length} non-orthogonal segment(s): ${JSON.stringify(bad.slice(0, 5))}`);
	}
	return true;
}

/* 每个 sig 网标必须落在同网导线某段端点（镜像 L8，构造期捕获悬空标签） */
export function assertLabelsAttached(wires, flags) {
	const onEnd = (x, y, net) => (wires || []).some(w => {
		if ((w.net || '') !== net) return false;
		const l = w.line || [];
		for (let i = 0; i + 1 < l.length; i += 2) {
			if (Math.abs(l[i] - x) < 1 && Math.abs(l[i + 1] - y) < 1) return true;
		}
		return false;
	});
	const floating = [];
	for (const f of flags || []) {
		if (f.kind !== 'sig') continue;
		const x = f.textX ?? f.x;
		const y = f.textY ?? f.y;
		if (!onEnd(x, y, f.net)) floating.push({ net: f.net, x, y });
	}
	if (floating.length) {
		throw new Error(`assertLabelsAttached: ${floating.length} floating label(s): ${JSON.stringify(floating.slice(0, 5))}`);
	}
	return true;
}

/* 合并多个 {wires, flags, noConnects} 片段（pack 拼装模块用） */
export function mergeParts(...parts) {
	const out = { wires: [], flags: [], noConnects: [] };
	for (const p of parts) {
		if (!p) continue;
		if (p.wires) out.wires.push(...p.wires);
		if (p.flags) out.flags.push(...p.flags);
		if (p.noConnects) out.noConnects.push(...p.noConnects);
	}
	return out;
}
