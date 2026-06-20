// 裸网表 → 商业级模块化原理图生成(2026-06-20 突破,见记忆 tool-degrades-good-layouts)。
// 用于【无好布局的输入】(裸网表 / 散乱图):自动功能聚类 + 两级 ELK + 块框标题,产功能块模块图。
// 与 preserve_deliver(保留已有好布局)互补:assessLayout 差 → 走本生成路径。
//
//   node engine/cluster_generate.mjs [snapshot.json] [out.png]
//
// 关键:绕开 extractLogical 的快照碎片化(无名线 union 失败 → N$ 标签汤),
// buildCleanLogical 只从【有名连线 + 电源/地标】匹配引脚构网 → 精确网表、NC脚不标。
import { withLocalPins } from './transform.mjs';
import { elkLayout } from './elk_layout.mjs';
import { labelQC } from './label_qc.mjs';
import { geomQC } from './geom_qc.mjs';
import { netflagCreateRotation } from './preserve_deliver.mjs';

// 标签去冲突(opt-in,较慢):贪心把叠压网标移开——【向外:沿 escape 轴直桩延】或
// 【垂直:L 形桩(pin→原escape→新位)】,逐个试,仅当 labelHard 严格下降且【短路=0、交叉不增】
// 才保留(验证式,零回归)。实测 vibe-buddy scale=false:labelHard 7→2(71%消除)。
// naive 整体移会回归,故用贪心验证式逐步。
function deconflictLabels(model) {
	const lh = m => labelQC(m).filter(f => f.severity === 'hard').length;
	const geo = m => { const g = geomQC(m); return { sh: g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length, cr: g.crossings }; };
	const dirOf = f => (f.alignMode === 8 || f.rot === 180) ? [-1, 0] : (f.alignMode === 6 || f.rot === 0) ? [1, 0] : (f.rot === 90) ? [0, 1] : (f.rot === 270) ? [0, -1] : null;
	const stubOf = (m, f) => m.wires.find(w => { const l = w.line; return Math.abs(l[l.length - 2] - f.x) < 2 && Math.abs(l[l.length - 1] - f.y) < 2; });
	for (let pass = 0; pass < 16; pass++) {
		const hard = labelQC(model).filter(f => f.severity === 'hard');
		const base = hard.length; if (base === 0) break; const bg = geo(model);
		// 性能:只对【参与叠压的网】的网标试移(非全部 85),~10x 加速、效果不变。
		const hot = new Set(hard.flatMap(f => Array.isArray(f.where) ? f.where : (f.where && f.where.net ? [f.where.net] : [])));
		let best = null;
		for (const f of model.netflags) {
			if (!hot.has(f.net)) continue;
			const dir = dirOf(f); if (!dir) continue; const stub = stubOf(model, f); if (!stub) continue;
			const perp = dir[0] !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
			const cands = [...[24, 48, 72].map(s => ({ mode: 'out', dx: dir[0] * s, dy: dir[1] * s })), ...perp.flatMap(p => [24, 40].map(s => ({ mode: 'L', dx: p[0] * s, dy: p[1] * s })))];
			for (const c of cands) {
				const ox = f.x, oy = f.y, otx = f.textX, oty = f.textY, ol = stub.line.slice();
				const px = stub.line[0], py = stub.line[1];
				f.x += c.dx; f.y += c.dy; if (f.textX != null) f.textX += c.dx; if (f.textY != null) f.textY += c.dy;
				stub.line = c.mode === 'out' ? [px, py, f.x, f.y] : [px, py, ox, oy, f.x, f.y];
				const nl = lh(model), ng = geo(model);
				if (nl < base && ng.sh === 0 && ng.cr <= bg.cr && (!best || nl < best.nl)) best = { f, c, px, py, ox, oy };
				f.x = ox; f.y = oy; f.textX = otx; f.textY = oty; stub.line = ol;
			}
		}
		if (!best) break;
		const { f, c, px, py, ox, oy } = best; const stub = stubOf(model, f);
		f.x += c.dx; f.y += c.dy; if (f.textX != null) f.textX += c.dx; if (f.textY != null) f.textY += c.dy;
		stub.line = c.mode === 'out' ? [px, py, f.x, f.y] : [px, py, ox, oy, f.x, f.y];
	}
	return model;
}

