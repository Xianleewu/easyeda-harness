// 综合布局质量诊断探针(通用,零特定电路内容)。
// 把"原理图是否商用级"拆成 6 大类可量化检测,聚合 geom_qc/label_qc/net_qc + 新增
// 连接完整性 / 器件间距 / 电源地处理 / 标注完整 / 图纸结构。每类返回 {severity,count,items}。
//
//   import { layoutAudit } from './layout_audit.mjs';
//   const rep = layoutAudit(snapshot);   // 任意 EasyEDA 快照(含 pin 坐标)
//
// 设计原则:① 纯函数、无副作用、确定性;② 对任意板通用,不含任何器件名/网名字面量;
// ③ 严重度 critical(断功能)>high(违规则)>medium(标注)>low(美观);④ 每项带样例便于定位。
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { netQC } from './net_qc.mjs';
import { recoverConnectivity } from './connectivity_recover.mjs';

const GRID = 5;          // 商用栅格(DR:对象吸 5/10 栅格)
const MIN_GAP = 8;       // 相邻器件 bbox 最小净间距(< 此值视为过密,易视觉粘连)
const TOL = 5;           // 脚-线贴合容差

// 器件 bbox 兜底:无 bbox 则按 pin 包络 + 余量估算(任意快照鲁棒)。
function compBox(c) {
	if (c.bbox && c.bbox.minX != null) return c.bbox;
	const ps = (c.pins || []).filter(p => p.x != null);
	if (!ps.length) return null;
	let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
	for (const p of ps) { mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y); mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y); }
	return { minX: mnx - 6, minY: mny - 6, maxX: mxx + 6, maxY: mxy + 6 };
}

// 两 bbox 净间距(负=重叠;按各轴分离距离取较大,即"最近边到边")。
function boxGap(a, b) {
	const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX);
	const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY);
	if (dx < 0 && dy < 0) return Math.max(dx, dy);   // 重叠:返回负(重叠深度)
	return Math.max(dx, dy, 0);
}

// 点到线段距离(脚-线段贴合判定)。
function segDist(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
	if (L === 0) return Math.hypot(px - x1, py - y1);
	let t = ((px - x1) * dx + (py - y1) * dy) / L; t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ── 1) 连接完整性(critical):netlist 提取是否丢连接 + 浮空脚 + 单节点网 ──
// 核心商用底线:重排/重画前,网表必须完整。检测"有线连但提取不到网"的脚=潜在断连源。
function auditConnectivity(snap) {
	const comps = snap.components || [], wires = snap.wires || [];
	const logical = recoverConnectivity(snap);   // 用【完整】网表(含 union-find 恢复的本地网)→ 漏连=恢复后仍不可达者
	const inNet = new Set();
	const netByPin = new Map();
	for (const n of logical.nets) for (const r of n.pins) { inNet.add(r); netByPin.set(r, n); }
	// 几何上"被导线贴合"的脚
	const onWire = ref => false;
	const items = [];
	let lostConn = 0, floating = 0, ncFloat = 0;
	for (const c of comps) for (const p of (c.pins || [])) {
		if (p.x == null) continue;
		const ref = `${c.designator}.${p.num}`;
		let wired = false;
		for (const w of wires) { const l = w.line || []; let hit = false;
			for (let i = 0; i + 1 < l.length; i += 2) if (Math.abs(l[i] - p.x) <= TOL && Math.abs(l[i + 1] - p.y) <= TOL) { hit = true; break; }
			if (!hit) for (let i = 0; i + 3 < l.length; i += 2) if (segDist(p.x, p.y, l[i], l[i + 1], l[i + 2], l[i + 3]) <= TOL) { hit = true; break; }
			if (hit) { wired = true; break; }
		}
		if (wired && !inNet.has(ref)) { lostConn++; if (items.length < 30) items.push({ rule: 'C1-lost-connection', sev: 'critical', ref, msg: `脚 ${ref} 有导线相连但未进网表(提取漏连→重排会断)` }); }
		else if (!wired) { if (p.noConnected) ncFloat++; else { floating++; if (items.length < 40) items.push({ rule: 'C2-floating-pin', sev: 'high', ref, msg: `脚 ${ref}(${p.name || ''})浮空且未标 NC` }); } }
	}
	// 单节点命名信号网(只 1 个脚,缺对端)
	let singleNode = 0;
	for (const n of logical.nets) {
		if (n.class !== 'signal') continue;
		if (n.pins.length === 1) { singleNode++; if (items.length < 60) items.push({ rule: 'C3-single-node-net', sev: 'high', ref: n.name, msg: `信号网 ${n.name} 只连 1 脚(${n.pins[0]}),缺对端` }); }
	}
	return { count: lostConn + floating + singleNode, lostConn, floating, ncFloat, singleNode, items };
}

