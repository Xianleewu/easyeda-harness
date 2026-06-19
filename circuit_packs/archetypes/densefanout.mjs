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

// fail-closed:脚端点严格落在自体 bbox 内部(与 geomQC inset 1 同口径)时,
// 任何正交逃逸段都必穿自体(拓扑事实:点在实心矩形内,轴向路径出矩形必经内部)——
// 此类输入无解,抛错让 planner 跳过该模块,而非静默产出穿体几何拖垮整图几何门。
export function assertEscapable(sidePins, body, designator) {
	if (!body || ![body.minX, body.minY, body.maxX, body.maxY].every(Number.isFinite)) return;
	for (const p of sidePins) {
		const [x, y] = p.world;
		if (x > body.minX + 1 && x < body.maxX - 1 && y > body.minY + 1 && y < body.maxY - 1) {
			throw new Error(`densefanout ${designator}.${p.num} (${x},${y}) 在体内部、无正交逃逸 → fail-closed`);
		}
	}
}

export function routeSide(sidePins, side) {
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
	// 行 snap 到 ROW_PITCH 栅 + 侧相位(右 +10):左右行永不同 y → 跨侧同网不触 L10。
	const phase = side === 'right' ? 10 : 0;
	const snapRow = v => Math.round((v - phase) / ROW_PITCH) * ROW_PITCH + phase;
	let prevRow = Infinity;
	const rows = [];
	for (let i = 0; i < N; i++) {
		const py = pins[i].world[1];
		const r = snapRow(Math.min(py, prevRow - ROW_PITCH)); // 向下、≥ROW_PITCH
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

// 上/下边引脚:竖直逃逸(vdir -1 下 / +1 上)的阶梯,水平走到侧标签列(hside left/right,
// 复用 alignMode 6/8 侧标签,不触标签门旋转问题)。平面性:近标签侧者最浅,深者更靠外侧
// → 深线的竖直段不被浅线水平段挡、浅线竖直段不挡深线水平段(已推演无交叉)。
// edgeRef(可选):标签列外推的 x 基准下/上限。默认从引脚 x 算;multipart 朝内边脚的引脚在中心 x,
// 须传"栈最宽边 x"使标签越过整栈体外(否则标签落在堆叠件 x 阴影内 → L6 keepout)。densefanout 不传 → 行为不变。
export function routeEdge(pins, vdir, hside, clearY, edgeRef) {
	const frags = [];
	if (!pins.length) return frags;
	const hdir = hside === 'right' ? 1 : -1;
	// 近标签侧者最浅:按 x 朝标签侧降序(最靠标签侧的先)。
	const sorted = pins.slice().sort((a, b) => hdir > 0 ? b.world[0] - a.world[0] : a.world[0] - b.world[0]);
	// 深度从 clearY(侧边布线最低/高 y)之外起:底边引脚的竖直段在器件 x-阴影内(侧边布线
	// 都在器件外侧),标签降到 clearY 之外 → 不撞侧边布线、竖直段也清。无 clearY 退回引脚排。
	const pinRow = vdir < 0 ? Math.min(...pins.map(p => p.world[1])) : Math.max(...pins.map(p => p.world[1]));
	const rowY = clearY != null ? (vdir < 0 ? Math.min(pinRow, clearY) : Math.max(pinRow, clearY)) : pinRow;
	const labelLen = name => Math.max(40, String(name).length * 6 + 18);
	const maxLen = Math.max(...sorted.map(p => labelLen(p.net.name)));
	let edgeX = hdir > 0 ? Math.max(...pins.map(p => p.world[0])) : Math.min(...pins.map(p => p.world[0]));
	if (Number.isFinite(edgeRef)) edgeX = hdir > 0 ? Math.max(edgeX, edgeRef) : Math.min(edgeX, edgeRef);   // 标签越过整栈最宽边
	const labelX = snap10(edgeX + hdir * (maxLen + LABEL_GAP));   // snap 最终 labelX(非仅 edgeX)→ 与 routeSide 同 10-栅,L1 列对齐
	const preX = labelX - hdir * STUB;
	for (let i = 0; i < sorted.length; i++) {
		const [px, py] = sorted[i].world;
		const depthY = snap10(rowY) + vdir * (i + 1) * ROW_PITCH;   // 每条更深(离体更远),不与引脚排同 y
		// 无名:pin → 竖直逃逸到 depthY → 水平到 preX
		frags.push({ wires: [wire('', [[px, py], [px, depthY], [preX, depthY]])], flags: [] });
		// 短命名 stub + 侧标签
		frags.push({ wires: [wire(sorted[i].net.name, [[preX, depthY], [labelX, depthY]])], flags: [sigFlag(sorted[i].net.name, labelX, depthY, hside)] });
	}
	return frags;
}

// 按 localBox 最近边把引脚分到 left/right/bottom/top(优先左右,再上下;内部回退 x 符号)。
export function classifyEdge(local, lb, m = 2) {
	const [lx, ly] = local;
	if (lx <= lb.minX + m) return 'left';
	if (lx >= lb.maxX - m) return 'right';
	if (ly <= lb.minY + m) return 'bottom';
	if (ly >= lb.maxY - m) return 'top';
	return lx >= 0 ? 'right' : 'left';
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
	const lb = comp.localBox;
	const left = [], right = [], bottom = [], top = [], pts = [];
	for (const p of pins) {
		const world = toWorld(p.local, [anchor.x, anchor.y], 0, false);
		pts.push(world);
		const net = pinNets[String(p.num)];
		if (!net) continue;
		const entry = { num: p.num, world, net };
		// 有 localBox 时按真实边分类(修底/顶边引脚被误判左右、水平横穿引脚排的根因);
		// 无 localBox 退回 x 符号(老行为)。
		const edge = lb ? classifyEdge(p.local, lb) : (p.local[0] >= 0 ? 'right' : 'left');
		({ left, right, bottom, top })[edge].push(entry);
	}
	if (lb) {
		const body = { minX: anchor.x + lb.minX, minY: anchor.y + lb.minY, maxX: anchor.x + lb.maxX, maxY: anchor.y + lb.maxY };
		assertEscapable([...right, ...left], body, comp.designator);
	}
	// 先布左右侧,量其布线 y 范围:上/下边引脚的标签要降到侧边布线之外(floor/ceil)以免碰撞。
	const sideFrags = [...routeSide(right, 'right'), ...routeSide(left, 'left')];
	const sideYs = [];
	for (const fr of sideFrags) {
		for (const w of fr.wires || []) { const l = w.line || []; for (let i = 1; i < l.length; i += 2) sideYs.push(l[i]); }
		for (const f of fr.flags || []) sideYs.push(f.y);
	}
	const floorY = sideYs.length ? Math.min(...sideYs) - ROW_PITCH : null;
	const ceilY = sideYs.length ? Math.max(...sideYs) + ROW_PITCH : null;
	// 上/下边引脚按器件中心分左右标签侧,竖直阶梯逃逸(下边向下、上边向上)。
	const splitSide = arr => [arr.filter(p => p.world[0] < anchor.x), arr.filter(p => p.world[0] >= anchor.x)];
	const [bL, bR] = splitSide(bottom);
	const [tL, tR] = splitSide(top);
	// 顶/底边脚的引脚常在中心 x、落体内;标签列须以体边(含伸出脚的 localBox)为基准外推,否则
	// labelX 从中心算 → 标签落在宽体 x 阴影内(L6 keepout,尤其脚伸出体框时)。
	const bodyMaxX = lb ? anchor.x + lb.maxX : undefined;
	const bodyMinX = lb ? anchor.x + lb.minX : undefined;
	const frags = [
		...sideFrags,
		...routeEdge(bL, -1, 'left', floorY, bodyMinX), ...routeEdge(bR, -1, 'right', floorY, bodyMaxX),
		...routeEdge(tL, 1, 'left', ceilY, bodyMinX), ...routeEdge(tR, 1, 'right', ceilY, bodyMaxX),
	];
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