// 从快照的有名连线 + 电源/地标构建干净逻辑网表(引脚按坐标匹配连线顶点/标位)。
// NC 脚(不在任何有名网)不入网 → 生成时不标注(避免标签汤)。
export function buildCleanLogical(snap, tol = 5) {
	const comps = snap.components || [], wires = snap.wires || [], flags = snap.netflags || [];
	const pinAt = [];
	for (const c of comps) for (const p of (c.pins || [])) if (p.x != null) pinAt.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y });
	const near = (ax, ay, bx, by) => Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;
	const netPins = new Map();
	const addPinNet = (net, x, y) => { for (const p of pinAt) if (near(x, y, p.x, p.y)) { if (!netPins.has(net)) netPins.set(net, new Set()); netPins.get(net).add(p.ref); } };
	for (const w of wires) { if (!w.net || !w.net.trim()) continue; const l = w.line || []; for (let i = 0; i + 1 < l.length; i += 2) addPinNet(w.net, l[i], l[i + 1]); }
	for (const f of flags) { if (f.net) addPinNet(f.net, f.x, f.y); }
	// 电源/地网分类:地名(GND/VSS/AGND/DGND/PGND);电源含常见命名轨(VCC/VDD/VBUS/VIN/VOUT/
	// VBAT/VSYS/AVDD/DVDD/VDDA…)、+ 前缀、及电压数字模式(5V/3V3/1V8/12V)。VDD 是最常见电源名之一,
	// 早先正则漏了它 → VDD 被当信号 → 其去耦电容不被识别而掉件(2026-06-20 修)。
	const classOf = n => /^(GND|VSS|AGND|DGND|PGND)/i.test(n) ? 'ground'
		: (/^(VBUS|VCC|VDD|VIN|VOUT|VBAT|VSYS|VPP|VEE|AVDD|DVDD|VDDA|VAA|BL_|\+)/i.test(n) || /^\d+V/i.test(n)) ? 'power'
		: 'signal';
	const nets = [...netPins.entries()].map(([name, pins]) => ({ name, class: classOf(name), pins: [...pins] }));
	return { nets };
}

// 功能聚类:IC/连接器(U/FPC/J)为锚点;其余件按【共享 signal 网】最多归属,
// 无 signal 关联(去耦电容等)按【非GND电源网 + 负载均衡】分配,兜底分到共享任意电源网的锚点。
export function clusterComponents(snap, logical) {
	const comps = snap.components || [];
	const isIC = d => /^(U|FPC|J)/.test(d);
	const anchors = comps.map(c => c.designator).filter(isIC);
	if (!anchors.length) return null;
	const sigNets = new Map(), pgNets = new Map();
	for (const n of logical.nets) { const m = n.class === 'signal' ? sigNets : pgNets; for (const ref of n.pins) { const d = ref.slice(0, ref.lastIndexOf('.')); if (!m.has(d)) m.set(d, new Set()); m.get(d).add(n.name); } }
	const aSig = new Map(anchors.map(a => [a, sigNets.get(a) || new Set()]));
	const aPG = new Map(anchors.map(a => [a, pgNets.get(a) || new Set()]));
	const load = new Map(anchors.map(a => [a, 0]));
	const cluster = new Map(anchors.map(a => [a, [a]]));
	for (const c of comps) {
		const d = c.designator; if (isIC(d)) continue;
		const ms = sigNets.get(d) || new Set(), mp = pgNets.get(d) || new Set();
		let best = null, bs = 0;
		for (const a of anchors) { let s = 0; for (const nn of ms) if (aSig.get(a).has(nn)) s++; if (s > bs) { bs = s; best = a; } }
		if (!best) { let cand = anchors.filter(a => { for (const nn of mp) if (aPG.get(a).has(nn) && !/^GND/i.test(nn)) return true; return false; }); if (cand.length) { cand.sort((x, y) => load.get(x) - load.get(y)); best = cand[0]; } }
		if (!best) { let cand = anchors.filter(a => { for (const nn of mp) if (aPG.get(a).has(nn)) return true; return false; }); if (!cand.length) cand = anchors.slice(); cand.sort((x, y) => load.get(x) - load.get(y)); best = cand[0]; }
		cluster.get(best).push(d); load.set(best, load.get(best) + 1);
	}
	return cluster;
}

