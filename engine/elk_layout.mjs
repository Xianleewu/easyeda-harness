// ELK 自动布局引擎:用 elkjs(Eclipse Layout Kernel)做件放置(layered,左→右信号流,紧凑+功能分层),
// 再用本仓避障布线器 routeNets 画真实正交连线(绕开器件,无 wireThruComp),单脚 signal→标签、
// 电源/地→符号。取代旧"每件孤立成 cell + 标签汤"列布局——产出紧凑、连线清晰、商用可读的原理图。
//
// 关键:ELK 节点按"件体 + 标签/符号留白"加 pad,使 ELK 排布时为标签预留空间,标签落 pad 内不撞邻件。
// 引脚用 FIXED_POS(真实脚位,件体边缘),布线交给 routeNets(不用 ELK 连线,避免穿件)。
// 经验来源:netlistsvg/ELK(见记忆 elk-layout-direction)。
import ELK from 'elkjs';
import { classifyEdge } from '../circuit_packs/archetypes/densefanout.mjs';
import { routeNets } from './route_nets.mjs';

const GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;
const portId = (des, num) => `${des}::${num}`;
const labelLen = name => Math.max(40, String(name).length * 6 + 18);

const LABEL_PAD = 110;   // 有标签/符号侧的留白(容标签框 + 净空)
const EDGE_PAD = 14;     // 无标签侧的小留白
const LABEL_GAP = 24;    // 件边到标签桩端

const DEFAULT_OPTS = {
	'elk.algorithm': 'layered',
	'elk.direction': 'RIGHT',
	'elk.spacing.nodeNode': '40',
	'elk.layered.spacing.nodeNodeBetweenLayers': '90',
	'elk.layered.spacing.edgeNodeBetweenLayers': '30',
	'elk.routing.edgeRouting': 'ORTHOGONAL',
	'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
	'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
	'elk.layered.thoroughness': '20',
};

// 每脚角色:wire(多脚 signal,布线)/ label(单脚 signal)/ power / gnd / none。
function pinRoles(logical) {
	const role = new Map();
	for (const n of (logical.nets || [])) {
		const cnt = (n.pins || []).length;
		const r = n.class === 'ground' ? 'gnd' : n.class === 'power' ? 'power' : cnt >= 2 ? 'wire' : 'label';
		for (const s of (n.pins || [])) { const d = s.lastIndexOf('.'); role.set(portId(s.slice(0, d), s.slice(d + 1)), { role: r, net: n.name }); }
	}
	return role;
}