// ── 2) 器件间距/对齐(high/low):重叠 + 过密 + 栅格对齐 ──
function auditSpacing(snap) {
	const comps = (snap.components || []).map(c => ({ d: c.designator, box: compBox(c), x: c.x, y: c.y })).filter(c => c.box);
	const items = [];
	let overlap = 0, tooTight = 0, offgrid = 0;
	for (let i = 0; i < comps.length; i++) for (let j = i + 1; j < comps.length; j++) {
		const g = boxGap(comps[i].box, comps[j].box);
		if (g < 0) { overlap++; if (items.length < 25) items.push({ rule: 'S1-comp-overlap', sev: 'critical', ref: `${comps[i].d}×${comps[j].d}`, msg: `器件 bbox 重叠(深度 ${(-g).toFixed(0)}px)` }); }
		else if (g < MIN_GAP) { tooTight++; if (items.length < 40) items.push({ rule: 'S2-too-tight', sev: 'high', ref: `${comps[i].d}×${comps[j].d}`, msg: `器件净间距 ${g.toFixed(0)}px < ${MIN_GAP}(易视觉粘连)` }); }
	}
	for (const c of comps) { if (c.x != null && (c.x % GRID !== 0 || c.y % GRID !== 0)) { offgrid++; if (items.length < 60) items.push({ rule: 'S3-offgrid', sev: 'low', ref: c.d, msg: `器件原点 (${c.x},${c.y}) 未吸 ${GRID} 栅格` }); } }
	return { count: overlap + tooTight + offgrid, overlap, tooTight, offgrid, items };
}

// ── 3) 电源/地处理(high/medium):杂散标 + 悬空标 + 去耦就近 + 电源地脚缺标 ──
function auditPowerGround(snap) {
	const nq = netQC(snap);
	const comps = snap.components || [], wires = snap.wires || [];
	const items = [];
	for (const s of nq.strayPowerFlags || []) items.push({ rule: 'P1-stray-power-flag', sev: 'high', ref: s.flag, msg: `电源标 ${s.flag}@(${s.x},${s.y}) 落他网 ${s.onNet} 上(串电源到信号)` });
	for (const s of (nq.danglingFlags || []).slice(0, 20)) items.push({ rule: 'P2-dangling-flag', sev: 'medium', ref: s.net, msg: `网标 ${s.net}@(${s.x},${s.y}) 下方无脚无线(悬空)` });
	// 去耦电容就近:仅【真去耦电容】(两脚都在电源/地网)应贴近某 IC 电源脚。信号/去抖/滤波电容不算去耦,不 flag。
	const isPwrGnd = n => /^(GND|VSS|AGND|DGND|PGND|VBUS|VCC|VDD|VIN|VOUT|VBAT|VSYS|AVDD|DVDD|VDDA|BL_|\+)/i.test(n || '') || /^\d+V/i.test(n || '');
	const pinNet = new Map();   // "des.num" → 网名(用完整恢复网表,含本地网)
	for (const n of recoverConnectivity(snap).nets) for (const r of (n.pins || [])) pinNet.set(r, n.name);
	const isDecoupCap = c => { const pn = (c.pins || []).map(p => pinNet.get(`${c.designator}.${p.num}`)); return pn.length >= 2 && pn.every(n => isPwrGnd(n)); };
	const ics = comps.filter(c => /^(U|FPC|J)/.test(c.designator || '')).map(c => compBox(c)).filter(Boolean);
	let farDecouple = 0;
	for (const c of comps) {
		if (!/^C/.test(c.designator || '')) continue;
		if (!isDecoupCap(c)) continue;   // 只查真去耦电容
		const box = compBox(c); if (!box || !ics.length) continue;
		const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
		let near = 1e9; for (const b of ics) { const bx = Math.max(b.minX - cx, 0, cx - b.maxX), by = Math.max(b.minY - cy, 0, cy - b.maxY); near = Math.min(near, Math.hypot(bx, by)); }
		if (near > 120) { farDecouple++; if (items.length < 50) items.push({ rule: 'P3-decouple-far', sev: 'medium', ref: c.designator, msg: `电容 ${c.designator} 距最近 IC ${near.toFixed(0)}px(去耦应就近<120)` }); }
	}
	return { count: items.length, stray: (nq.strayPowerFlags || []).length, dangling: (nq.danglingFlags || []).length, farDecouple, items };
}

