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
		const base = lh(model); if (base === 0) break; const bg = geo(model);
		let best = null;
		for (const f of model.netflags) {
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
		const m = await elkLayout({ snapshot: { ...snap, components: subComps }, logical: subLogical, byDes, scale: opts.scale !== false, powerEdges: true, layoutOptions: opts.layoutOptions || {} });
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
	await runOps('网标/符号', cg.model.netflags.map(f => { const x = f.x, y = f.y, r = f.rot || 0; if (f.kind === 'sig') return `try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(f.net)},${x},${y},${r});n++;}catch(e){}`; return `try{await eda.sch_PrimitiveComponent.createNetFlag('${f.kind === 'gnd' ? 'Ground' : 'Power'}',${JSON.stringify(f.net)},${x},${y},${r});n++;}catch(e){}`; }));
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