// 构建 ELK 图:节点 = 件体 + 各侧 label/符号留白;端口 FIXED_POS 落件体边;signal 多脚网→edge(仅指导分层)。
function buildGraph(snapshot, logical, byDes, roles, scale = true) {
	const children = [];
	const meta = new Map();   // designator → {lb, pad, compW, compH}
	for (const c of snapshot.components) {
		const wc = byDes.get(c.designator);
		const lb0 = wc.localBox;
		// 件缩放:使【带标签脚】同侧间距 ≥ ROW(容标签框,免叠压)。商用做法:IC 按脚标签拉高/拉宽。
		const ROW = 30;
		// 含 wire 脚:多脚网可能布线失败回退标签,故也按标签预留间距/留白,使回退标签落得下、不叠压。
		const lps = { left: [], right: [], top: [], bottom: [] };
		for (const p of (wc.pins || [])) { const r = roles.get(portId(c.designator, p.num)); if (r && (r.role === 'label' || r.role === 'wire')) lps[classifyEdge(p.local, lb0)].push(p.local); }
		const minGap = (arr, ax) => { const vs = arr.map(l => l[ax]).sort((a, b) => a - b); let m = Infinity; for (let i = 1; i < vs.length; i++) m = Math.min(m, vs[i] - vs[i - 1]); return m; };
		const gy = Math.min(minGap(lps.left, 1), minGap(lps.right, 1)), gx = Math.min(minGap(lps.top, 0), minGap(lps.bottom, 0));
		// scale=false(live 交付):件不缩放,保 EDA 固定符号尺寸,脚位与实际 EDA 脚一致(否则线接不上)。
		const sy = (scale && Number.isFinite(gy) && gy > 0 && gy < ROW) ? ROW / gy : 1;
		const sx = (scale && Number.isFinite(gx) && gx > 0 && gx < ROW) ? ROW / gx : 1;
		const cxL = (lb0.minX + lb0.maxX) / 2, cyL = (lb0.minY + lb0.maxY) / 2;
		const scLocal = l => [(l[0] - cxL) * sx + cxL, (l[1] - cyL) * sy + cyL];
		const lb = { minX: (lb0.minX - cxL) * sx + cxL, maxX: (lb0.maxX - cxL) * sx + cxL, minY: (lb0.minY - cyL) * sy + cyL, maxY: (lb0.maxY - cyL) * sy + cyL };
		const pinsLocal = (wc.pins || []).map(p => ({ num: p.num, local: scLocal(p.local) }));
		const compW = Math.max(20, lb.maxX - lb.minX), compH = Math.max(20, lb.maxY - lb.minY);
		// 各侧是否有标签/符号脚 + 该侧最长标签(用缩放后 pinsLocal/lb,口径一致)
		const need = { left: 0, right: 0, top: 0, bottom: 0 };
		for (const p of pinsLocal) {
			const r = roles.get(portId(c.designator, p.num)); if (!r) continue;
			const side = classifyEdge(p.local, lb);
			// label/wire(可能回退标签)留标签列宽;power/gnd 留符号宽。
			const len = (r.role === 'label' || r.role === 'wire') ? labelLen(r.net) + LABEL_GAP + 20 : 50;
			need[side] = Math.max(need[side], Math.max(LABEL_PAD, len));
		}
		// 底/顶密集竖排标签:脚≥4 且最终 pitch<20 → 2 行深错排,需额外留一行深(竖排标签长 ≈ labelLen)。
		for (const _side of ['top', 'bottom']) {
			const _arr = lps[_side];
			if (_arr.length < 2 || minGap(_arr, 0) * sx >= 20) continue;
			let _maxLen = 0;
			for (const _p of (wc.pins || [])) { const _r = roles.get(portId(c.designator, _p.num)); if (_r && classifyEdge(_p.local, lb0) === _side && (_r.role === 'label' || _r.role === 'wire')) _maxLen = Math.max(_maxLen, labelLen(_r.net)); }
			need[_side] = (need[_side] || LABEL_PAD) + _maxLen + 16;
		}
		const pad = {
			left: need.left || EDGE_PAD, right: need.right || EDGE_PAD,
			top: need.top || EDGE_PAD, bottom: need.bottom || EDGE_PAD,
		};
		const W = compW + pad.left + pad.right, H = compH + pad.top + pad.bottom;
		const ports = [];
		for (const p of pinsLocal) {
			ports.push({ id: portId(c.designator, p.num),
				x: (p.local[0] - lb.minX) + pad.left,            // 件体在 pad 内偏移(缩放后)
				y: (lb.maxY - p.local[1]) + pad.top });          // y 下翻
		}
		children.push({ id: c.designator, width: W, height: H, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } });
		meta.set(c.designator, { lb, pad, compW, compH });
	}
	const edges = [];
	let ei = 0;
	for (const n of (logical.nets || [])) {
		if (n.class !== 'signal' || (n.pins || []).length < 2) continue;
		const ps = (n.pins || []).map(s => { const d = s.lastIndexOf('.'); return portId(s.slice(0, d), s.slice(d + 1)); }).filter(id => meta.has(id.split('::')[0]));
		for (let i = 1; i < ps.length; i++) edges.push({ id: `e${ei++}`, sources: [ps[0]], targets: [ps[i]] });
	}
	return { graph: { id: 'root', layoutOptions: { ...DEFAULT_OPTS }, children, edges }, meta };
}