// ── 4) 标注完整(medium):器件值缺失 + 信号网缺标签 + ERC 引脚类型 ──
function auditAnnotation(snap) {
	const comps = snap.components || [];
	const nq = netQC(snap);
	const items = [];
	let noVal = 0;
	for (const c of comps) {
		const v = c.value || (c.attrs || []).find(a => /^Value$/i.test(a.key))?.value;
		const bad = !v || /^=?\{.*\}$/.test(v);   // 空 或 未解析模板串 ={Value}
		if (bad && /^([RCL]|FB|RN|Y|D|Q)/.test(c.designator || '')) { noVal++; if (items.length < 30) items.push({ rule: 'A1-missing-value', sev: 'medium', ref: c.designator, msg: `${c.designator} 缺器件值/型号标注(${v || '空'})` }); }
	}
	for (const e of (nq.ercPinType || []).slice(0, 10)) items.push({ rule: 'A2-erc-pin-type', sev: 'medium', ref: e.ref, msg: `${e.ref} 引脚电气类型 ${e.pinType}(应 ${e.expect},符号库级)` });
	return { count: noVal + (nq.ercPinType || []).length, noVal, ercPinType: (nq.ercPinType || []).length, items };
}

// ── 5) 走线规范(high/critical):斜线 + 异网交叉 + 短路 + 线穿件/脚 + 畸形线 ──
function auditRouting(snap) {
	const model = { components: snap.components || [], wires: snap.wires || [], netflags: snap.netflags || [] };
	const g = geomQC(model);
	const nq = netQC(snap);
	let diag = 0; for (const w of model.wires) { const l = w.line || []; for (let i = 0; i + 3 < l.length; i += 2) if (l[i + 2] - l[i] !== 0 && l[i + 3] - l[i + 1] !== 0) diag++; }
	const items = [];
	if (diag) items.push({ rule: 'R1-diagonal-wire', sev: 'high', count: diag, msg: `${diag} 条斜线段(DR1:须正交)` });
	if (g.crossings) items.push({ rule: 'R2-net-crossing', sev: 'medium', count: g.crossings, msg: `${g.crossings} 处异网导线交叉` });
	const shorts = g.collinear + g.endpointShort + g.endpointOnWire;
	if (shorts) items.push({ rule: 'R3-short', sev: 'critical', count: shorts, msg: `${shorts} 处视觉短路(共线/端点重合/端点落他线)` });
	if (g.wireThruComp.length) items.push({ rule: 'R4-wire-thru-comp', sev: 'critical', count: g.wireThruComp.length, msg: `${g.wireThruComp.length} 处导线穿器件体` });
	if (g.wireThruPin.length) items.push({ rule: 'R5-wire-thru-pin', sev: 'critical', count: g.wireThruPin.length, msg: `${g.wireThruPin.length} 处导线穿他脚` });
	if ((nq.malformedWires || []).length) items.push({ rule: 'R6-malformed-wire', sev: 'high', count: nq.malformedWires.length, msg: `${nq.malformedWires.length} 条畸形线(回折/零长)` });
	const count = diag + g.crossings + shorts + g.wireThruComp.length + g.wireThruPin.length + (nq.malformedWires || []).length;
	return { count, diag, crossings: g.crossings, shorts, wireThruComp: g.wireThruComp.length, wireThruPin: g.wireThruPin.length, malformed: (nq.malformedWires || []).length, items };
}