// 确定性 schematic-aware 簇布局(2026-06-20 突破,远胜 ELK 图布局):IC 居中,信号脚→网标(左进右出),
// 串联/上拉电阻内联在信号脚外、再接对端网标/flag,去耦电容在电源脚旁成竖直去耦带([VDD]—C—[GND])。
// ELK 不懂"去耦贴电源脚",无源件经高扇出电源网/跨簇标签→无簇内边→散布成空旷大框(实证 gen_netlist vs gen_placer)。
// 返回 {components,wires,netflags,placements}(局部坐标;placements 供 live 投递移件)。fallback 保证不掉件。
export function layoutClusterTemplate(anchor, members, ctx) {
	const { compByDes, pinNet } = ctx;
	const netOf = ref => pinNet.get(ref);
	const ic = withLocalPins(compByDes.get(anchor));
	const cx = ic.x != null ? ic.x : (ic.bbox ? (ic.bbox.minX + ic.bbox.maxX) / 2 : 0);
	const cy = ic.y != null ? ic.y : (ic.bbox ? (ic.bbox.minY + ic.bbox.maxY) / 2 : 0);
	const out = { components: [{ ...ic }], wires: [], netflags: [], placements: [{ designator: anchor, x: ic.x, y: ic.y, rot: ic.rotation || 0, mirror: !!ic.mirror }] };
	const used = new Set([anchor]);
	const STUB = 30, PASS = 40, ROWC = 90, FLAGV = 18;   // ROWC=去耦带行距(电容含上下符号跨度~60,需≥76 防相邻符号叠压)
	const isPass = d => /^[CRL]/.test(d) || /^Y/.test(d);
	const isDecoup = d => { const c = compByDes.get(d); return /^C/.test(d) && c && (c.pins || []).length === 2 && c.pins.every(p => { const nn = netOf(`${d}.${p.num}`); return nn && (nn.class === 'power' || nn.class === 'ground'); }); };
	// 引脚真实边:优先合法 p.side,否则按【到 bbox 四边的最近距离】判定(aspect-aware,对高/宽 IC 都对;
	// 早先用 |dx|/|dy| 对高 IC 的右侧上部脚会误判成 top → 内联失效掉到 fallback 浮空,2026-06-20 修)。
	const bb = ic.bbox || { minX: cx, maxX: cx, minY: cy, maxY: cy };
	const inferEdge = p => { const dL = Math.abs(p.x - bb.minX), dR = Math.abs(p.x - bb.maxX), dT = Math.abs(p.y - bb.minY), dB = Math.abs(p.y - bb.maxY); const m = Math.min(dL, dR, dT, dB); return m === dL ? 'left' : m === dR ? 'right' : m === dT ? 'top' : 'bottom'; };
	const sideOf = p => { const s = (p.side || '').toString().toLowerCase(); return /^l/.test(s) ? 'left' : /^r/.test(s) ? 'right' : /^t/.test(s) ? 'top' : /^b/.test(s) ? 'bottom' : inferEdge(p); };
	const dirOf = s => s === 'left' ? [-1, 0] : s === 'right' ? [1, 0] : s === 'top' ? [0, -1] : [0, 1];
	// 信号网标按边朝向(rot/alignMode 对齐 elk_layout 约定:左180/8、右0/6、上90/2、下270/2)。
	const sigFlag = (net, x, y, s) => s === 'left' ? { kind: 'sig', net, x, y, textX: x, textY: y, rot: 180, alignMode: 8 }
		: s === 'right' ? { kind: 'sig', net, x, y, textX: x, textY: y, rot: 0, alignMode: 6 }
		: { kind: 'sig', net, x, y, textX: x, textY: y, rot: s === 'top' ? 90 : 270, alignMode: 2 };
	const pgCount = {};   // 每边电源/地 flag 计数,用于交错(相邻同边电源/地脚 flag 叠压时错开)。
	for (const p of ic.pins) {
		const nn = netOf(`${anchor}.${p.num}`);
		if (!nn) continue;
		const s = sideOf(p), [dx, dy] = dirOf(s), lr = (s === 'left' || s === 'right');
		const ex = p.x + dx * STUB, ey = p.y + dy * STUB;
		if (nn.class === 'signal') {
			// 该信号脚连接的簇内非去耦 2 脚无源件(串联/上拉/分压/RC);仅左右脚内联(顶/底脚给标签)。
			// 多件同脚(如反馈分压 R1→VOUT + R2→GND)用【节点 rail】:脚→节点,各件竖直分支,均接节点(=同电气节点)。
			const conns = lr ? members.filter(d => d !== anchor && !used.has(d) && isPass(d) && !isDecoup(d) && (() => { const c = compByDes.get(d); if ((c.pins || []).length !== 2) return false; const nets = c.pins.map(pp => netOf(`${d}.${pp.num}`)); return nets.some(x => x && x.name === nn.name) && nets.some(x => x && x.name !== nn.name); })()) : [];
			if (conns.length) {
				const nodeX = p.x + dx * STUB;
				out.wires.push({ net: nn.name, line: [p.x, p.y, nodeX, ey] });
				conns.forEach((series, i) => {
					const ry = ey + i * 34;
					if (i > 0) out.wires.push({ net: nn.name, line: [nodeX, ey, nodeX, ry] });   // 沿 rail 下延到本件行
					const c = compByDes.get(series);
					const tp = c.pins.find(pp => { const x = netOf(`${series}.${pp.num}`); return x && x.name === nn.name; });
					const op = c.pins.find(pp => pp !== tp);
					const on = netOf(`${series}.${op.num}`);
					const rx = nodeX + dx * (6 + PASS / 2);
					out.components.push({ designator: series, x: rx, y: ry, rotation: 0, mirror: false, bbox: { minX: rx - PASS / 2, minY: ry - 6, maxX: rx + PASS / 2, maxY: ry + 6 }, pins: [{ num: tp.num, x: rx - dx * PASS / 2, y: ry }, { num: op.num, x: rx + dx * PASS / 2, y: ry }] });
					out.placements.push({ designator: series, x: rx, y: ry, rot: 0, mirror: false });
					out.wires.push({ net: nn.name, line: [nodeX, ry, rx - dx * PASS / 2, ry] });
					const ax = rx + dx * (PASS / 2 + STUB);
					out.wires.push({ net: on ? on.name : '', line: [rx + dx * PASS / 2, ry, ax, ry] });
					if (on && (on.class === 'power' || on.class === 'ground')) out.netflags.push({ kind: on.class === 'ground' ? 'gnd' : 'power', net: on.name, x: ax, y: ry, rot: 0 });
					else out.netflags.push(sigFlag(on ? on.name : '', ax, ry, s));
					used.add(series);
				});
				continue;
			}
			out.wires.push({ net: nn.name, line: [p.x, p.y, ex, ey] });
			out.netflags.push(sigFlag(nn.name, ex, ey, s));
		} else {
			// 电源/地脚:flag 外延;相邻同边电源/地脚交错外延距离(28),避免 flag 符号叠压。
			const pc = (pgCount[s] = (pgCount[s] || 0) + 1);
			const esc = STUB + ((pc - 1) % 2) * 28;
			const fx2 = p.x + dx * esc, fy2 = p.y + dy * esc;
			out.wires.push({ net: nn.name, line: [p.x, p.y, fx2, fy2] });
			out.netflags.push({ kind: nn.class === 'ground' ? 'gnd' : 'power', net: nn.name, x: fx2, y: fy2, rot: 0 });
		}
	}
	// 去耦电容:专用竖直去耦带,放在 IC 块【最左侧】(避开所有信号标签),各 [VDD]—C—[GND]。
	// 不再贴具体电源脚(四边脚 IC 的顶部电源脚会与左侧信号标签冲突)——独立去耦列是通用商业惯例。
	const caps = members.filter(d => d !== anchor && !used.has(d) && isDecoup(d));
	if (caps.length) {
		let minX = ic.bbox ? ic.bbox.minX : cx;
		for (const f of out.netflags) minX = Math.min(minX, f.x);
		for (const c of out.components) if (c.bbox) minX = Math.min(minX, c.bbox.minX);
		const bx = minX - 80; let by = (ic.bbox ? ic.bbox.minY : cy) + 10;
		for (const d of caps) {
			const c = compByDes.get(d);
			const p1 = c.pins[0], p2 = c.pins[1];
			const n1 = netOf(`${d}.${p1.num}`), n2 = netOf(`${d}.${p2.num}`);
			const pwrNum = (n1 && n1.class === 'power') ? p1.num : p2.num, pwrName = (n1 && n1.class === 'power') ? n1.name : (n2 ? n2.name : 'VDD');
			const gndNum = pwrNum === p1.num ? p2.num : p1.num, gndName = (netOf(`${d}.${gndNum}`) || {}).name || 'GND';
			const top = by, bot = by + 24;
			out.components.push({ designator: d, x: bx, y: (top + bot) / 2, rotation: 90, mirror: false, bbox: { minX: bx - 8, minY: top, maxX: bx + 8, maxY: bot }, pins: [{ num: pwrNum, x: bx, y: top }, { num: gndNum, x: bx, y: bot }] });
			out.placements.push({ designator: d, x: bx, y: (top + bot) / 2, rot: 90, mirror: false });
			out.netflags.push({ kind: 'power', net: pwrName, x: bx, y: top - FLAGV, rot: 0 }); out.wires.push({ net: pwrName, line: [bx, top, bx, top - FLAGV] });
			out.netflags.push({ kind: 'gnd', net: gndName, x: bx, y: bot + FLAGV, rot: 0 }); out.wires.push({ net: gndName, line: [bx, bot, bx, bot + FLAGV] });
			used.add(d); by += ROWC;
		}
	}
	// fallback:任何未放置的簇成员(防掉件)→ IC 下方一排,各脚带网标/flag。
	let fx = cx - 60; const fy = (ic.bbox ? ic.bbox.maxY : (ic.y || 0)) + 90;
	for (const d of members) {
		if (used.has(d)) { continue; }
		const c = compByDes.get(d); if (!c) { used.add(d); continue; }
		const lp = withLocalPins(c);
		const bx = lp.x != null ? lp.x : cx, byy = lp.y != null ? lp.y : 0;
		const dx0 = fx - bx, dy0 = fy - byy;
		out.components.push({ ...lp, x: bx + dx0, y: byy + dy0, bbox: lp.bbox ? { minX: lp.bbox.minX + dx0, minY: lp.bbox.minY + dy0, maxX: lp.bbox.maxX + dx0, maxY: lp.bbox.maxY + dy0 } : { minX: fx - 8, minY: fy - 8, maxX: fx + 8, maxY: fy + 8 }, pins: (lp.pins || []).map(p => ({ ...p, x: p.x + dx0, y: p.y + dy0 })) });
		out.placements.push({ designator: d, x: bx + dx0, y: byy + dy0, rot: lp.rotation || 0, mirror: !!lp.mirror });
		// 各脚带网标/flag 且【连线连到脚】(否则标签离脚无线=真实断连)。
		for (const p of (lp.pins || [])) { const nn = netOf(`${d}.${p.num}`); if (!nn) continue; const px = p.x + dx0, py = p.y + dy0; if (nn.class === 'ground') { out.netflags.push({ kind: 'gnd', net: nn.name, x: px, y: py + 16, rot: 0 }); out.wires.push({ net: nn.name, line: [px, py, px, py + 16] }); } else if (nn.class === 'power') { out.netflags.push({ kind: 'power', net: nn.name, x: px, y: py - 16, rot: 0 }); out.wires.push({ net: nn.name, line: [px, py, px, py - 16] }); } else { out.netflags.push({ kind: 'sig', net: nn.name, x: px + 20, y: py, textX: px + 20, textY: py, rot: 0, alignMode: 6 }); out.wires.push({ net: nn.name, line: [px, py, px + 20, py] }); } }
		used.add(d); fx += 100;
	}
	return out;
}