export async function elkLayout({ snapshot, logical, byDes, elk = new ELK(), layoutOptions = {}, scale = true }) {
	const roles = pinRoles(logical);
	const { graph, meta } = buildGraph(snapshot, logical, byDes, roles, scale);
	Object.assign(graph.layoutOptions, layoutOptions);
	const res = await elk.layout(graph);

	const FY = y => -y;
	const comps = [];
	const pinAbs = new Map();   // portId → {x,y,side,des}
	for (const c of res.children) {
		const m = meta.get(c.id);
		const nx = snap(c.x), ny = snap(c.y);
		// 件体边 snap 到栅,与【已 snap 的引脚位】一致(否则边脚落在体框内 2~5 格 → 标签桩擦体 wtc)。
		const cMinX = snap(nx + m.pad.left), cTopElk = snap(ny + m.pad.top);
		const cMaxX = snap(nx + m.pad.left + m.compW), cBotElk = snap(ny + m.pad.top + m.compH);
		const pins = [];
		for (const pt of (c.ports || [])) {
			const px = snap(nx + (pt.x || 0)), py = snap(ny + (pt.y || 0));
			const num = pt.id.split('::')[1];
			pins.push({ num, x: px, y: FY(py) });
			const side = classifyEdge([px - (cMinX + m.compW / 2) + (m.lb.minX + m.compW / 2), 0], m.lb); // 退回符号侧
			const realSide = px <= cMinX + 2 ? 'left' : px >= cMaxX - 2 ? 'right' : py <= cTopElk + 2 ? 'top' : 'bottom';
			pinAbs.set(pt.id, { x: px, y: FY(py), side: realSide, des: c.id });
		}
		comps.push({ designator: c.id, bbox: { minX: cMinX, minY: FY(cBotElk), maxX: cMaxX, maxY: FY(cTopElk) }, pins });
	}

	const obstacles = comps.map(c => ({ minX: c.bbox.minX - 6, minY: c.bbox.minY - 6, maxX: c.bbox.maxX + 6, maxY: c.bbox.maxY + 6 }));
	const escape = (p, d = 20) => p.side === 'left' ? [snap(p.x - d), p.y] : p.side === 'right' ? [snap(p.x + d), p.y] : p.side === 'top' ? [p.x, snap(p.y + d)] : [p.x, snap(p.y - d)];

	const wires = [], netflags = [];
	// 多脚 signal → 避障布线(星形)
	const segs = [];
	for (const n of (logical.nets || [])) {
		if (n.class !== 'signal' || (n.pins || []).length < 2) continue;
		const ids = (n.pins || []).map(s => { const d = s.lastIndexOf('.'); return portId(s.slice(0, d), s.slice(d + 1)); }).filter(id => pinAbs.has(id));
		if (ids.length < 2) continue;
		const a0 = pinAbs.get(ids[0]);
		for (let i = 1; i < ids.length; i++) segs.push({ net: n.name, pinA: a0, pinB: pinAbs.get(ids[i]) });
	}
	const routed = routeNets(segs.map(s => ({ a: escape(s.pinA), b: escape(s.pinB), net: s.net })), obstacles, { wireClearance: 2 });
	// 布线失败【或导线过长(跨图)】的网 → 整网回退【按名标签】(商用:远程信号用标签而非长线;
	// 长线还会横穿其他标签=L4)。保电气完整(同名标签 EDA 连通)。任一段触发则全网回退,避免半连。
	// 导线长上限:>此值的网回退标签。ELK_MAX_WIRE=0 → 全多脚网转标签(live 投递用:EDA 必合并相接
	// 路由线成乱序折线,改全网标=全短桩,无相接路由线=无乱)。PNG 渲染默认 560(留本地真实连线)。
	const MAX_WIRE = process.env.ELK_MAX_WIRE != null ? Number(process.env.ELK_MAX_WIRE) : 560;
	const failedNets = new Set();
	routed.forEach((r, i) => {
		if (!r.path) { failedNets.add(segs[i].net); return; }
		let len = 0; for (let k = 1; k < r.path.length; k++) len += Math.abs(r.path[k][0] - r.path[k - 1][0]) + Math.abs(r.path[k][1] - r.path[k - 1][1]);
		if (len > MAX_WIRE) failedNets.add(segs[i].net);
	});
	routed.forEach((r, i) => {
		if (!r.path || failedNets.has(segs[i].net)) return;
		const s = segs[i];
		const line = []; for (const [x, y] of [[s.pinA.x, s.pinA.y], ...r.path, [s.pinB.x, s.pinB.y]]) line.push(x, y);
		wires.push({ net: r.net, line });
	});

		// 底/顶密集竖排标签 → 2 行深错排:同件同侧(top/bottom)label 脚按 x 序交替分两行深度,
		// 把 10-pitch 横擦降为每行 20-pitch、相邻脚落不同 Y 带不擦。深桩各在独立 x、不交叉(几何安全)。
		const labelRole2 = id => { const r = roles.get(id); if (!r) return null; return (r.role === 'wire' && failedNets.has(r.net)) ? 'label' : r.role; };
		const rowByPin = new Map();
		{
			const groups = new Map();
			for (const [id, p] of pinAbs) {
				if ((p.side !== 'top' && p.side !== 'bottom') || labelRole2(id) !== 'label') continue;
				const k = p.des + '|' + p.side;
				if (!groups.has(k)) groups.set(k, []);
				groups.get(k).push({ id, net: roles.get(id).net, x: p.x });
			}
			for (const arr of groups.values()) {
				if (arr.length < 2) continue;
				arr.sort((a, b) => a.x - b.x);
				let minPitch = Infinity;
				for (let i = 1; i < arr.length; i++) minPitch = Math.min(minPitch, Math.abs(arr[i].x - arr[i - 1].x));
				if (minPitch >= 20) continue;
				const step = Math.max(...arr.filter((_, i) => i % 2 === 0).map(o => labelLen(o.net))) + 16;
				arr.forEach((o, i) => rowByPin.set(o.id, { row: i % 2, step }));
			}
		}

	// 左右侧 power/gnd 符号竖向堆叠(框高 ~20 > 脚距)→ 横向错排:同件同侧 gnd/power 脚
	// 按 y 序交替分两列(符号紧凑、非 sig,无 L9 长桩/L4 穿标风险),消竖向符号叠压。
	const pgCol = new Map();
	{
		const groups = new Map();
		for (const [id, p] of pinAbs) {
			if (p.side !== 'left' && p.side !== 'right') continue;
			const rr = roles.get(id); if (!rr || (rr.role !== 'power' && rr.role !== 'gnd')) continue;
			const k = p.des + '|' + p.side;
			if (!groups.has(k)) groups.set(k, []);
			groups.get(k).push({ id, y: p.y });
		}
		for (const arr of groups.values()) {
			if (arr.length < 2) continue;
			arr.sort((a, b) => b.y - a.y);
			let minPitch = Infinity;
			for (let i = 1; i < arr.length; i++) minPitch = Math.min(minPitch, Math.abs(arr[i].y - arr[i - 1].y));
			if (minPitch >= 22) continue;
			arr.forEach((o, i) => pgCol.set(o.id, i % 2));
		}
	}
	// 左右侧 power/gnd 若与 sig 标同侧 → 把符号移到该侧所有 sig 标之外(逃逸 += 最长 sig 标宽),
	// 使符号脱离信号标横带、不再压标。桩在 power/gnd 脚 y(邻 sig 标在别 y、框高 8 够不到)→ 无 L4。
	const sideMaxSig = new Map();
	for (const [id, p] of pinAbs) {
		if (p.side !== 'left' && p.side !== 'right') continue;
		const rr = roles.get(id); if (!rr) continue;
		const role2 = (rr.role === 'wire' && failedNets.has(rr.net)) ? 'label' : rr.role;
		if (role2 !== 'label') continue;
		const k = p.des + '|' + p.side;
		sideMaxSig.set(k, Math.max(sideMaxSig.get(k) || 0, labelLen(rr.net)));
	}
	// 单脚 signal → 列对齐标签;power/ground → 符号(均朝外逃逸,落 pad 内)
	for (const [id, p] of pinAbs) {
		const r = roles.get(id); if (!r) continue;
		// 布线失败的多脚网 → 该网各脚回退成标签(按名连通)。
		const role = (r.role === 'wire' && failedNets.has(r.net)) ? 'label' : r.role;
		const [ex, ey] = escape(p, LABEL_GAP);
		if (role === 'gnd') { const gc = pgCol.get(id) || 0; const sm = (p.side === 'left' || p.side === 'right') ? (sideMaxSig.get(p.des + '|' + p.side) || 0) : 0; const off = sm + gc * 40; const [gx, gy] = off ? escape(p, LABEL_GAP + off) : [ex, ey]; netflags.push({ kind: 'gnd', net: r.net, x: gx, y: gy, rot: 0 }); wires.push({ net: r.net, line: [p.x, p.y, gx, gy] }); }
		else if (role === 'power') { const pc = pgCol.get(id) || 0; const sm = (p.side === 'left' || p.side === 'right') ? (sideMaxSig.get(p.des + '|' + p.side) || 0) : 0; const off = sm + pc * 40; const [px2, py2] = off ? escape(p, LABEL_GAP + off) : [ex, ey]; netflags.push({ kind: 'power', net: r.net, x: px2, y: py2, rot: 0 }); wires.push({ net: r.net, line: [p.x, p.y, px2, py2] }); }
		else if (role === 'label') {
			// 左右脚→水平标签(文字朝外);上下脚→竖排标签(rot 90/270,窄框,密集横向不叠压)。
			// 上下脚标签逃逸距加大到 48(>总线深~20),让竖排标签落在总线之外,避总线穿标(L4)。
			if (p.side === 'left') { wires.push({ net: r.net, line: [p.x, p.y, ex, ey] }); netflags.push({ kind: 'sig', net: r.net, x: ex, y: ey, textX: ex, textY: ey, rot: 180, alignMode: 8 }); }
			else if (p.side === 'right') { wires.push({ net: r.net, line: [p.x, p.y, ex, ey] }); netflags.push({ kind: 'sig', net: r.net, x: ex, y: ey, textX: ex, textY: ey, rot: 0, alignMode: 6 }); }
			else { const rb = rowByPin.get(id); const [tx, ty] = escape(p, 48 + (rb ? rb.row * rb.step : 0)); wires.push({ net: r.net, line: [p.x, p.y, tx, ty] }); netflags.push({ kind: 'sig', net: r.net, x: tx, y: ty, textX: tx, textY: ty, rot: p.side === 'top' ? 90 : 270, alignMode: 2 }); }
		}
	}

	// placements(供 live 交付 buildSource):件原点 = 某脚绝对位 − 该脚原始本地位(scale=false 时脚位即真实)。
	const placements = comps.map(c => {
		const wc = byDes.get(c.designator);
		const p0 = (c.pins || [])[0];
		const wp0 = p0 && (wc.pins || []).find(p => String(p.num) === String(p0.num));
		const x = wp0 ? p0.x - wp0.local[0] : (c.bbox.minX + c.bbox.maxX) / 2;
		const y = wp0 ? p0.y - wp0.local[1] : (c.bbox.minY + c.bbox.maxY) / 2;
		return { designator: c.designator, x, y, rot: 0, mirror: false };
	});
	// 去重:同网同位的网标/符号叠放(多脚逃逸到同点 / snap 撞点)→ 保留一个。
	// 电气等价(各脚的桩仍汇于该点、经同点/同名连通),消 L3 同网同位叠压。
	const _seen = new Set();
	const _flags = [];
	for (const nf of netflags) {
		const k = nf.net + '|' + nf.x + '|' + nf.y;
		if (_seen.has(k)) continue;
		_seen.add(k);
		_flags.push(nf);
	}
	return { components: comps, wires, netflags: _flags, placements };
}