// ── 6) 标签放置 + 图纸结构(medium/low):label_qc 硬伤 + 图纸利用率/聚集度 ──
function auditStructure(snap) {
	const model = { components: snap.components || [], wires: snap.wires || [], netflags: snap.netflags || [] };
	const lh = labelQC(model).filter(f => f.severity === 'hard');
	const items = [];
	const byRule = {};
	for (const f of lh) byRule[f.rule || f.kind] = (byRule[f.rule || f.kind] || 0) + 1;
	for (const [r, n] of Object.entries(byRule)) items.push({ rule: `L-${r}`, sev: 'medium', count: n, msg: `${n} 处标签硬伤(${r})` });
	// 图纸利用率:内容 bbox 占比 + 器件密度(过疏=散落,过密=堆叠)。
	const boxes = (snap.components || []).map(compBox).filter(Boolean);
	let s = { count: lh.length, labelHard: lh.length, items };
	if (boxes.length) {
		let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9, area = 0;
		for (const b of boxes) { mnx = Math.min(mnx, b.minX); mny = Math.min(mny, b.minY); mxx = Math.max(mxx, b.maxX); mxy = Math.max(mxy, b.maxY); area += (b.maxX - b.minX) * (b.maxY - b.minY); }
		const W = mxx - mnx, H = mxy - mny, fill = area / (W * H);
		const aspect = Math.max(W, H) / Math.max(1, Math.min(W, H));
		s.contentW = Math.round(W); s.contentH = Math.round(H); s.fillRatio = +fill.toFixed(3); s.aspect = +aspect.toFixed(2);
		if (fill < 0.04) items.push({ rule: 'T1-too-sparse', sev: 'low', msg: `器件占内容区仅 ${(fill * 100).toFixed(1)}%(过散/留白多)` });
		if (fill > 0.5) items.push({ rule: 'T2-too-dense', sev: 'high', msg: `器件占内容区 ${(fill * 100).toFixed(1)}%(过密堆叠)` });
		if (aspect > 2.5) items.push({ rule: 'T3-bad-aspect', sev: 'low', msg: `内容纵横比 ${aspect.toFixed(1)}(>2.5 不适合 landscape 图纸)` });
		s.count += items.length - byRule.length || 0;
	}
	return s;
}

export function layoutAudit(snap) {
	const categories = {
		连接完整性: auditConnectivity(snap),
		走线规范: auditRouting(snap),
		器件间距对齐: auditSpacing(snap),
		电源地处理: auditPowerGround(snap),
		标注完整: auditAnnotation(snap),
		标签结构: auditStructure(snap),
	};
	const byCrit = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const cat of Object.values(categories)) for (const it of cat.items || []) byCrit[it.sev || (it.rule && it.rule.startsWith('R3') ? 'critical' : 'medium')] = (byCrit[it.sev] || 0) + (it.count || 1);
	const total = Object.values(categories).reduce((a, c) => a + (c.count || 0), 0);
	return { categories, summary: { total, byCategory: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.count])), byCriticality: byCrit } };
}
