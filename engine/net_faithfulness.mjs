// 通用网连通性修复(零特定电路内容)。
//
// 问题:布局把一个逻辑网的脚分散到多个【几何组】(如跨模块网一侧内联消化、另一侧打了标签),
//       两组靠 EDA 名合并连通——但若某组【没有该网的命名标签】,该组就与其余组断开(真断网)。
// 方案:装配后做几何 union-find,对每个【裂成 >1 组】的逻辑网,给【缺该网标签】的组补一个命名标签。
//       EDA 把所有同名标签视为同网 → 各组合并连通。标签锚点放在【验证过的安全空位】
//       (不落任何器件 bbox、不靠近他网端点)→ 不产生短路。找不到安全位则跳过并计数(宁缺勿错)。
//
//   import { repairNetFaithfulness } from './net_faithfulness.mjs';
//   const r = repairNetFaithfulness(model, logical.nets);   // 原地改 model.wires/netflags
//   // r = { splitNets, repaired, unsafe, groupsFixed }
//
// 设计要点:
//   - 脚位用 _ax/_ay(EDA 实际脚位,脚展开把 x/y 撑到缩放位、桥接线 _ax→x 才是真连接起点)。
//   - 只修【真断裂】的网(单组网不动),且只补【缺标签】的组(已有标签的组不动)→ 最小侵入。
//   - 安全位:背离器件中心的主轴方向外推,逐距试,落点不入任何 bbox(含余隙)、10px 内无他端点。

const flagForSide = (net, x, y, dx, dy) => {
	// 标签朝器件外:水平桩用 alignMode 6/8(文字 ±x),竖直桩用 alignMode 2(文字横展,在器件上/下)。
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0
			? { kind: 'sig', net, x, y, textX: x, textY: y, rot: 0, alignMode: 6 }
			: { kind: 'sig', net, x, y, textX: x, textY: y, rot: 180, alignMode: 8 };
	}
	return { kind: 'sig', net, x, y, textX: x, textY: y, rot: dy >= 0 ? 90 : 270, alignMode: 2 };
};