// 生成:每簇 schematic-aware 模板布局(默认)或 elkLayout(opts.layout==='elk'),shelf-packing 排布,产模型 + moduleRegions(带框标题)。
export async function generateLayout(snap, opts = {}) {
	const logical = buildCleanLogical(snap);
	const cluster = clusterComponents(snap, logical);
	if (!cluster) return null;
	const compByDes = new Map((snap.components || []).map(c => [c.designator, c]));
	const pinNet = new Map();
	for (const n of logical.nets) for (const ref of n.pins) pinNet.set(ref, n);
	const ctx = { compByDes, pinNet, logical };
	const subs = [];
	for (const [anchor, members] of cluster) {
		let m;
		if (opts.layout === 'elk') {
			const mset = new Set(members);
			const subComps = members.map(d => compByDes.get(d)).filter(Boolean);
			const subLogical = { nets: logical.nets.map(n => ({ ...n, pins: n.pins.filter(p => mset.has(p.slice(0, p.lastIndexOf('.')))) })).filter(n => n.pins.length >= 1) };
			const byDes = new Map(subComps.map(c => [c.designator, withLocalPins(c)]));
			m = await elkLayout({ snapshot: { ...snap, components: subComps }, logical: subLogical, byDes, scale: opts.scale !== false, powerEdges: true, layoutOptions: opts.layoutOptions || {}, maxWire: opts.maxWire || 320 });
		} else {
			m = layoutClusterTemplate(anchor, members, ctx);   // 默认:schematic-aware 模板布局(商业级)
		}
		const bb = m.components.reduce((a, c) => ({ minX: Math.min(a.minX, c.bbox.minX), minY: Math.min(a.minY, c.bbox.minY), maxX: Math.max(a.maxX, c.bbox.maxX), maxY: Math.max(a.maxY, c.bbox.maxY) }), { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 });
		for (const f of (m.netflags || [])) { bb.minX = Math.min(bb.minX, f.x - 26); bb.maxX = Math.max(bb.maxX, f.x + 26); bb.minY = Math.min(bb.minY, f.y - 12); bb.maxY = Math.max(bb.maxY, f.y + 12); }   // 框含标签
		subs.push({ anchor, model: m, bb, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY, count: members.length });
	}
	subs.sort((a, b) => b.h - a.h);
	const MAXW = opts.maxWidth || 2600, PAD = 130, TITLE = 48;
	let curX = 0, curY = 0, rowH = 0;
	const out = { components: [], wires: [], netflags: [], rectangles: [], texts: [] };
	const moduleRegions = [];
	const placements = [];   // 件原点全局位(供 live 投递移件)
	for (const s of subs) {
		if (curX > 0 && curX + s.w > MAXW) { curY += rowH + PAD; curX = 0; rowH = 0; }
		const ox = curX - s.bb.minX, oy = curY + TITLE - s.bb.minY;
		for (const c of s.model.components) out.components.push({ ...c, bbox: { minX: c.bbox.minX + ox, minY: c.bbox.minY + oy, maxX: c.bbox.maxX + ox, maxY: c.bbox.maxY + oy }, pins: (c.pins || []).map(p => ({ ...p, x: p.x + ox, y: p.y + oy })) });
		for (const w of s.model.wires) out.wires.push({ net: w.net, line: w.line.map((v, k) => k % 2 === 0 ? v + ox : v + oy) });
		for (const f of s.model.netflags) out.netflags.push({ ...f, x: f.x + ox, y: f.y + oy, textX: (f.textX || f.x) + ox, textY: (f.textY || f.y) + oy });
		for (const pl of (s.model.placements || [])) placements.push({ ...pl, x: pl.x + ox, y: pl.y + oy });
		moduleRegions.push({ name: s.anchor, title: `${s.anchor} (${s.count})`, box: { minX: curX - 12, minY: curY + TITLE - 8, maxX: curX + s.w + 12, maxY: curY + TITLE + s.h + 10 }, parts: s.count });
		curX += s.w + PAD; rowH = Math.max(rowH, TITLE + s.h);
	}
	if (opts.deconflict) deconflictLabels(out);   // opt-in 标签去冲突(验证式向外移,零回归)
	const sigLabels = out.netflags.filter(f => f.kind === 'sig').length;
	return { model: out, moduleRegions, placements, stats: { clusters: subs.length, components: out.components.length, wires: out.wires.length, sigLabels, powerGnd: out.netflags.length - sigLabels, nets: logical.nets.length, placements: placements.length } };
}

