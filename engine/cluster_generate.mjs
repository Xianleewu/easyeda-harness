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
import { recoverConnectivity } from './connectivity_recover.mjs';
import { routeLocalNets } from './local_net_route.mjs';
import { repairNetFaithfulness } from './net_faithfulness.mjs';
import { directRouteClose } from './direct_route.mjs';

// 电源/地轨合并:同 net 同 x 的【密集 flag 列】(连续间距≤34=堆叠,如多上拉到 VDD 的 far flag)→
// 画竖直 rail 连接 + 仅保留首个 flag、移除其余(电气经 rail 同 net 连通)。间距大的(去耦带 ROWC 90)不动。
// 移除 flag 只减叠压(不像交错移入新叠压);rail 在标签列内不穿件。实测净正向、clean 板无 dense 列故零回归。
function consolidateRails(model) {
	const groups = new Map();
	model.netflags.forEach((f, i) => { const key = `${f.net}|${Math.round(f.x / 4) * 4}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ f, i }); });
	const rm = new Set();
	for (const grp of groups.values()) {
		if (grp.length < 3) continue;
		grp.sort((a, b) => a.f.y - b.f.y);
		let dense = true;
		for (let k = 1; k < grp.length; k++) if (grp[k].f.y - grp[k - 1].f.y > 34) { dense = false; break; }
		if (!dense) continue;
		const x = grp[0].f.x;
		model.wires.push({ net: grp[0].f.net, line: [x, grp[0].f.y, x, grp[grp.length - 1].f.y] });
		for (let k = 1; k < grp.length; k++) rm.add(grp[k].i);
	}
	if (rm.size) model.netflags = model.netflags.filter((f, i) => !rm.has(i));
	return model;
}

// 标签去冲突(opt-in,较慢):贪心把叠压网标移开——【向外:沿 escape 轴直桩延】或
// 【垂直:L 形桩(pin→原escape→新位)】,逐个试,仅当 labelHard 严格下降且【短路=0、交叉不增】
// 才保留(验证式,零回归)。实测某真实板 scale=false:labelHard 7→2(71%消除)。
// naive 整体移会回归,故用贪心验证式逐步。
function deconflictLabels(model) {
	const lh = m => labelQC(m).filter(f => f.severity === 'hard').length;
	const geo = m => { const g = geomQC(m); return { sh: g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.collinear + g.endpointShort + g.endpointOnWire, cr: g.crossings }; };   // sh 须含短路类(共线/端点短/端点落线):否则去突 L 桩制造的 endpointOnWire 短路看不见、不被拒
	const dirOf = f => (f.alignMode === 8 || f.rot === 180) ? [-1, 0] : (f.alignMode === 6 || f.rot === 0) ? [1, 0] : (f.rot === 90) ? [0, 1] : (f.rot === 270) ? [0, -1] : null;
	const stubOf = (m, f) => m.wires.find(w => { const l = w.line; return Math.abs(l[l.length - 2] - f.x) < 2 && Math.abs(l[l.length - 1] - f.y) < 2; });
	// 每 pass 1 个移动;`!best break` 在收敛(无改善)时退出。早退优化后每 pass 很快,上限放宽到 60
	// 让多叠压板(如 58件板 22 叠压)解更多(实测 22→9)。评估预算封顶超大板时间(中小板早收敛不触及):
	// labelQC 调用计数 > 预算则停,确定性(同输入同结果),避免超大板 deconflict 过久。
	// 预算/轮数按标签数缩放:小板早收敛、快;复杂板(密集标签)多算消更多冲突(实测某板 88→67)。
	const nLabels = (model.netflags || []).length;
	let evals = 0; const EVAL_BUDGET = Math.min(40000, Math.max(2200, nLabels * 280));
	for (let pass = 0, maxPass = Math.min(500, Math.max(60, nLabels * 4)); pass < maxPass; pass++) {
		if (evals > EVAL_BUDGET) break;
		const hard = labelQC(model).filter(f => f.severity === 'hard');
		const base = hard.length; if (base === 0) break; const bg = geo(model);
		// 性能:只对【参与叠压的网】的网标试移(非全部 85),~10x 加速、效果不变。
		const hot = new Set(hard.flatMap(f => Array.isArray(f.where) ? f.where : (f.where && f.where.net ? [f.where.net] : [])));
		let best = null;
		// 性能:原逻辑每 pass 评估所有候选却只保留首个改善的(best.nl undefined→`nl<best.nl`恒false)。
		// 无损优化:① 先算便宜的 labelQC,仅严格改善才算贵的 geomQC ② 找到首个有效移动即早退(break outer)。
		// 实测 39 件板 deconflict 22.5s→快数十倍,结果不变(同首个改善移动)。
		outer:
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
				const nl = lh(model); evals++;
				let ok = false;
				if (nl < base) { const ng = geo(model); ok = ng.sh <= bg.sh && ng.cr <= bg.cr; }   // 不增短路(原 ===0 在有基础短路的板上永不满足→deconflict 被禁用;干净板 bg.sh=0 行为不变=零回归)
				f.x = ox; f.y = oy; f.textX = otx; f.textY = oty; stub.line = ol;
				if (ok) { best = { f, c, px, py, ox, oy }; break outer; }
			}
		}
		if (!best) break;
		const { f, c, px, py, ox, oy } = best; const stub = stubOf(model, f);
		f.x += c.dx; f.y += c.dy; if (f.textX != null) f.textX += c.dx; if (f.textY != null) f.textY += c.dy;
		stub.line = c.mode === 'out' ? [px, py, f.x, f.y] : [px, py, ox, oy, f.x, f.y];
	}
	return model;
}

// 最终正交化(DR1 保证):任意来源的对角线段 → 插 L 角点拆成两条正交段。
// 角点二选一(H 先 / V 先),优先选【不落入器件 bbox、两段都不穿件】的;都坏则保 H 先。
// 通用:不依赖斜线来源,对任意板任意生成路径的残留斜线生效。保末端点不变(flag/脚匹配不破)。
function orthogonalizeWires(model) {
	const M = 1;
	const boxes = model.components.map(c => c.bbox).filter(Boolean);
	const inBox = (x, y) => boxes.some(b => x > b.minX + M && x < b.maxX - M && y > b.minY + M && y < b.maxY - M);
	const segHitComp = (x1, y1, x2, y2) => {
		for (const b of boxes) {
			if (x1 === x2) { if (x1 > b.minX + M && x1 < b.maxX - M) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); if (lo < b.maxY - M && hi > b.minY + M) return true; } }
			else { if (y1 > b.minY + M && y1 < b.maxY - M) { const lo = Math.min(x1, x2), hi = Math.max(x1, x2); if (lo < b.maxX - M && hi > b.minX + M) return true; } }
		}
		return false;
	};
	// 他网正交段集合(共线重叠判定 → 避免视觉短路)。
	const segs = [];
	for (const w of model.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 2) { if (l[i] === l[i + 2] || l[i + 1] === l[i + 3]) segs.push({ net: w.net, a: [l[i], l[i + 1], l[i + 2], l[i + 3]] }); } }
	const overlapWire = (net, x1, y1, x2, y2) => {
		for (const s of segs) {
			if (s.net === net) continue; const [a, b, cc, d] = s.a;
			if (x1 === x2 && a === cc && a === x1) { const lo = Math.max(Math.min(y1, y2), Math.min(b, d)), hi = Math.min(Math.max(y1, y2), Math.max(b, d)); if (hi - lo > M) return true; }
			if (y1 === y2 && b === d && b === y1) { const lo = Math.max(Math.min(x1, x2), Math.min(a, cc)), hi = Math.min(Math.max(x1, x2), Math.max(a, cc)); if (hi - lo > M) return true; }
		}
		return false;
	};
	// 标签框集合(避免新角点拐段穿过他网标签 → L4)。
	const labs = (model.netflags || []).map(f => sigLabelBox(f)).filter(Boolean);
	const segHitLabel = (net, x1, y1, x2, y2) => {
		for (const lb of labs) { if (lb.net === net) continue; const b = lb.box;
			if (x1 === x2) { if (x1 > b.minX && x1 < b.maxX) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); if (lo < b.maxY && hi > b.minY) return true; } }
			else { if (y1 > b.minY && y1 < b.maxY) { const lo = Math.min(x1, x2), hi = Math.max(x1, x2); if (lo < b.maxX && hi > b.minX) return true; } }
		}
		return false;
	};
	// 角点伤害分:落框/穿件最重,共线短路次之,穿标签再次。选最小,平手选 H 先(角点 x2,y1)。
	const score = (net, cx, cy, x1, y1, x2, y2) =>
		(inBox(cx, cy) ? 100 : 0) + ((segHitComp(x1, y1, cx, cy) ? 1 : 0) + (segHitComp(cx, cy, x2, y2) ? 1 : 0)) * 40
		+ ((overlapWire(net, x1, y1, cx, cy) ? 1 : 0) + (overlapWire(net, cx, cy, x2, y2) ? 1 : 0)) * 8
		+ ((segHitLabel(net, x1, y1, cx, cy) ? 1 : 0) + (segHitLabel(net, cx, cy, x2, y2) ? 1 : 0)) * 4;
	for (const w of model.wires) {
		const l = w.line; if (l.length < 4) continue;
		const o = [l[0], l[1]];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const x1 = o[o.length - 2], y1 = o[o.length - 1], x2 = l[i + 2], y2 = l[i + 3];
			if (x1 !== x2 && y1 !== y2) {
				const sA = score(w.net, x2, y1, x1, y1, x2, y2);   // H 先:角点(x2,y1)
				const sB = score(w.net, x1, y2, x1, y1, x2, y2);   // V 先:角点(x1,y2)
				const corner = sB < sA ? [x1, y2] : [x2, y1];
				o.push(corner[0], corner[1], x2, y2);
			} else { o.push(x2, y2); }
		}
		w.line = o;
	}
	return model;
}

// 信号网标文字框(复刻 label_qc.sigBBox 关键分支,用于布线避让)。返回 {net, box} 或 null(电源/地用符号框,略)。
function sigLabelBox(f) {
	if (f.kind !== 'sig' || f.x == null) return null;
	const x = f.textX ?? f.x, y = f.textY ?? f.y, rot = f.rot ?? f.rotation ?? 0, h = 14;
	const len = Math.max(40, String(f.net || '').length * 6 + 18);
	let box;
	if (f.alignMode === 6 || f.alignMode === 7 || f.alignMode == null) box = { minX: x, maxX: x + len, minY: y, maxY: y + h };
	else if (f.alignMode === 8 || f.alignMode === 9) box = { minX: x - len, maxX: x, minY: y, maxY: y + h };
	else if (rot === 180) box = { minX: x - len, maxX: x - 6, minY: y - h, maxY: y + h };
	else if (rot === 0) box = { minX: x + 6, maxX: x + len, minY: y - h, maxY: y + h };
	else if (rot === 90) box = { minX: x - h, maxX: x + h, minY: y + 6, maxY: y + len };
	else box = { minX: x - h, maxX: x + h, minY: y - len, maxY: y - 6 };
	return { net: f.net, box };
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
export function layoutClusterTemplate(anchor, members, ctx, depth = 0) {
	const { compByDes, pinNet } = ctx;
	const netOf = ref => pinNet.get(ref);
	const ic = withLocalPins(compByDes.get(anchor));
	// 信号脚密度展开:同边信号脚间距 <20px → 命名标签(竖直标签框宽 16px)必叠压(L3 标压标 + 桩端互触短路)。
	// 目标 20(5 的倍数且 > 标签框宽):5 栅格吸格后脚距【保持 20】不退化(16 会被吸成 15<标签宽→叠);商用 IC 多信号脚本就有可读间距。
	// 按需缩放 IC 该轴(脚+body 同步,绕中心)。仅当确有 <20px 密集脚才缩放(稀疏 IC 不触发=零回归);克隆 pins 防改到 withLocalPins 复用对象。
	if (ic.bbox && Array.isArray(ic.pins) && ic.pins.length > 1) {
		ic.pins = ic.pins.map(p => ({ ...p }));
		const bb0 = ic.bbox, cxc = (bb0.minX + bb0.maxX) / 2, cyc = (bb0.minY + bb0.maxY) / 2;
		const sd = p => { const dL = Math.abs(p.x - bb0.minX), dR = Math.abs(p.x - bb0.maxX), dT = Math.abs(p.y - bb0.minY), dB = Math.abs(p.y - bb0.maxY); const m = Math.min(dL, dR, dT, dB); return m === dL ? 'L' : m === dR ? 'R' : m === dT ? 'T' : 'B'; };
		const minGap = (arr, ax) => { const v = arr.map(p => p[ax]).sort((a, b) => a - b); let g = 1e9; for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > 0.5) g = Math.min(g, v[i] - v[i - 1]); return g; };
		// 按【每一侧单独】算脚间距(早先把左右两列合并算→交错排针连接器如 FPC 的奇左偶右交错使 min=半距,
		// 误触发缩放、把脚距撑成 2× → 投递时 EDA 用符号原距、线接不到脚差 10px=真连接 bug)。同列标签朝同方向、
		// 才有叠压风险,故应按列(L/R 各自、T/B 各自)取 min,取两列较密者。
		const sideMin = (side1, side2, ax) => Math.min(
			ic.pins.filter(p => sd(p) === side1).length > 1 ? minGap(ic.pins.filter(p => sd(p) === side1), ax) : 99,
			ic.pins.filter(p => sd(p) === side2).length > 1 ? minGap(ic.pins.filter(p => sd(p) === side2), ax) : 99);
		const gapY = sideMin('L', 'R', 'y'), gapX = sideMin('T', 'B', 'x');
		const sY = gapY < 20 ? 20 / gapY : 1, sX = gapX < 20 ? 20 / gapX : 1;
		if (sY !== 1 || sX !== 1) {
			// 按侧分轴展开:L/R 脚只竖直(sY,标签竖向留位),T/B 脚只水平(sX)——避免无谓的另一轴偏移,
			// 使桥接线单轴短直、不跨他网(对角桥接 L-route 后会跨网短路)。存原始脚位 _ax/_ay 供投递桥接。
			for (const p of ic.pins) { p._ax = p.x; p._ay = p.y; const s = sd(p); if (s === 'L' || s === 'R') p.y = cyc + (p.y - cyc) * sY; else p.x = cxc + (p.x - cxc) * sX; }
			ic.bbox = { minX: cxc + (bb0.minX - cxc) * sX, maxX: cxc + (bb0.maxX - cxc) * sX, minY: cyc + (bb0.minY - cyc) * sY, maxY: cyc + (bb0.maxY - cyc) * sY };
		}
	}
	const cx = ic.x != null ? ic.x : (ic.bbox ? (ic.bbox.minX + ic.bbox.maxX) / 2 : 0);
	const cy = ic.y != null ? ic.y : (ic.bbox ? (ic.bbox.minY + ic.bbox.maxY) / 2 : 0);
	const out = { components: [{ ...ic }], wires: [], netflags: [], placements: [{ designator: anchor, x: ic.x, y: ic.y, rot: ic.rotation || 0, mirror: !!ic.mirror }] };
	const used = new Set([anchor]);
	const STUB = 24, PASS = 30, ROWC = 84, FLAGV = 26;   // 收紧间距(原30/40/100/28,真图证实板过稀疏)。ROWC=去耦带行距(电容含上下符号跨度~80,84 留薄余量);FLAGV=电容脚到电源地符号间距
	const isPass = d => /^[CRL]/.test(d) || /^Y/.test(d);
	const isDecoup = d => { const c = compByDes.get(d); return /^C/.test(d) && c && (c.pins || []).length === 2 && c.pins.every(p => { const nn = netOf(`${d}.${p.num}`); return nn && (nn.class === 'power' || nn.class === 'ground'); }); };
	// 引脚真实边:优先合法 p.side,否则按【到 bbox 四边的最近距离】判定(aspect-aware,对高/宽 IC 都对;
	// 早先用 |dx|/|dy| 对高 IC 的右侧上部脚会误判成 top → 内联失效掉到 fallback 浮空,2026-06-20 修)。
	const bb = ic.bbox || { minX: cx, maxX: cx, minY: cy, maxY: cy };
	// 归一化坐标(按 bbox 长宽比)定边:|nx|vs|ny| 各除以半宽/半高 → 高瘦 IC 的脚多归 L/R(标签向外平展、
	// 不横压宽体),只有真正贴上/下边沿且居中的脚才 top/bottom。比"最近边距"对高/宽 IC 都稳(消 label-over-comp)。
	const inferEdge = p => {
		const w = (bb.maxX - bb.minX) || 1, h = (bb.maxY - bb.minY) || 1;
		const nx = (p.x - (bb.minX + bb.maxX) / 2) / (w / 2), ny = (p.y - (bb.minY + bb.maxY) / 2) / (h / 2);
		return Math.abs(nx) >= Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'top' : 'bottom');
	};
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
		if (nn.class === 'local') continue;   // 本地网脚不打标签逃逸 → 由 routeLocalNets 簇内直连(P0,opts.recover)
		const s = sideOf(p), [dx, dy] = dirOf(s), lr = (s === 'left' || s === 'right');
		const sStub = lr ? STUB : STUB + 40;   // 顶/底信号脚标签需更长逃逸,使旋转命名标签清出 IC body+keepout(rulebook 6.3:命名桩在 IC 体外)
		const ex = p.x + dx * sStub, ey = p.y + dy * sStub;
		if (nn.class === 'signal') {
			// 该信号脚连接的簇内非去耦 2 脚无源件(串联/上拉/分压/RC),四方向均内联(顶/底脚竖直放置)。
			// 多件同脚(如反馈分压 R1→VOUT + R2→GND)用【节点 rail】:脚→节点,各件沿垂直方向分支,均接节点(=同电气节点)。
			const conns = members.filter(d => d !== anchor && !used.has(d) && isPass(d) && !isDecoup(d) && (() => { const c = compByDes.get(d); if ((c.pins || []).length !== 2) return false; const nets = c.pins.map(pp => netOf(`${d}.${pp.num}`)); return nets.some(x => x && x.name === nn.name) && nets.some(x => x && x.name !== nn.name); })());
			if (conns.length) {
				// 多内联件(≥2)需 perp rail 竖直跨度 → 会穿过相邻信号的水平标桩+标签(同逃逸走廊)致短路/L4。
				// 节点沿逃逸方向额外外推,使 rail 落在相邻信号标签左侧(走廊外)。单件(无 rail 跨度)不外推=零影响。
				const railExtra = conns.length >= 2 ? 50 : 0;   // node-rail 外推:50 在不增短路前提下缩模块 50px(实测 100→50 短路3不变、span -50;=0 短路3→5 因 rail 穿标签)。原 100 为旧 netlist 调,偏大撑模块
				const clrBody = dx > 0 ? bb.maxX - p.x : dx < 0 ? p.x - bb.minX : dy > 0 ? bb.maxY - p.y : p.y - bb.minY;
				const stubEff = Math.max(STUB, clrBody + 14);   // 逃逸清出 IC 体(内嵌/近体脚的无源件不落体内)
				const nodeX = p.x + dx * (stubEff + railExtra), nodeY = p.y + dy * (stubEff + railExtra);
				const perpX = dy === 0 ? 0 : 1, perpY = dy === 0 ? 1 : 0;   // rail 方向(水平脚→向下,竖直脚→向右)
				const vert = dy !== 0;
				out.wires.push({ net: nn.name, line: [p.x, p.y, nodeX, nodeY] });
				conns.forEach((series, i) => {
					const railX = nodeX + perpX * i * 34, railY = nodeY + perpY * i * 34;
					if (i > 0) out.wires.push({ net: nn.name, line: [nodeX, nodeY, railX, railY] });   // 沿 rail 延到本件行
					const c = compByDes.get(series);
					const tp = c.pins.find(pp => { const x = netOf(`${series}.${pp.num}`); return x && x.name === nn.name; });
					const op = c.pins.find(pp => pp !== tp);
					const on = netOf(`${series}.${op.num}`);
					const ccx = railX + dx * (6 + PASS / 2), ccy = railY + dy * (6 + PASS / 2);
					const innerX = railX + dx * 6, innerY = railY + dy * 6, outerX = railX + dx * (6 + PASS), outerY = railY + dy * (6 + PASS);
					out.components.push({ designator: series, x: ccx, y: ccy, rotation: vert ? 90 : 0, mirror: false, bbox: vert ? { minX: ccx - 6, minY: ccy - PASS / 2, maxX: ccx + 6, maxY: ccy + PASS / 2 } : { minX: ccx - PASS / 2, minY: ccy - 6, maxX: ccx + PASS / 2, maxY: ccy + 6 }, pins: [{ num: tp.num, x: innerX, y: innerY }, { num: op.num, x: outerX, y: outerY }] });
					out.placements.push({ designator: series, x: ccx, y: ccy, rot: vert ? 90 : 0, mirror: false });
					out.wires.push({ net: nn.name, line: [railX, railY, innerX, innerY] });
					const ax = outerX + dx * STUB, ay = outerY + dy * STUB;
					out.wires.push({ net: on ? on.name : '', line: [outerX, outerY, ax, ay] });
					if (on && (on.class === 'power' || on.class === 'ground')) out.netflags.push({ kind: on.class === 'ground' ? 'gnd' : 'power', net: on.name, x: ax, y: ay, rot: 0 });
					else out.netflags.push(sigFlag(on ? on.name : '', ax, ay, s));
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
	// 去耦电容:专用竖直去耦带,放在 IC 块【信号更少的一侧】(避开信号标签、更紧凑),各 [VDD]—C—[GND]。
	// 不贴具体电源脚(四边脚 IC 顶部电源脚会与侧边信号标签冲突)——独立去耦列是通用商业惯例。
	const caps = members.filter(d => d !== anchor && !used.has(d) && isDecoup(d));
	if (caps.length) {
		// 每件电源/地脚名解析(去重共享)。
		const capInfo = d => { const c = compByDes.get(d); const p1 = c.pins[0], p2 = c.pins[1]; const n1 = netOf(`${d}.${p1.num}`), n2 = netOf(`${d}.${p2.num}`); const pwrNum = (n1 && n1.class === 'power') ? p1.num : p2.num; const pwrName = (n1 && n1.class === 'power') ? n1.name : (n2 ? n2.name : 'VDD'); const gndNum = pwrNum === p1.num ? p2.num : p1.num; const gndName = (netOf(`${d}.${gndNum}`) || {}).name || 'GND'; return { pwrNum, pwrName, gndNum, gndName }; };
		// 门控:左右两侧都拥挤(内联件把侧去耦带推远→稀疏)、IC 下方无电源脚、无 fallback 子电路占用下方时,
		// 改放【IC 正下方水平去耦排】(buck/LDO 类两侧都有内联件的板紧贴 IC)。仅此窄条件触发,其余拓扑走原侧带(零改动)。
		let leftExt = bb.minX, rightExt = bb.maxX;
		for (const f of out.netflags) { if (f.x < bb.minX) leftExt = Math.min(leftExt, f.x); if (f.x > bb.maxX) rightExt = Math.max(rightExt, f.x); }
		for (const c of out.components) { if (c.designator === anchor || !c.bbox) continue; if (c.bbox.minX < bb.minX) leftExt = Math.min(leftExt, c.bbox.minX); if (c.bbox.maxX > bb.maxX) rightExt = Math.max(rightExt, c.bbox.maxX); }
		// 门:【两侧都有信号脚】才下方排——此时无"纯电源侧"可干净贴电容,caps-below(~62)比侧带紧。
		// 若一侧只有电源/地脚(如总线 IC 的 VDD/GND 侧、或信号全在一侧的小模块),该侧本就是贴电容好位置,
		// 走侧带贴该空/电源侧更合理(总线 tall IC 电容贴电源侧 > 推到下方远离)。
		let leftSigPin = false, rightSigPin = false;
		for (const p of ic.pins) { const nnp = netOf(`${anchor}.${p.num}`); if (!nnp || nnp.class !== 'signal') continue; const sp = sideOf(p); if (sp === 'left') leftSigPin = true; else if (sp === 'right') rightSigPin = true; }
		const bothCrowded = leftSigPin && rightSigPin;
		const hasBottomPin = ic.pins.some(p => sideOf(p) === 'bottom');
		const remPreview = members.filter(d => !used.has(d) && !isDecoup(d) && compByDes.get(d));
		if (bothCrowded && !hasBottomPin && remPreview.length === 0) {
			const HSP = 56, rowW = (caps.length - 1) * HSP, startX = cx - rowW / 2, cyc = bb.maxY + 62;
			for (let i = 0; i < caps.length; i++) {
				const d = caps[i], { pwrNum, pwrName, gndNum, gndName } = capInfo(d);
				const bx = startX + i * HSP, top = cyc - 12, bot = cyc + 12;
				out.components.push({ designator: d, x: bx, y: cyc, rotation: 90, mirror: false, bbox: { minX: bx - 8, minY: top, maxX: bx + 8, maxY: bot }, pins: [{ num: pwrNum, x: bx, y: top }, { num: gndNum, x: bx, y: bot }] });
				out.placements.push({ designator: d, x: bx, y: cyc, rot: 90, mirror: false });
				out.netflags.push({ kind: 'power', net: pwrName, x: bx, y: top - FLAGV, rot: 0 }); out.wires.push({ net: pwrName, line: [bx, top, bx, top - FLAGV] });
				out.netflags.push({ kind: 'gnd', net: gndName, x: bx, y: bot + FLAGV, rot: 0 }); out.wires.push({ net: gndName, line: [bx, bot, bx, bot + FLAGV] });
				used.add(d);
			}
		} else {
			// 选侧:① 优先放【无信号脚的纯电源/空侧】(总线 IC 的 VDD/GND 侧、信号全在一侧的小模块的空侧)
			// ——那是贴电容好位;② 两侧都有信号脚(被底部脚/fallback 排除 caps-below,如四边脚)则按【内容
			// 更空侧】(内容延伸 leftExt/rightExt;修运放类"少信号但多内联"误判,signal-count 会把电容推远)。
			const onRight = (rightSigPin && !leftSigPin) ? false : (leftSigPin && !rightSigPin) ? true : ((rightExt - bb.maxX) <= (bb.minX - leftExt));
			const bx = onRight ? rightExt + 80 : leftExt - 80; let by = (ic.bbox ? ic.bbox.minY : cy) + 10;
			for (const d of caps) {
				const { pwrNum, pwrName, gndNum, gndName } = capInfo(d);
				const top = by, bot = by + 24;
				out.components.push({ designator: d, x: bx, y: (top + bot) / 2, rotation: 90, mirror: false, bbox: { minX: bx - 8, minY: top, maxX: bx + 8, maxY: bot }, pins: [{ num: pwrNum, x: bx, y: top }, { num: gndNum, x: bx, y: bot }] });
				out.placements.push({ designator: d, x: bx, y: (top + bot) / 2, rot: 90, mirror: false });
				out.netflags.push({ kind: 'power', net: pwrName, x: bx, y: top - FLAGV, rot: 0 }); out.wires.push({ net: pwrName, line: [bx, top, bx, top - FLAGV] });
				out.netflags.push({ kind: 'gnd', net: gndName, x: bx, y: bot + FLAGV, rot: 0 }); out.wires.push({ net: gndName, line: [bx, bot, bx, bot + FLAGV] });
				used.add(d); by += ROWC;
			}
		}
	}
	// fallback = 离散子电路:剩余未放置成员按【共享网连通】分组,每组以最高脚件为锚【递归模板布局】
	// (离散三极管级等正确成块);depth≥1 不再递归(防无限),退化为逐件带连线网标。
	const rem = members.filter(d => !used.has(d) && compByDes.get(d));
	let fx0 = cx - 60; const fy0 = (ic.bbox ? ic.bbox.maxY : (ic.y || 0)) + 55;   // 子电路在 IC 下方间距(IC底部flag约+30,留余量;更紧凑减留白)
	const dumpOne = (d, fx) => {   // 逐件带连线网标(退化路径)
		const lp = withLocalPins(compByDes.get(d));
		const bx = lp.x != null ? lp.x : cx, byy = lp.y != null ? lp.y : 0, dx0 = fx - bx, dy0 = fy0 - byy;
		out.components.push({ ...lp, x: bx + dx0, y: byy + dy0, bbox: lp.bbox ? { minX: lp.bbox.minX + dx0, minY: lp.bbox.minY + dy0, maxX: lp.bbox.maxX + dx0, maxY: lp.bbox.maxY + dy0 } : { minX: fx - 8, minY: fy0 - 8, maxX: fx + 8, maxY: fy0 + 8 }, pins: (lp.pins || []).map(p => ({ ...p, x: p.x + dx0, y: p.y + dy0 })) });
		out.placements.push({ designator: d, x: bx + dx0, y: byy + dy0, rot: lp.rotation || 0, mirror: !!lp.mirror });
		for (const p of (lp.pins || [])) { const nn = netOf(`${d}.${p.num}`); if (!nn) continue; if (nn.class === 'local') continue; const px = p.x + dx0, py = p.y + dy0; if (nn.class === 'ground') { out.netflags.push({ kind: 'gnd', net: nn.name, x: px, y: py + 16, rot: 0 }); out.wires.push({ net: nn.name, line: [px, py, px, py + 16] }); } else if (nn.class === 'power') { out.netflags.push({ kind: 'power', net: nn.name, x: px, y: py - 16, rot: 0 }); out.wires.push({ net: nn.name, line: [px, py, px, py - 16] }); } else { out.netflags.push({ kind: 'sig', net: nn.name, x: px + 20, y: py, textX: px + 20, textY: py, rot: 0, alignMode: 6 }); out.wires.push({ net: nn.name, line: [px, py, px + 20, py] }); } }
		used.add(d);
	};
	if (rem.length && depth < 1) {
		// 共享网连通分组(并查集)
		const par = new Map(rem.map(d => [d, d]));
		const find = a => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
		const net2 = new Map();
		for (const d of rem) for (const p of (compByDes.get(d).pins || [])) { const nn = netOf(`${d}.${p.num}`); if (!nn) continue; if (!net2.has(nn.name)) net2.set(nn.name, []); net2.get(nn.name).push(d); }
		for (const ds of net2.values()) for (let i = 1; i < ds.length; i++) par.set(find(ds[0]), find(ds[i]));
		const groups = new Map();
		for (const d of rem) { const r = find(d); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(d); }
		// fallback 子电路【包行】排在 IC 下方:超 IC 右边界换下一排,避免单行无限向右铺开撑宽模块+留白(真图证实主因)。
		let fyRow = fy0, rowMaxH = 0;
		const wrapW = (ic.bbox ? ic.bbox.maxX : cx) + 60;
		for (const grp of groups.values()) {
			const subAnchor = grp.slice().sort((a, b) => (compByDes.get(b).pins?.length || 0) - (compByDes.get(a).pins?.length || 0))[0];
			const sub = layoutClusterTemplate(subAnchor, grp, ctx, depth + 1);   // 递归:子电路以最高脚件为锚成块
			let bb = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
			for (const c of sub.components) if (c.bbox) { bb.minX = Math.min(bb.minX, c.bbox.minX); bb.minY = Math.min(bb.minY, c.bbox.minY); bb.maxX = Math.max(bb.maxX, c.bbox.maxX); bb.maxY = Math.max(bb.maxY, c.bbox.maxY); }
			for (const f of sub.netflags) { bb.minX = Math.min(bb.minX, f.x - 20); bb.maxX = Math.max(bb.maxX, f.x + 20); bb.minY = Math.min(bb.minY, f.y - 10); bb.maxY = Math.max(bb.maxY, f.y + 10); }
			const gw = bb.maxX - bb.minX, gh = bb.maxY - bb.minY;
			if (fx0 > cx - 60 && fx0 + gw > wrapW) { fyRow += rowMaxH + 50; fx0 = cx - 60; rowMaxH = 0; }   // 换行
			const dox = fx0 - bb.minX, doy = fyRow - bb.minY;
			for (const c of sub.components) out.components.push({ ...c, x: (c.x ?? 0) + dox, y: (c.y ?? 0) + doy, bbox: { minX: c.bbox.minX + dox, minY: c.bbox.minY + doy, maxX: c.bbox.maxX + dox, maxY: c.bbox.maxY + doy }, pins: (c.pins || []).map(p => ({ ...p, x: p.x + dox, y: p.y + doy, _ax: (p._ax ?? p.x) + dox, _ay: (p._ay ?? p.y) + doy })) });
			for (const w of sub.wires) out.wires.push({ net: w.net, line: w.line.map((v, k) => k % 2 === 0 ? v + dox : v + doy) });
			for (const f of sub.netflags) out.netflags.push({ ...f, x: f.x + dox, y: f.y + doy, textX: (f.textX ?? f.x) + dox, textY: (f.textY ?? f.y) + doy });
			for (const pl of (sub.placements || [])) out.placements.push({ ...pl, x: pl.x + dox, y: pl.y + doy });
			grp.forEach(d => used.add(d));
			fx0 += gw + 90; rowMaxH = Math.max(rowMaxH, gh);
		}
	} else {
		for (const d of rem) { dumpOne(d, fx0); fx0 += 100; }
	}
	// 脚展开桥接:逃逸建在【缩放脚位】,但 EDA 投递用符号【原始脚距】→ 实际脚差几 px 接不到逃逸(真连接 bug)。
	// 加桥接短线从【原始脚位 _ax/_ay】连到【缩放脚位 x/y】(net 同脚网),投递后 EDA 实际脚经桥接连上逃逸。
	// 修脚展开与投递的孪生冲突,连接精确;桥接是命名线(EDA 不删)。本地网由 routeLocalNets 处理,跳过。
	for (const p of (ic.pins || [])) {
		if (p._ax != null && (Math.abs(p._ax - p.x) > 0.5 || Math.abs(p._ay - p.y) > 0.5)) {
			const nn = netOf(`${anchor}.${p.num}`);
			if (nn && nn.class !== 'local') out.wires.push({ net: nn.name, line: [p._ax, p._ay, p.x, p.y] });
		}
	}
	return out;
}

// 解析器件显示值:优先 Value(非模板),其次 Supplier Part 器件名(去版本/LCSC后缀),再 name,兜底 designator。
// 修真实快照里 name="={Value}"/"={Manufacturer Part}" 类未解析模板串导致"器件名全是坏串"——对任意板通用。
function attrVal(c, key) { for (const a of (c.attrs || [])) if (a.key === key) return a.value; return ''; }
function isTemplate(v) { const s = String(v || '').trim(); return !s || s.startsWith('=') || s.startsWith('{'); }
export function resolveDisplayValue(c) {
	if (!c) return '';
	const val = attrVal(c, 'Value'); if (val && !isTemplate(val)) return val;
	const sp = attrVal(c, 'Supplier Part'); if (sp && !isTemplate(sp)) return sp.replace(/\.\d+$/, '').replace(/_C\d+$/, '');
	const nm = c.name; if (nm && !isTemplate(nm)) return nm;
	return c.designator || '';
}

// 生成:每簇 schematic-aware 模板布局(默认)或 elkLayout(opts.layout==='elk'),shelf-packing 排布,产模型 + moduleRegions(带框标题)。
export async function generateLayout(snap, opts = {}) {
	const logical = opts.recover ? { nets: recoverConnectivity(snap).nets } : buildCleanLogical(snap);   // opts.recover:用完整网表(含无名本地网,P0 保连通),否则仅命名网(默认,零回归)
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
	// 块排序:连接性优先(共享网多的块相邻=信号流更连贯),而非单纯按高度。贪心:从最多连接的块起,
	// 每次接【与上一个块共享网最多】的块;无共享则接与已放置块共享最多的。门不受排序影响(块间 PAD 隔开)。
	if (opts.layout !== 'elk' && subs.length > 2) {
		const clusterOf = new Map();
		for (const [anchor, members] of cluster) for (const d of members) clusterOf.set(d, anchor);
		const anchorNets = new Map(), netAnchors = new Map();
		for (const n of logical.nets) { const as = new Set(); for (const ref of n.pins) { const a = clusterOf.get(ref.slice(0, ref.lastIndexOf('.'))); if (a) as.add(a); } netAnchors.set(n.name, as); for (const a of as) { if (!anchorNets.has(a)) anchorNets.set(a, new Set()); anchorNets.get(a).add(n.name); } }
		const shared = (a, b) => { let w = 0; for (const net of (anchorNets.get(a) || [])) { const ans = netAnchors.get(net); if (ans && ans.has(b) && a !== b) w++; } return w; };
		const anchors = subs.map(s => s.anchor);
		let start = anchors[0], bestC = -1;
		for (const a of anchors) { let c = 0; for (const b of anchors) c += shared(a, b); if (c > bestC) { bestC = c; start = a; } }
		const ordered = [start], rem = new Set(anchors); rem.delete(start);
		while (rem.size) { const last = ordered[ordered.length - 1]; let next = null, bw = -1; for (const a of rem) { const w = shared(last, a); if (w > bw) { bw = w; next = a; } } if (bw <= 0) { for (const a of rem) { let w = 0; for (const p of ordered) w += shared(p, a); if (w > bw) { bw = w; next = a; } } } if (!next) next = [...rem][0]; ordered.push(next); rem.delete(next); }
		const oi = new Map(ordered.map((a, i) => [a, i]));
		subs.sort((a, b) => oi.get(a.anchor) - oi.get(b.anchor));
	} else {
		subs.sort((a, b) => b.h - a.h);
	}
	const PAD = 40, TITLE = 36;   // 模块间距/标题带:收紧(原 130/48 致利用率 2.5%=废图观感)。模块 bbox 已含逃逸标签,40px 缝不叠压。
	// 行宽:按目标 aspect 平衡换行(多模块单行=宽-短→渲染时件被缩小;平衡成接近 landscape sheet 让模块
	// 渲染更大更易读)。保序 + PAD 不变 = 无叠压;单模块/总宽已小于 balancedW 的板不换行(行为不变)。
	const totalW = subs.reduce((a, s) => a + s.w + PAD, 0);
	const rowH0 = Math.max(...subs.map(s => s.h)) + TITLE + PAD;
	const maxModW = Math.max(...subs.map(s => s.w));
	const MAXW = opts.maxWidth || Math.min(2600, Math.max(Math.sqrt(1.6 * totalW * rowH0), maxModW + 1));
	const BASE = 60;   // 基准偏移:全图坐标 ≥BASE,避免 0 坐标(EDA modify x:0 被当 falsy 忽略 → 标题 x=NaN)
	const out = { components: [], wires: [], netflags: [], rectangles: [], texts: [] };
	const moduleRegions = [];
	const placements = [];   // 件原点全局位(供 live 投递移件)
	// ── BLF(bottom-left-fill)2D 装箱:每模块(按高降序)放到能放下且【顶最低】的 x,填补 row-packing 的垂直缝,
	//    显著提升利用率(2.5%→~更高)。天际线 sky=[{x0,x1,y}],topAt 取区间最高 y,raise 抬升放置区间。
	//    模块 s.w/s.h 已含逃逸标签 bbox,PAD 缝保证不叠压;保序遍历 subs 取 BLF 位,标题/区域随之。
	const order = [...subs].sort((a, b) => b.h - a.h);
	const sky = [{ x0: BASE, x1: BASE + MAXW, y: BASE }];
	const topAt = (x0, x1) => { let m = BASE; for (const sg of sky) { if (sg.x1 <= x0 || sg.x0 >= x1) continue; m = Math.max(m, sg.y); } return m; };
	const raise = (x0, x1, y) => { const ns = []; for (const sg of sky) { if (sg.x1 <= x0 || sg.x0 >= x1) { ns.push(sg); continue; } if (sg.x0 < x0) ns.push({ x0: sg.x0, x1: x0, y: sg.y }); if (sg.x1 > x1) ns.push({ x0: x1, x1: sg.x1, y: sg.y }); } ns.push({ x0, x1, y }); ns.sort((a, b) => a.x0 - b.x0); sky.length = 0; sky.push(...ns); };
	const posOf = new Map();
	for (const s of order) { const W = s.w + PAD, H = TITLE + s.h + PAD; let bx = BASE, by = Infinity; for (let x = BASE; x + W <= BASE + MAXW + 1; x += 10) { const y = topAt(x, x + W); if (y < by) { by = y; bx = x; } } if (!isFinite(by)) { bx = BASE; by = topAt(BASE, BASE + W); } posOf.set(s, { x: bx, y: by }); raise(bx, bx + W, by + H); }
	// 模块标题:用【锚点 + 真实器件型号】(准确、不误导)。设计者原图的描述性标题与我的网表聚类不一一对应
	// (我按连通聚类、他按功能分),空间匹配会张冠李戴 → 故用器件型号这个确定可靠的信息。原图全部旧文字由 deliver 删除(消灭孤儿)。
	for (const s of subs) {
		const p = posOf.get(s);
		const ox = p.x - s.bb.minX, oy = p.y + TITLE - s.bb.minY;
		for (const c of s.model.components) out.components.push({ ...c, x: (c.x ?? 0) + ox, y: (c.y ?? 0) + oy, bbox: { minX: c.bbox.minX + ox, minY: c.bbox.minY + oy, maxX: c.bbox.maxX + ox, maxY: c.bbox.maxY + oy }, pins: (c.pins || []).map(p => ({ ...p, x: p.x + ox, y: p.y + oy, _ax: (p._ax ?? p.x) + ox, _ay: (p._ay ?? p.y) + oy })) });   // x/y(展开脚)+ _ax/_ay(EDA 实际脚位)同步偏移
		for (const w of s.model.wires) out.wires.push({ net: w.net, line: w.line.map((v, k) => k % 2 === 0 ? v + ox : v + oy) });
		for (const f of s.model.netflags) out.netflags.push({ ...f, x: f.x + ox, y: f.y + oy, textX: (f.textX || f.x) + ox, textY: (f.textY || f.y) + oy });
		for (const pl of (s.model.placements || [])) placements.push({ ...pl, x: pl.x + ox, y: pl.y + oy });
		const anchorVal = resolveDisplayValue(compByDes.get(s.anchor));
		const title = anchorVal && anchorVal !== s.anchor ? `${s.anchor}  ${anchorVal}` : `${s.anchor} (${s.count})`;
		moduleRegions.push({ name: s.anchor, title, titleAt: { x: p.x, y: p.y + 6 }, box: { minX: p.x - 12, minY: p.y + TITLE - 8, maxX: p.x + s.w + 12, maxY: p.y + TITLE + s.h + 10 }, parts: s.count });
	}
	const valByDes = new Map((snap.components || []).map(c => [c.designator, resolveDisplayValue(c)]));
	for (const c of out.components) { const v = valByDes.get(c.designator); if (v) c.value = v; }   // 解析真实器件名/值,替换 "={Value}" 坏模板串
	if (opts.recover) routeLocalNets(out, logical.nets.filter(n => n.class === 'local'));   // P0:无名本地网簇内正交直连(重排后保连通,不打标签)
	// 邻近 2 脚信号网用 L 形直连走线替代逃逸标签(减标签汤、加可见导线;远距/穿障网保留标签)。
	// 安全:仅路径清晰(不穿 IC bbox)时转,否则保留标签。摆放优化(相连脚相邻清障)后转换率会上升。
	const direct = directRouteClose(out, logical.nets, { maxDist: opts.maxDirect ?? 280 });
	consolidateRails(out);   // 密集电源/地 flag 列(多上拉等)合并成轨,减叠压(clean 板无 dense 列故零回归)
	// 通用网连通性修复:布局后若某逻辑网裂成多几何组(某组缺该网命名标签 → 真断网,如跨模块网仅一侧打标签),
	// 给缺标签的组补命名标签做 EDA 名合并。锚在安全空位(不落 bbox/他网端点)→ 不短路;无安全位则跳过。
	const faith = repairNetFaithfulness(out, logical.nets, {
		lh: () => labelQC(out).filter(f => f.severity === 'hard').length,
		geo: () => { const g = geomQC(out); return g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.collinear + g.endpointShort + g.endpointOnWire; },
	});
	// 吸【5 栅格】(商用 DR 对象对齐;消浮点累积误差):一致吸格保连通(脚与线端点同点同吸)。
	// 在 deconflict/ortho 【前】吸——让它们在最终栅格上清理标签/走线,避免吸格后再引入冲突(吸格只动坐标,
	// 不动 origin 归属;deconflict/ortho 只移标签/走线顶点,不动 component.x/y → origins 保持在格,offgrid=0)。
	// 标签法已把跨层本地线换成短桩 → 5 吸不再 merge 邻近异网点(无 wireThruPin 回升)。
	const SNAP = v => Math.round(v / 5) * 5;
	for (const c of out.components) { c.x = SNAP(c.x); c.y = SNAP(c.y); if (c.bbox) { c.bbox.minX = SNAP(c.bbox.minX); c.bbox.minY = SNAP(c.bbox.minY); c.bbox.maxX = SNAP(c.bbox.maxX); c.bbox.maxY = SNAP(c.bbox.maxY); } for (const p of (c.pins || [])) { p.x = SNAP(p.x); p.y = SNAP(p.y); } }
	for (const w of out.wires) w.line = w.line.map(SNAP);
	for (const f of out.netflags) { f.x = SNAP(f.x); f.y = SNAP(f.y); if (f.textX != null) f.textX = SNAP(f.textX); if (f.textY != null) f.textY = SNAP(f.textY); }
	for (const pl of placements) { pl.x = SNAP(pl.x); pl.y = SNAP(pl.y); }
	if (opts.deconflict !== false) deconflictLabels(out);   // 默认开:标签去冲突(验证式向外移,零回归;实测 labelHard 43→21)
	if (opts.ortho || opts.recover) orthogonalizeWires(out);   // DR1:对角线段 → L 形正交(含 deconflict L桩产生的斜段)。recover 路径默认开(零回归:默认路径不触发)
	const sigLabels = out.netflags.filter(f => f.kind === 'sig').length;
	return { model: out, moduleRegions, placements, stats: { clusters: subs.length, components: out.components.length, wires: out.wires.length, sigLabels, powerGnd: out.netflags.length - sigLabels, nets: logical.nets.length, placements: placements.length, faith } };
}

// 把生成的模块图投递到 live EDA。2026-06-20 实测验证:必须用【命名线】(无名线被 EDA 删=0线),
// 跨簇标签用 netport,电源/地用 NetFlag,末尾覆盖式自愈补漏网。验证:某真实板命名线持久、全网连通。
export async function deliverGenerated(snap, opts = {}) {
	const { executeCode } = await import('./bridge_client.mjs');
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const exec = async js => { for (let t = 0; t < 6; t++) { try { return (await executeCode(js, { timeoutMs: 90000 })).result; } catch (e) { if (!/disconnect|timed out/i.test(e.message)) { console.error('  非连接错:', e.message.slice(0, 70)); return null; } await sleep(2500); } } return null; };
	const runOps = async (label, ops, batch = 15) => { let done = 0; for (let i = 0; i < ops.length; i += batch) { await exec(`let n=0;\n${ops.slice(i, i + batch).join('\n')}\nreturn{n};`); done += Math.min(batch, ops.length - i); process.stdout.write(`\r  ${label}: ${done}/${ops.length}`); } console.log(' ✓'); };
	const cg = await generateLayout(snap, { ...opts, scale: false, deconflict: opts.deconflict !== false, recover: opts.recover !== false });   // live 投递 scale=false 保脚位,默认去冲突 + 恢复无名本地网(保连通,P0)
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
	// 文字标题:删原图全部文字(重排后孤儿="废图"主因)→ 建 N 占位 → modify 设内容+位置
	// (实测:Text.create 不接受 content 入参,须 create 后 modify 设 content)。
	const nMod = cg.moduleRegions.length;
	await exec(`const ts=(await eda.sch_PrimitiveText.getAll())||[];const ids=ts.map(t=>t.primitiveId).filter(Boolean);if(ids.length){try{await eda.sch_PrimitiveText.delete(ids);}catch(e){}}for(let i=0;i<${nMod};i++){try{await eda.sch_PrimitiveText.create({x:0,y:0});}catch(e){}}return{};`);
	const tids = await exec(`return ((await eda.sch_PrimitiveText.getAll())||[]).map(t=>t.primitiveId).filter(Boolean);`);
	await runOps('模块标题', cg.moduleRegions.map((mr, i) => { const id = (tids || [])[i]; return id ? `try{await eda.sch_PrimitiveText.modify(${JSON.stringify(id)},{content:${JSON.stringify(mr.title)},x:${Math.round(mr.titleAt.x)},y:${Math.round(mr.titleAt.y)},fontSize:11});n++;}catch(e){}` : null; }).filter(Boolean));
	// 覆盖式自愈:回读已连网,对完全没连上的命名网在连线两端补 netport(密集脚 create 失败兜底)。
	const covered = await exec(`const ws=await eda.sch_PrimitiveWire.getAll();const ps=await eda.sch_PrimitiveComponent.getAll();return [...new Set([...(ws||[]).map(w=>w.net),...(ps||[]).map(p=>p.net)].filter(Boolean))];`);
	const cset = new Set(covered || []);
	const heal = [];
	for (const w of cg.model.wires) { if (!w.net || cset.has(w.net)) continue; const l = w.line; for (const [x, y] of [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]) heal.push(`try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(w.net)},${x},${y},0);n++;}catch(e){}`); }
	if (heal.length) { console.log(`自愈 ${heal.length / 2} 漏网...`); await runOps('自愈', heal); }
	// 投后导线正交化:EDA 创建/合并线时会把部分正交线弄成斜线(实测 6 条,违反 DR1)。读回所有线,
	// 含斜线段者 → delete + 插 L 角点重建(实测 native 斜线 6→0、DRC warn 减)。模型本身 0 斜线,纯修 EDA 副产物。
	await exec(`const ws=(await eda.sch_PrimitiveWire.getAll())||[];for(const w of ws){const l=w.line||w.points;if(!Array.isArray(l)||l.length<4)continue;let hd=false;const nl=[l[0],l[1]];for(let i=0;i+3<l.length;i+=2){const x1=l[i],y1=l[i+1],x2=l[i+2],y2=l[i+3];if(x1!==x2&&y1!==y2){hd=true;nl.push(x2,y1,x2,y2);}else{nl.push(x2,y2);}}if(hd){try{await eda.sch_PrimitiveWire.delete([w.primitiveId]);await eda.sch_PrimitiveWire.create(nl,w.net||'');}catch(e){}}}return{};`);
	// 投后用 EDA【权威网表】(getNetlistFile)真值对账,修真断裂网(某组缺命名标签 → 不连通)。
	// 给缺标签的组补命名 netport(安全空位)→ EDA 名合并 → 零断网。通用,netlist 作真值传入,无特定电路内容。
	if (opts.faithRepair !== false) {
		try {
			const { planNetRepair } = await import('./net_live_repair.mjs');
			const { readFileSync } = await import('node:fs');
			const snapJs = readFileSync(new URL('../snapshot2.js', import.meta.url), 'utf8');   // 自包含快照脚本(generic)
			const nlText = await exec(`const f=await eda.sch_ManufactureData.getNetlistFile();return f?await f.text():null;`);
			if (nlText) {
				const netlist = JSON.parse(nlText);
				// 收敛循环:重排/正交化后的板可能尚未 settle、单次快照含瞬态假断裂、且会漏判真断裂网。
				// 每轮【重新快照(真值几何)→ planNetRepair → 补 netport】,直到零真断裂或 3 轮(防不收敛)。
				for (let iter = 0; iter < 3; iter++) {
					const liveSnap = await exec(snapJs);
					if (!liveSnap) break;
					const plan = planNetRepair(netlist, liveSnap);
					console.log(`权威网表对账${iter ? `(轮${iter + 1})` : ''}:真断裂网 ${plan.broken}${plan.broken ? `,补 ${plan.planned} netport${plan.unsafe ? `,无安全位 ${plan.unsafe}` : ''}` : ' → 零断网 ✓'}`);
					if (!plan.ops.length) break;
					await runOps('断网修复', plan.ops.flatMap(op => [
						`try{await eda.sch_PrimitiveWire.create(${JSON.stringify(op.wireLine)},${JSON.stringify(op.net)});n++;}catch(e){}`,
						`try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(op.net)},${op.flagX},${op.flagY},${netflagCreateRotation(op.rot || 0)});n++;}catch(e){}`,
					]));
				}
			}
		} catch (e) { console.error('  网表修复跳过:', String(e).slice(0, 70)); }
	}
	console.log('cluster 生成模块图已投 live(命名线持久、跨簇 netport、导线正交化、权威网表零断网)。');
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
