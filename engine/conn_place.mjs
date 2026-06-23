// 连接驱动模块摆放器(通用,零特定电路内容)。
//
// 目标:把【共享信号网】的模块摆【相邻 + 朝向对方】,最小化跨模块连接长 → 连接短到可直连(替代标签汤)。
// 现有 BLF/row 装箱只优化面积、不保证相连模块相邻(实测连接中位 ~480px 不变);本摆放器贪心构造:
//   ① 连通度排序(最相连者起,贪心接共享最多)② 每模块试【已放模块四邻位 × 镜像】,选连接长最小且不叠的位。
//
//   import { connPlace } from './conn_place.mjs';
//   const pos = connPlace(subs, nets, {pad,base});   // subs=[{id,w,h,pins:[{ref,x,y}]}](x,y 局部 0..w/0..h)
//   // 返回 Map id → {X,Y,mir}(全局左上角 + 是否水平镜像)
//
// 镜像:脚局部 x → w - x(绕模块水平中线)。连接长用曼哈顿距。

export function connPlace(subs, nets, opts = {}) {
	const PAD = opts.pad ?? 40, BASE = opts.base ?? 60;
	const subById = new Map(subs.map(s => [s.id, s]));
	const refSub = new Map();
	for (const s of subs) for (const p of s.pins) refSub.set(p.ref, s.id);
	const pinLocal = new Map();
	for (const s of subs) { const m = new Map(); for (const p of s.pins) m.set(p.ref, { x: p.x, y: p.y }); pinLocal.set(s.id, m); }
	const sigNets = nets.filter(n => n.class === undefined || n.class === 'signal');
	const wmap = new Map();
	const W = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; if (wmap.has(k)) return wmap.get(k); let w = 0; for (const net of sigNets) { if (net.pins.some(r => refSub.get(r) === a) && net.pins.some(r => refSub.get(r) === b)) w++; } wmap.set(k, w); return w; };
	// 连通度排序
	const ids = subs.map(s => s.id);
	let start = ids[0], best = -1;
	for (const a of ids) { let d = 0; for (const b of ids) if (a !== b) d += W(a, b); if (d > best) { best = d; start = a; } }
	const order = [start], rem = new Set(ids); rem.delete(start);
	while (rem.size) { let nx = null, bw = -1; for (const a of rem) { let w = 0; for (const p of order) w += W(p, a); if (w > bw) { bw = w; nx = a; } } if (!nx) nx = [...rem][0]; order.push(nx); rem.delete(nx); }
	// 全局脚位
	const gpin = (id, X, Y, mir, ref) => { const l = pinLocal.get(id).get(ref); if (!l) return null; const w = subById.get(id).w; return { x: X + (mir ? w - l.x : l.x), y: Y + l.y }; };
	const pos = new Map();
	const overlap = (X, Y, w, h) => { for (const [id, p] of pos) { const s = subById.get(id); if (X < p.X + s.w + PAD && X + w + PAD > p.X && Y < p.Y + s.h + PAD && Y + h + PAD > p.Y) return true; } return false; };
	pos.set(order[0], { X: BASE, Y: BASE, mir: false });
	for (let i = 1; i < order.length; i++) {
		const id = order[i], s = subById.get(id);
		let bestCost = Infinity, bestPos = null;
		for (const [pid, pp] of pos) {
			const ps = subById.get(pid);
			const cands = [{ X: pp.X + ps.w + PAD, Y: pp.Y }, { X: pp.X - s.w - PAD, Y: pp.Y }, { X: pp.X, Y: pp.Y + ps.h + PAD }, { X: pp.X, Y: pp.Y - s.h - PAD }];
			for (const c of cands) {
				if (c.X < 0 || c.Y < 0 || overlap(c.X, c.Y, s.w, s.h)) continue;
				for (const mir of [false, true]) {
					let cost = 0;
					for (const net of sigNets) {
						const sPins = net.pins.filter(r => refSub.get(r) === id);
						if (!sPins.length) continue;
						const oPins = net.pins.filter(r => pos.has(refSub.get(r)) && refSub.get(r) !== id);
						if (!oPins.length) continue;
						for (const sr of sPins) {
							const g = gpin(id, c.X, c.Y, mir, sr); if (!g) continue;
							let md = Infinity;
							for (const or of oPins) { const op = pos.get(refSub.get(or)); const og = gpin(refSub.get(or), op.X, op.Y, op.mir, or); if (og) md = Math.min(md, Math.abs(g.x - og.x) + Math.abs(g.y - og.y)); }
							if (isFinite(md)) cost += md;
						}
					}
					if (cost < bestCost) { bestCost = cost; bestPos = { X: c.X, Y: c.Y, mir }; }
				}
			}
		}
		if (!bestPos) { let mx = BASE; for (const [id2, p] of pos) mx = Math.max(mx, p.X + subById.get(id2).w + PAD); bestPos = { X: mx, Y: BASE, mir: false }; }
		pos.set(id, bestPos);
	}
	return pos;
}