export function repairNetFaithfulness(model, logicalNets, opts = {}) {
	const TOL = opts.tol ?? 2.0;          // 端点触碰阈值
	const CLEAR = opts.clear ?? 10;       // 安全位与他端点最小间距
	const BOXPAD = opts.boxPad ?? 8;      // 安全位与 bbox 余隙
	const comps = model.components || [];
	const wires = model.wires || (model.wires = []);
	const flags = model.netflags || (model.netflags = []);

	// 1) terminals:脚(用 _ax/_ay)+ 线点 + 标签点
	const terms = [];                     // {x,y,ref?,flagNet?}
	const pinIdx = new Map();             // ref -> term index
	const compOf = new Map();             // ref -> component
	for (const c of comps) {
		for (const p of (c.pins || [])) {
			if (p.x == null) continue;
			const ref = `${c.designator}.${p.num}`;
			pinIdx.set(ref, terms.length); compOf.set(ref, c);
			terms.push({ x: p._ax ?? p.x, y: p._ay ?? p.y, ref });
		}
	}
	const wireGroups = [];
	for (const w of wires) {
		const l = w.line || []; const g = [];
		for (let i = 0; i + 1 < l.length; i += 2) { g.push(terms.length); terms.push({ x: l[i], y: l[i + 1] }); }
		wireGroups.push(g);
	}
	for (const f of flags) terms.push({ x: f.x, y: f.y, flagNet: f.net });

	// 2) union-find:线内点连通 + 触碰 + 同名标签合并
	const par = terms.map((_, i) => i);
	const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
	const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
	for (const g of wireGroups) for (let i = 1; i < g.length; i++) uni(g[i - 1], g[i]);
	// 触碰:网格分桶 O(n) 近邻(桶边长 = TOL,查 3x3 邻桶)
	const bucket = new Map();
	const bkey = (x, y) => `${Math.round(x / TOL)},${Math.round(y / TOL)}`;
	for (let i = 0; i < terms.length; i++) {
		const bx = Math.round(terms[i].x / TOL), by = Math.round(terms[i].y / TOL);
		for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
			const arr = bucket.get(`${bx + ox},${by + oy}`);
			if (arr) for (const j of arr) if (Math.abs(terms[i].x - terms[j].x) <= TOL && Math.abs(terms[i].y - terms[j].y) <= TOL) uni(i, j);
		}
		const k = bkey(terms[i].x, terms[i].y); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i);
	}
	const flagByNet = new Map();
	for (let i = 0; i < terms.length; i++) if (terms[i].flagNet) { if (!flagByNet.has(terms[i].flagNet)) flagByNet.set(terms[i].flagNet, []); flagByNet.get(terms[i].flagNet).push(i); }
	for (const arr of flagByNet.values()) for (let i = 1; i < arr.length; i++) uni(arr[i - 1], arr[i]);

	// 3) bbox 表 + 安全位判定
	const boxes = comps.map(c => c.bbox).filter(Boolean);
	const inBox = (x, y) => boxes.some(b => x > b.minX - BOXPAD && x < b.maxX + BOXPAD && y > b.minY - BOXPAD && y < b.maxY + BOXPAD);
	const nearOther = (x, y) => {
		for (const t of terms) if (Math.abs(t.x - x) < CLEAR && Math.abs(t.y - y) < CLEAR) return true;
		return false;
	};
	const safeSpots = (ref) => {
		const t = terms[pinIdx.get(ref)], c = compOf.get(ref);
		const b = (c && c.bbox) || { minX: t.x, maxX: t.x, minY: t.y, maxY: t.y };
		const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
		const ox = t.x - cx, oy = t.y - cy;   // 外向量
		let odx, ody;
		if (Math.abs(ox) >= Math.abs(oy)) { odx = Math.sign(ox) || 1; ody = 0; } else { odx = 0; ody = Math.sign(oy) || 1; }
		const dirs = [[odx, ody], [ody, odx], [-ody, -odx]];   // 外向 + 两垂直
		const cands = [];                     // 就近优先:外层 d 升序,每距试三方向
		for (let d = 28; d <= 200; d += 14) for (const [dx, dy] of dirs) {
			const x = t.x + dx * d, y = t.y + dy * d;
			if (inBox(x, y) || nearOther(x, y)) continue;   // 几何安全:不入 bbox、不靠他端点(防锚落他网=短路)
			cands.push({ x, y, dx, dy, sx: t.x, sy: t.y });
		}
		return cands;
	};

	// 4) 每逻辑网:裂成 >1 组 → 给缺标签的组补命名标签。每落一标签即 labelQC/geomQC 校验,
	//    不增硬标签/短路才保留,否则撤销试下一候选;全候选不过则跳过该组(宁缺勿引入冲突)。
	let splitNets = 0, repaired = 0, unsafe = 0, groupsFixed = 0;
	let baseLh = opts.lh ? opts.lh() : 0, baseGeo = opts.geo ? opts.geo() : 0;
	const okPlace = () => (!opts.lh || opts.lh() <= baseLh) && (!opts.geo || opts.geo() <= baseGeo);
	for (const net of (logicalNets || [])) {
		const pins = (net.pins || []).filter(r => pinIdx.has(r));
		if (pins.length < 2) continue;
		const groupOf = new Map();         // root -> [refs]
		for (const r of pins) { const root = find(pinIdx.get(r)); if (!groupOf.has(root)) groupOf.set(root, []); groupOf.get(root).push(r); }
		if (groupOf.size < 2) continue;    // 已连通
		splitNets++;
		let fixedThis = false;
		for (const [root, refs] of groupOf) {
			const hasFlag = terms.some((tt, ti) => tt.flagNet === net.name && find(ti) === root);
			if (hasFlag) continue;         // 该组已有该网标签 → 名合并已能接上
			let placed = false;
			for (const r of refs) {
				for (const sp of safeSpots(r)) {
					wires.push({ net: net.name, line: [sp.sx, sp.sy, sp.x, sp.y] });
					flags.push(flagForSide(net.name, sp.x, sp.y, sp.dx, sp.dy));
					if (okPlace()) { groupsFixed++; placed = true; fixedThis = true; baseLh = opts.lh ? opts.lh() : 0; baseGeo = opts.geo ? opts.geo() : 0; break; }
					wires.pop(); flags.pop();   // 该候选增冲突/短路 → 撤销
				}
				if (placed) break;
			}
			if (!placed) unsafe++;
		}
		if (fixedThis) repaired++;
	}
	return { splitNets, repaired, unsafe, groupsFixed };
}
