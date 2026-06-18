// 角色原型:密脚 IC 扇出布线器。每侧引脚 → 间隔标签列(≥ROW_PITCH 行距)+ 平面无交叉路由。
// 平面性构造:每侧引脚顶→底排序;通道由顶脚最外、底脚最内递减;标签行 row_i=min(pin_i,row_{i-1}-ROW_PITCH)
// (全向下 jog、≥ROW_PITCH 间隔)。证明无交叉:下方脚逃出更短(内通道)、不触上方脚的外通道竖直段。
import { toWorld } from '../../engine/transform.mjs';
import { wire, sigFlag, regionOf, mergeParts } from '../../engine/cell_helpers.mjs';

const GRID = 10;
const snap10 = v => Math.round(v / GRID) * GRID;
const ROW_PITCH = 20;   // 标签行距(> 标签高 8,满足 L3)
const CH_STEP = 10;     // 通道间距
const LABEL_GAP = 30;   // 标签列离最外通道(满足 L6 离体 ≥12)
const STUB = 30;        // 末端水平命名 stub 长(≤STUB_MAX 55,满足 L9)

function routeSide(sidePins, side) {
	const frags = [];
	if (!sidePins.length) return frags;
	const pins = sidePins.slice().sort((a, b) => b.world[1] - a.world[1]); // 顶→底
	const N = pins.length;
	const dir = side === 'right' ? 1 : -1;
	const pinEdge = side === 'right'
		? Math.max(...pins.map(p => p.world[0]))
		: Math.min(...pins.map(p => p.world[0]));
	const channelX = i => snap10(pinEdge) + dir * (N - i) * CH_STEP; // 顶脚 i=0 最外
	const labelLen = name => Math.max(40, String(name).length * 6 + 18);
	const maxLen = Math.max(...pins.map(p => labelLen(p.net.name)));
	const outerCh = snap10(pinEdge) + dir * N * CH_STEP;          // 最外通道
	const labelX = snap10(outerCh + dir * (maxLen + LABEL_GAP));  // 标签列让开最宽标签框(否则标签压通道竖直段=L4)
	let prevRow = Infinity;
	const rows = [];
	for (let i = 0; i < N; i++) {
		const py = pins[i].world[1];
		const r = snap10(Math.min(py, prevRow - ROW_PITCH)); // 向下、≥ROW_PITCH
		rows.push(r);
		prevRow = r;
	}
	const preX = labelX - dir * STUB;   // 命名 stub 内端(无名路由汇到此)
	for (let i = 0; i < N; i++) {
		const [px, py] = pins[i].world;
		const cx = channelX(i), ry = rows[i];
		// 无名 staircase 路由:pin → (cx,py) → (cx,ry) → (preX,ry)
		const upts = [[px, py], [cx, py]];
		if (ry !== py) upts.push([cx, ry]);
		upts.push([preX, ry]);
		frags.push({ wires: [wire('', upts)], flags: [] });
		// 短水平命名 stub(≤STUB)+ 网标
		frags.push({ wires: [wire(pins[i].net.name, [[preX, ry], [labelX, ry]])], flags: [sigFlag(pins[i].net.name, labelX, ry, side)] });
	}
	return frags;
}

export function densefanoutArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length !== 1) {
		throw new Error('densefanoutArchetype: spec.parts must be exactly one component');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('densefanoutArchetype: spec.anchor {x,y} required');
	}
	const comp = parts[0];
	const pins = comp.pins || [];
	if (!pins.length) throw new Error('densefanoutArchetype: component has no pins');
	const pinNets = nets.pinNets || {};
	const place = { [comp.designator]: { x: anchor.x, y: anchor.y, rot: 0, mirror: false } };
	const left = [], right = [], pts = [];
	for (const p of pins) {
		const world = toWorld(p.local, [anchor.x, anchor.y], 0, false);
		pts.push(world);
		const net = pinNets[String(p.num)];
		if (!net) continue;
		(p.local[0] >= 0 ? right : left).push({ num: p.num, world, net });
	}
	const frags = [...routeSide(right, 'right'), ...routeSide(left, 'left')];
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
