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
	const classOf = n => /^GND/i.test(n) ? 'ground' : /^(VBUS|VCC|5V|3V|BL_|\+)/i.test(n) ? 'power' : 'signal';
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

// 生成:每簇内 elkLayout(簇内信号→线、跨簇→标签),shelf-packing 排布,产模型 + moduleRegions(带框标题)。
export async function generateLayout(snap, opts = {}) {
	const logical = buildCleanLogical(snap);
	const cluster = clusterComponents(snap, logical);
	if (!cluster) return null;
	const compByDes = new Map((snap.components || []).map(c => [c.designator, c]));
	const subs = [];
	for (const [anchor, members] of cluster) {
		const mset = new Set(members);
		const subComps = members.map(d => compByDes.get(d)).filter(Boolean);
		const subLogical = { nets: logical.nets.map(n => ({ ...n, pins: n.pins.filter(p => mset.has(p.slice(0, p.lastIndexOf('.')))) })).filter(n => n.pins.length >= 1) };
		const byDes = new Map(subComps.map(c => [c.designator, withLocalPins(c)]));
		const m = await elkLayout({ snapshot: { ...snap, components: subComps }, logical: subLogical, byDes, scale: opts.scale !== false, powerEdges: true });
		const bb = m.components.reduce((a, c) => ({ minX: Math.min(a.minX, c.bbox.minX), minY: Math.min(a.minY, c.bbox.minY), maxX: Math.max(a.maxX, c.bbox.maxX), maxY: Math.max(a.maxY, c.bbox.maxY) }), { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 });
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
	const sigLabels = out.netflags.filter(f => f.kind === 'sig').length;
	return { model: out, moduleRegions, placements, stats: { clusters: subs.length, components: out.components.length, wires: out.wires.length, sigLabels, powerGnd: out.netflags.length - sigLabels, nets: logical.nets.length, placements: placements.length } };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('engine/cluster_generate.mjs')) {
	const { readFileSync } = await import('node:fs');
	const { renderSheetOutput } = await import('./sheet_renderer.mjs');
	const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
	const file = process.argv[2] || `${ROOT}/live_clean.json`;
	const outPng = process.argv[3] || `${ROOT}/cluster_generate.png`;
	const snap = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
	const r = await generateLayout(snap);
	if (!r) { console.error('无 IC 锚点,无法聚类生成'); process.exit(1); }
	console.log(`生成模块图: ${JSON.stringify(r.stats)}`);
	renderSheetOutput(r.model, outPng, { moduleRegions: r.moduleRegions });
	console.log(`渲染 -> ${outPng}`);
}