// CLI:node engine/elk_layout.mjs [snapshot.json] [out.png] — 合成并渲染,打印质量指标。
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('engine/elk_layout.mjs')) {
	const { readFileSync, writeFileSync } = await import('node:fs');
	const { extractLogical } = await import('./schematic_extract.mjs');
	const { withLocalPins } = await import('./transform.mjs');
	const { renderSheetOutput } = await import('./sheet_renderer.mjs');
	const { geomQC } = await import('./geom_qc.mjs');
	const { labelQC } = await import('./label_qc.mjs');
	const snapPath = process.argv[2] || 'live.json';
	const outPng = process.argv[3] || 'elk_sheet.png';
	const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
	const logical = extractLogical(snapshot);
	const byDes = new Map(snapshot.components.map(c => [c.designator, withLocalPins(c)]));
	const model = await elkLayout({ snapshot, logical, byDes });
	writeFileSync(outPng.replace(/\.png$/, '.model.json'), JSON.stringify(model), 'utf8');
	const g = geomQC(model);
	const lh = labelQC(model).filter(f => f.severity === 'hard');
	const bb = model.components.reduce((a, c) => ({ minX: Math.min(a.minX, c.bbox.minX), minY: Math.min(a.minY, c.bbox.minY), maxX: Math.max(a.maxX, c.bbox.maxX), maxY: Math.max(a.maxY, c.bbox.maxY) }), { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 });
	const { report } = renderSheetOutput(model, outPng);
	console.log(`ELK 布局: 件 ${model.components.length} 连线 ${model.wires.length} 标签/符号 ${model.netflags.length}`);
	console.log(`图纸 ${Math.round(bb.maxX - bb.minX)}×${Math.round(bb.maxY - bb.minY)}`);
	console.log(`geom: wireThruComp ${g.wireThruComp.length} wireThruPin ${g.wireThruPin.length} crossings ${g.crossings} overlaps ${g.overlaps.length} offgrid ${g.offgrid}`);
	console.log(`label hard: ${lh.length}`);
	console.log(`render: ${report.pass ? 'pass' : 'FAIL'} → ${outPng}`);
}
