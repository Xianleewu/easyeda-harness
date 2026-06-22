// 本地网直连布线(P0 执行级修复,通用,零特定电路内容)。
// recoverConnectivity 恢复的【本地网】(脚到脚直连、无标签)在重排后需【簇内正交直连】保连通
// (商用惯例:本地连接走线不打标签,标签只给跨模块信号)。本模块给已布局模型的本地网脚加 L 形直连。
//
//   import { routeLocalNets } from './local_net_route.mjs';
//   const n = routeLocalNets(model, localNets);   // model 已布局(脚带坐标);localNets=[{name,pins:[ref]}]
//
// 策略:① ref→坐标映射(从已布局 model.components)② 每本地网按近邻链式连接(最小化总线长)
//       ③ L 形正交角点选【不落器件 bbox】者 ④ 只连模型内可定位的脚(跨模块缺失脚跳过并计数)。

// L 角点二选一(H 先 / V 先):按【两段穿器件 bbox 数 + 角点落 bbox】打分,选最小;平手 H 先。
function lroute(x1, y1, x2, y2, segBad, inBox) {
	if (x1 === x2 || y1 === y2) return [x1, y1, x2, y2];   // 已正交
	const cA = [x2, y1], cB = [x1, y2];   // H 先 / V 先
	const sA = segBad(x1, y1, cA[0], cA[1]) + segBad(cA[0], cA[1], x2, y2) + (inBox(cA[0], cA[1]) ? 1 : 0);
	const sB = segBad(x1, y1, cB[0], cB[1]) + segBad(cB[0], cB[1], x2, y2) + (inBox(cB[0], cB[1]) ? 1 : 0);
	const c = sB < sA ? cB : cA;
	return [x1, y1, c[0], c[1], x2, y2];
}

export function routeLocalNets(model, localNets, opts = {}) {
	const WIRE_MAX = opts.wireMax ?? 200;   // 本地直连最长跨度;超过则改用命名标签对(商用远距连接标准,零 thru-pin/comp)
	const pos = new Map(), compOf = new Map();
	// 本地网用【EDA 实际脚位 _ax/_ay】(脚展开把 x/y 撑到缩放位、EDA 用符号原距 → 标签/直连建在 _ax/_ay 才接得上)。
	for (const c of (model.components || [])) for (const p of (c.pins || [])) if (p.x != null) { const ref = `${c.designator}.${p.num}`; pos.set(ref, { x: p._ax ?? p.x, y: p._ay ?? p.y }); compOf.set(ref, c); }
	const boxes = (model.components || []).map(c => c.bbox).filter(Boolean);
	const M = 1;
	const inBox = (x, y) => boxes.some(b => x > b.minX + M && x < b.maxX - M && y > b.minY + M && y < b.maxY - M);
	// 正交段穿器件 bbox 计数(端点在边沿的脚不算自体)。
	const segBad = (x1, y1, x2, y2) => { let n = 0; for (const b of boxes) {
		if (x1 === x2) { if (x1 > b.minX + M && x1 < b.maxX - M) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); if (lo < b.maxY - M && hi > b.minY + M) n++; } }
		else { if (y1 > b.minY + M && y1 < b.maxY - M) { const lo = Math.min(x1, x2), hi = Math.max(x1, x2); if (lo < b.maxX - M && hi > b.minX + M) n++; } } }
		return n; };
	// 已用网名(避免合成标签名碰撞)
	const usedNames = new Set();
	for (const w of (model.wires || [])) if (w.net) usedNames.add(w.net);
	for (const f of (model.netflags || [])) if (f.net) usedNames.add(f.net);
	let nameSeq = 0;
	const freshName = () => { let nm; do { nm = `N${++nameSeq}`; } while (usedNames.has(nm)); usedNames.add(nm); return nm; };
	// 在脚处朝【器件外】放信号网标 + 正交桩。桩伸到 bbox 外 + 余隙,alignMode 随方向(文字背离器件,避免压回本体)。
	const CLR = 16;   // 与 label_qc keepout 一致量级
	const labelPin = (ref, name) => {
		const p = pos.get(ref), c = compOf.get(ref);
		const b = (c && c.bbox) || { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y };
		const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, ddx = p.x - cx, ddy = p.y - cy;
		let fx, fy, align;
		if (Math.abs(ddx) >= Math.abs(ddy)) {   // 水平桩:文字向器件外侧展开
			if (ddx >= 0) { fx = Math.max(p.x + 20, b.maxX + CLR); fy = p.y; align = 6; }   // 右:alignMode6 文字 +x
			else { fx = Math.min(p.x - 20, b.minX - CLR); fy = p.y; align = 8; }   // 左:alignMode8 文字 -x
		} else {   // 垂直桩:伸到 bbox 上/下外,文字横向展开(在器件上/下方,不压本体)
			fx = p.x; fy = ddy >= 0 ? Math.max(p.y + 20, b.maxY + CLR) : Math.min(p.y - 20, b.minY - CLR); align = 6;
		}
		model.netflags = model.netflags || [];
		model.netflags.push({ kind: 'sig', net: name, x: fx, y: fy, textX: fx, textY: fy, rot: 0, alignMode: align });
		model.wires.push({ net: name, line: [p.x, p.y, fx, fy] });
	};
	let segs = 0, wired = 0, labeled = 0, skipped = 0;   // segs=直连线段数(added 兼容),wired/labeled=本地网条数
	for (const ln of (localNets || [])) {
		const pts = (ln.pins || []).map(r => ({ r, p: pos.get(r) })).filter(o => o.p);
		if (pts.length < 2) { if ((ln.pins || []).length >= 2) skipped++; continue; }   // 部分脚不在模型内(跨模块)→跳过
		// 跨度:超阈值的本地网用命名标签(散落器件直连会跨层穿脚/穿件;标签=商用远距标准、零 thru)
		let span = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) span = Math.max(span, Math.abs(pts[i].p.x - pts[j].p.x) + Math.abs(pts[i].p.y - pts[j].p.y));
		if (span > WIRE_MAX) { const nm = freshName(); for (const o of pts) labelPin(o.r, nm); labeled++; continue; }
		// 近 → 近邻链式短线直连(贪心 MST 近似,最小化线长)
		pts.sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y);
		const used = new Set([0]);
		let cur = 0;
		for (let step = 1; step < pts.length; step++) {
			let best = -1, bd = 1e18;
			for (let j = 0; j < pts.length; j++) { if (used.has(j)) continue; const d = Math.abs(pts[cur].p.x - pts[j].p.x) + Math.abs(pts[cur].p.y - pts[j].p.y); if (d < bd) { bd = d; best = j; } }
			if (best < 0) break;
			const a = pts[cur].p, b = pts[best].p;
			if (a.x !== b.x || a.y !== b.y) { model.wires.push({ net: opts.label ? ln.name : '', line: lroute(a.x, a.y, b.x, b.y, segBad, inBox) }); segs++; }   // 重合脚已连通,跳过零长线
			used.add(best); cur = best;
		}
		wired++;
	}
	return { added: segs, segs, wired, labeled, skipped };
}
