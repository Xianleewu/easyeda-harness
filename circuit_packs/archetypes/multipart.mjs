// 角色原型:多件簇模块。把模块内 N 个器件纵向堆叠,所有器件引脚并集用 densefanout 的
// 平面路由扇出到间隔标签列;模块内部网靠同名网标连通(EasyEDA 网名连通),无需显式内部连线。
import { toWorld } from '../../engine/transform.mjs';
import { wire, regionOf, mergeParts } from '../../engine/cell_helpers.mjs';
import { routeSide, routeEdge, classifyEdge, assertEscapable } from './densefanout.mjs';

const PART_GAP = 50;   // 件体间隙(按各件真实高度自适应堆叠)
const snap10 = v => Math.round(v / 10) * 10;

export function multipartArchetype(spec = {}) {
	const { parts, anchor, nets = {} } = spec;
	if (!Array.isArray(parts) || parts.length < 1) {
		throw new Error('multipartArchetype: spec.parts must be a non-empty array');
	}
	if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
		throw new Error('multipartArchetype: spec.anchor {x,y} required');
	}
	// place 以位号为键:重复位号会静默覆盖(后件冲掉前件、cursor 仍推进)→ 世界体重叠。
	// 显式化该前提,fail-closed 抛错。当前链 inferRoles 并查集分组保证 parts 位号唯一。
	const dup = new Set();
	for (const c of parts) {
		if (dup.has(c.designator)) throw new Error(`multipartArchetype: duplicate designator ${c.designator} in parts`);
		dup.add(c.designator);
	}
	const pinNets = nets.pinNets || {};   // 键 `${designator}.${num}`
	// 限界①修:把含底边脚的件排到栈底、含顶边脚的件排到栈顶(rank=底边脚−顶边脚,升序;稳定保序)
	// → 边脚总落栈端,routeEdge 竖直逃逸;否则非栈端件边脚 fall to routeSide(x 不在侧边)→ 交叉。
	const edgeRank = comp => {
		const lb = comp.localBox; if (!lb) return 0;
		let r = 0;
		for (const p of (comp.pins || [])) {
			if (!pinNets[`${comp.designator}.${p.num}`]) continue;
			const e = classifyEdge(p.local, lb);
			if (e === 'bottom') r++; else if (e === 'top') r--;
		}
		return r;
	};
	const ordered = parts.map((c, i) => [c, i]).sort((a, b) => (edgeRank(a[0]) - edgeRank(b[0])) || (a[1] - b[1])).map(x => x[0]);
	// 预分类各件【有网】顶/底边脚数(用于可变 gap):非栈端件的朝内顶/底边脚须进相邻层间间隙竖直逃逸,
	// 间隙须按朝内边脚数加宽(否则阶梯压到邻件)。无朝内边脚的件(常见,含真实板/左右脚 IC)gap 不变 → 行为不变。
	const ROW = 20;   // 镜像 densefanout ROW_PITCH(routeEdge 阶梯行距)
	const edgeCount = ordered.map(comp => {
		const lb = comp.localBox || { minX: -5, minY: -5, maxX: 5, maxY: 5 };
		let t = 0, b = 0;
		for (const p of (comp.pins || [])) {
			if (!pinNets[`${comp.designator}.${p.num}`]) continue;
			const ce = classifyEdge(p.local, lb);
			if (ce === 'top') t++; else if (ce === 'bottom') b++;
		}
		return { t, b };
	});
	const place = {};
	const left = [], right = [], botPins = [], topPins = [], inTop = [], inBot = [], pts = [];
	let cursorY = anchor.y;
	let stackBottom = anchor.y;
	const lastIdx = ordered.length - 1;
	ordered.forEach((comp, pi) => {
		const lb = comp.localBox || { minX: -5, minY: -5, maxX: 5, maxY: 5 };
		// 顶对齐:件顶(py+lb.maxY)= cursorY,不管锚在件内何处(连接器等锚非顶、向上延伸大的件,
		// 若按 py=cursorY 放会向上压到上一件)。任意异构件堆叠都防住重叠(任意图)。
		const px = anchor.x, py = snap10(cursorY - lb.maxY);
		place[comp.designator] = { x: px, y: py, rot: 0, mirror: false };
		stackBottom = Math.min(stackBottom, py + lb.minY);
		const partPins = [];
		for (const p of (comp.pins || [])) {
			const world = toWorld(p.local, [px, py], 0, false);
			pts.push(world);
			const net = pinNets[`${comp.designator}.${p.num}`];
			if (!net) continue;
			const e = { num: `${comp.designator}.${p.num}`, world, net };
			partPins.push(e);
			// 底/顶边引脚水平逃逸会横穿同排邻脚(wireThruPin)。栈底件底边/栈顶件顶边向外逃逸(外侧无件);
			// 中层件的朝内顶/底边脚走 inTop/inBot → 进相邻层间间隙竖直阶梯逃逸(routeEdge),不再误塞 routeSide。
			const edge = classifyEdge(p.local, lb);
			if (edge === 'bottom') { if (pi === lastIdx) botPins.push(e); else inBot.push({ ...e, pi }); }
			else if (edge === 'top') { if (pi === 0) topPins.push(e); else inTop.push({ ...e, pi }); }
			else (p.local[0] >= 0 ? right : left).push(e);
		}
		// 每件脚对自件世界体 fail-closed 检查(内部脚无正交逃逸 → 抛错让 planner 跳过)。
		assertEscapable(partPins, { minX: px + lb.minX, minY: py + lb.minY, maxX: px + lb.maxX, maxY: py + lb.maxY }, comp.designator);
		// 间隙加宽:本件朝内底边脚(pi<lastIdx)向下 + 下件朝内顶边脚向上,都进本层间间隙阶梯逃逸,
		// 各占 count×ROW;无朝内边脚则 gapExtra=0(gap 不变,行为同旧)。
		const gapExtra = pi < lastIdx ? (edgeCount[pi].b + edgeCount[pi + 1].t) * ROW : 0;
		cursorY = snap10(py + lb.minY - PART_GAP - gapExtra);   // 下一件顶 = 本件真实底 − gap(可变)
	});
	// 限界②修:不同宽件的同侧脚 world x 各异、喂给假设同 x 的 routeSide 会交叉。把各侧脚水平延伸
	// 到公共边 x(窄件补 stub 到最外件边缘),使喂入 routeSide 的同侧脚同 x。分层件不同 y、且同件
	// 同侧脚同 x,延伸 stub 不交叉任何脚。
	const alignStubs = [];
	const alignSide = (pins, edgeX) => {
		for (const e of pins) {
			if (Math.abs(e.world[0] - edgeX) > 0.5) {
				alignStubs.push({ wires: [wire('', [[e.world[0], e.world[1]], [edgeX, e.world[1]]])], flags: [] });
				e.world = [edgeX, e.world[1]];
			}
		}
	};
	if (left.length) alignSide(left, Math.min(...left.map(p => p.world[0])));
	if (right.length) alignSide(right, Math.max(...right.map(p => p.world[0])));
	const sideFrags = [...alignStubs, ...routeSide(right, 'right'), ...routeSide(left, 'left')];
	// 底/顶边引脚的标签降到侧布线之外(floor/ceil)以免碰撞(同 densefanout)。
	const sideYs = [];
	for (const fr of sideFrags) {
		for (const w of fr.wires || []) { const l = w.line || []; for (let i = 1; i < l.length; i += 2) sideYs.push(l[i]); }
		for (const f of fr.flags || []) sideYs.push(f.y);
	}
	const floorY = (sideYs.length ? Math.min(stackBottom, ...sideYs) : stackBottom) - PART_GAP;
	const ceilY = (sideYs.length ? Math.max(anchor.y, ...sideYs) : anchor.y) + PART_GAP;
	const splitSide = arr => [arr.filter(p => p.world[0] < anchor.x), arr.filter(p => p.world[0] >= anchor.x)];
	const [bL, bR] = splitSide(botPins);
	const [tL, tR] = splitSide(topPins);
	// 朝内边脚:逐件按侧分组,routeEdge 进相邻层间间隙(底边向下 vdir=-1、顶边向上 +1;clearY=null →
	// 从脚排起阶梯,gap 已加宽容纳,竖直逃逸避开同排脚 → 消 wireThruPin)。
	const groupBySide = arr => {
		const m = new Map();
		for (const e of arr) {
			const side = e.world[0] >= anchor.x ? 'right' : 'left';
			const k = `${e.pi}|${side}`;
			if (!m.has(k)) m.set(k, { side, list: [] });
			m.get(k).list.push(e);
		}
		return [...m.values()];
	};
	const inFrags = [];
	for (const g of groupBySide(inBot)) inFrags.push(...routeEdge(g.list, -1, g.side, null));
	for (const g of groupBySide(inTop)) inFrags.push(...routeEdge(g.list, 1, g.side, null));
	const frags = [
		...sideFrags,
		...routeEdge(bL, -1, 'left', floorY), ...routeEdge(bR, -1, 'right', floorY),
		...routeEdge(tL, 1, 'left', ceilY), ...routeEdge(tR, 1, 'right', ceilY),
		...inFrags,
	];
	const merged = mergeParts(...frags);
	return { place, wires: merged.wires, flags: merged.flags, noConnects: [], region: regionOf(pts, 20) };
}