// 把生成的模块图投递到 live EDA。2026-06-20 实测验证:必须用【命名线】(无名线被 EDA 删=0线),
// 跨簇标签用 netport,电源/地用 NetFlag,末尾覆盖式自愈补漏网。验证:vibe-buddy 86命名线持久、29/29网连通。
export async function deliverGenerated(snap, opts = {}) {
	const { executeCode } = await import('./bridge_client.mjs');
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const exec = async js => { for (let t = 0; t < 6; t++) { try { return (await executeCode(js, { timeoutMs: 90000 })).result; } catch (e) { if (!/disconnect|timed out/i.test(e.message)) { console.error('  非连接错:', e.message.slice(0, 70)); return null; } await sleep(2500); } } return null; };
	const runOps = async (label, ops, batch = 15) => { let done = 0; for (let i = 0; i < ops.length; i += batch) { await exec(`let n=0;\n${ops.slice(i, i + batch).join('\n')}\nreturn{n};`); done += Math.min(batch, ops.length - i); process.stdout.write(`\r  ${label}: ${done}/${ops.length}`); } console.log(' ✓'); };
	const cg = await generateLayout(snap, { ...opts, scale: false, deconflict: opts.deconflict !== false });   // live 投递 scale=false 保脚位,默认去冲突
	if (!cg) { console.error('无 IC 锚点,无法生成'); return null; }
	console.log('cluster 生成模块图投递:', JSON.stringify(cg.stats));
	const cur = await exec(`const cs=await eda.sch_PrimitiveComponent.getAll();return cs.map(c=>({id:c.primitiveId||c.id,des:c.designator}));`);
	const desToId = new Map((cur || []).filter(c => c.des).map(c => [c.des, c.id]));
	await exec(`for(let p=0;p<10;p++){const ws=(await eda.sch_PrimitiveWire.getAll())||[];const wid=ws.map(w=>w.primitiveId);if(wid.length){try{await eda.sch_PrimitiveWire.delete(wid);}catch(e){}}const ids=(await eda.sch_PrimitiveComponent.getAllPrimitiveId())||[];const fc=[];for(const id of ids){const c=await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);if(c&&(c.componentType==='netflag'||c.componentType==='netport'))fc.push(id);}if(fc.length){try{await eda.sch_PrimitiveComponent.delete(fc);}catch(e){}}if(!wid.length&&!fc.length)break;}return{};`);
	await runOps('移件', cg.placements.map(p => { const id = desToId.get(p.designator); return id ? `try{await eda.sch_PrimitiveComponent.modify(${JSON.stringify(id)},{x:${p.x},y:${p.y},rotation:${p.rot || 0},mirror:${!!p.mirror}});n++;}catch(e){}` : null; }).filter(Boolean));
	await runOps('命名连线', cg.model.wires.map(w => `try{await eda.sch_PrimitiveWire.create(${JSON.stringify(w.line)},${JSON.stringify(w.net || '')});n++;}catch(e){}`));
	// createNetPort/createNetFlag 旋转约定均为镜像(输入 R → 回读 360-R,已实证),
	// 模型 f.rot 是【目标显示旋转】(deconflict/geomQC 据此验证),投递须补偿镜像否则 90↔270 翻转。
	await runOps('网标/符号', cg.model.netflags.map(f => { const x = f.x, y = f.y, r = netflagCreateRotation(f.rot); if (f.kind === 'sig') return `try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(f.net)},${x},${y},${r});n++;}catch(e){}`; return `try{await eda.sch_PrimitiveComponent.createNetFlag('${f.kind === 'gnd' ? 'Ground' : 'Power'}',${JSON.stringify(f.net)},${x},${y},${r});n++;}catch(e){}`; }));
	// 覆盖式自愈:回读已连网,对完全没连上的命名网在连线两端补 netport(密集脚 create 失败兜底)。
	const covered = await exec(`const ws=await eda.sch_PrimitiveWire.getAll();const ps=await eda.sch_PrimitiveComponent.getAll();return [...new Set([...(ws||[]).map(w=>w.net),...(ps||[]).map(p=>p.net)].filter(Boolean))];`);
	const cset = new Set(covered || []);
	const heal = [];
	for (const w of cg.model.wires) { if (!w.net || cset.has(w.net)) continue; const l = w.line; for (const [x, y] of [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]) heal.push(`try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(w.net)},${x},${y},0);n++;}catch(e){}`); }
	if (heal.length) { console.log(`自愈 ${heal.length / 2} 漏网...`); await runOps('自愈', heal); }
	console.log('cluster 生成模块图已投 live(命名线持久、跨簇 netport)。');
	return cg.stats;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('engine/cluster_generate.mjs')) {
	const { readFileSync } = await import('node:fs');
	const { renderSheetOutput } = await import('./sheet_renderer.mjs');
	const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
	const file = process.argv[2] || `${ROOT}/live_clean.json`;
	const outPng = process.argv[3] || `${ROOT}/cluster_generate.png`;
	const snap = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
	if (process.argv.includes('--deliver')) {   // 投到 live EDA(命名线,实测验证)
		const stats = await deliverGenerated(snap);
		process.exit(stats ? 0 : 1);
	}
	const r = await generateLayout(snap);
	if (!r) { console.error('无 IC 锚点,无法聚类生成'); process.exit(1); }
	console.log(`生成模块图: ${JSON.stringify(r.stats)}`);
	renderSheetOutput(r.model, outPng, { moduleRegions: r.moduleRegions });
	console.log(`渲染 -> ${outPng}`);
}
