// 通用 live 网连通性验证-修复规划(零特定电路内容;netlist/snapshot 均作参数传入)。
//
// 用 EDA【权威网表】(sch_ManufactureData.getNetlistFile 的 .enet JSON)作真值,对【投递快照】几何做
// union-find,找出真断裂的多脚网(某组缺该网命名标签 → 与其余组不连通),给缺标签的组规划补一个
// 命名 netport(+短桩)。EDA 把同名 netport/标签视为同网 → 各组合并连通。锚点取【几何安全空位】
// (不入任一器件 bbox、不靠他端点)→ 不短路;找不到则跳过并计数。
//
//   import { planNetRepair, aggregateAuthNets } from './net_live_repair.mjs';
//   const nl = JSON.parse(await (await eda.sch_ManufactureData.getNetlistFile()).text());
//   const plan = planNetRepair(nl, liveSnapshot);
//   // plan.ops = [{ net, wireLine:[px,py,x,y], flagX, flagY, rot }] → 经 bridge:
//   //   createWire(wireLine, net) + createNetPort('BI', net, flagX, flagY, rot)
//
// 与 net_faithfulness(模型级、预防、recoverConnectivity 启发式)互补:本模块投递后用权威真值校正,
// 只修真断网、且操作 live 板。

// .enet → { netName: [ref,...] }(ref = "Designator.脚号")
export function aggregateAuthNets(netlist) {
	const nets = new Map();
	for (const c of Object.values((netlist && netlist.components) || {})) {
		const des = c.props && c.props.Designator;
		if (!des) continue;
		for (const [num, pi] of Object.entries(c.pinInfoMap || {})) {
			if (!pi || !pi.net) continue;
			const ref = `${des}.${num}`;
			if (!nets.has(pi.net)) nets.set(pi.net, []);
			nets.get(pi.net).push(ref);
		}
	}
	return nets;
}

export function planNetRepair(netlist, snapshot, opts = {}) {
	const TOL = opts.tol ?? 2.0, CLEAR = opts.clear ?? 12, BOXPAD = opts.boxPad ?? 8;
	const comps = (snapshot && snapshot.components) || [];
	const wires = (snapshot && snapshot.wires) || [];
	const flags = (snapshot && snapshot.netflags) || [];

	// terminals + 脚索引
	const terms = [], pinIdx = new Map(), compOf = new Map();
	for (const c of comps) for (const p of (c.pins || [])) {
		if (p.x == null) continue;
		const ref = `${c.designator}.${p.num ?? p.pinNumber}`;
		pinIdx.set(ref, terms.length); compOf.set(ref, c);
		terms.push({ x: p.x, y: p.y, ref });
	}
	const wireGroups = [];
	for (const w of wires) { const l = w.line || []; const g = []; for (let i = 0; i + 1 < l.length; i += 2) { g.push(terms.length); terms.push({ x: l[i], y: l[i + 1] }); } wireGroups.push(g); }
	for (const f of flags) terms.push({ x: f.x, y: f.y, flagNet: f.net });

	// union-find:线内点 + 触碰 + 同名标签
	const par = terms.map((_, i) => i);
	const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
	const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
	for (const g of wireGroups) for (let i = 1; i < g.length; i++) uni(g[i - 1], g[i]);
	const bucket = new Map();
	for (let i = 0; i < terms.length; i++) {
		const bx = Math.round(terms[i].x / TOL), by = Math.round(terms[i].y / TOL);
		for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
			const arr = bucket.get(`${bx + ox},${by + oy}`);
			if (arr) for (const j of arr) if (Math.abs(terms[i].x - terms[j].x) <= TOL && Math.abs(terms[i].y - terms[j].y) <= TOL) uni(i, j);
		}
		const k = `${bx},${by}`; if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i);
	}
	const fbn = new Map();
	for (let i = 0; i < terms.length; i++) if (terms[i].flagNet) { if (!fbn.has(terms[i].flagNet)) fbn.set(terms[i].flagNet, []); fbn.get(terms[i].flagNet).push(i); }
	for (const arr of fbn.values()) for (let i = 1; i < arr.length; i++) uni(arr[i - 1], arr[i]);

	// 安全位:背离器件中心,外向 + 两垂直,就近取不入 bbox / 不靠他端点者
	const boxes = comps.map(c => c.bbox).filter(Boolean);
	const inBox = (x, y) => boxes.some(b => x > b.minX - BOXPAD && x < b.maxX + BOXPAD && y > b.minY - BOXPAD && y < b.maxY + BOXPAD);
	const nearPt = (x, y) => { for (const t of terms) if (Math.abs(t.x - x) < CLEAR && Math.abs(t.y - y) < CLEAR) return true; return false; };
	const safeSpot = (ref) => {
		const t = terms[pinIdx.get(ref)], c = compOf.get(ref);
		const b = (c && c.bbox) || { minX: t.x, maxX: t.x, minY: t.y, maxY: t.y };
		const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
		const ox = t.x - cx, oy = t.y - cy;
		let odx, ody;
		if (Math.abs(ox) >= Math.abs(oy)) { odx = Math.sign(ox) || 1; ody = 0; } else { odx = 0; ody = Math.sign(oy) || 1; }
		const dirs = [[odx, ody], [ody, odx], [-ody, -odx]];
		for (let d = 20; d <= 140; d += 10) for (const [dx, dy] of dirs) {
			const x = t.x + dx * d, y = t.y + dy * d;
			if (!inBox(x, y) && !nearPt(x, y)) return { x, y, px: t.x, py: t.y };
		}
		return null;
	};

	const authNets = aggregateAuthNets(netlist);
	const ops = []; let broken = 0, planned = 0, unsafe = 0;
	for (const [net, refs0] of authNets) {
		const refs = refs0.filter(r => pinIdx.has(r));
		if (refs.length < 2) continue;
		const groupOf = new Map();
		for (const r of refs) { const root = find(pinIdx.get(r)); if (!groupOf.has(root)) groupOf.set(root, []); groupOf.get(root).push(r); }
		if (groupOf.size < 2) continue;
		broken++;
		for (const [root, grefs] of groupOf) {
			const hasFlag = terms.some((t, i) => t.flagNet === net && find(i) === root);
			if (hasFlag) continue;
			let done = false;
			for (const r of grefs) {
				const sp = safeSpot(r);
				if (!sp) continue;
				ops.push({ net, wireLine: [sp.px, sp.py, sp.x, sp.y], flagX: sp.x, flagY: sp.y, rot: 0 });
				planned++; done = true; break;
			}
			if (!done) unsafe++;
		}
	}
	return { broken, planned, unsafe, ops };
}
