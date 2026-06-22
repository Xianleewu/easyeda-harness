// 连接完整性恢复(P0,通用,零特定电路内容)。
// 解决核心瓶颈:命名网提取漏【无名本地线】(脚到脚直连)→ 重排移件会断这些连接。
// 用 union-find over【所有线 + 引脚】恢复完整连通,得【命名网 + 本地网】完整网表。
//
//   import { recoverConnectivity } from './connectivity_recover.mjs';
//   const { nets, stats } = recoverConnectivity(snapshot);
//
// 与 buildCleanLogical(只命名网)互补且独立:本模块产【完整】网表(含 class 'local'),
// 供重排/投递时保连通;不改 buildCleanLogical 故现有生成路径零回归。
// 设计:① 线内顶点互连 ② 同坐标顶点合并(round 量化)③ 脚贴线【顶点或线段】并入
//       ④ 含命名线的分量=命名网(漏接的脚补回);纯无名分量=本地网。

const seg = (px, py, x1, y1, x2, y2) => {
	const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
	if (L === 0) return Math.hypot(px - x1, py - y1);
	let t = ((px - x1) * dx + (py - y1) * dy) / L; t = Math.max(0, Math.min(1, t));
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const classOf = n => /^(GND|VSS|AGND|DGND|PGND)/i.test(n) ? 'ground'
	: (/^(VBUS|VCC|VDD|VIN|VOUT|VBAT|VSYS|VPP|VEE|AVDD|DVDD|VDDA|VAA|BL_|\+)/i.test(n) || /^\d+V/i.test(n)) ? 'power'
	: 'signal';

export function recoverConnectivity(snap, tol = 5) {
	const comps = snap.components || [], wires = snap.wires || [], flags = snap.netflags || [];
	const pinAt = [];
	for (const c of comps) for (const p of (c.pins || [])) if (p.x != null) pinAt.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y });
	const near = (ax, ay, bx, by) => Math.abs(ax - bx) <= tol && Math.abs(ay - by) <= tol;
	const parent = new Map();
	const qkey = (x, y) => `${Math.round(x)},${Math.round(y)}`;
	const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
	const ensure = a => { if (!parent.has(a)) parent.set(a, a); return a; };
	const union = (a, b) => { parent.set(find(ensure(a)), find(ensure(b))); };
	// ① 线内顶点互连 + 记命名
	const nameOf = new Map();
	for (const w of wires) {
		const l = w.line || []; if (l.length < 2) continue;
		let prev = null;
		for (let i = 0; i + 1 < l.length; i += 2) { const k = qkey(l[i], l[i + 1]); ensure(k); if (prev) union(prev, k); prev = k; }
		if (w.net && w.net.trim()) {
			const r = find(qkey(l[0], l[1]));
			// 同分量多命名 → 短路告警(保留首个,记冲突)
			if (nameOf.has(r) && nameOf.get(r) !== w.net) nameOf.set(r, nameOf.get(r));
			else nameOf.set(r, w.net);
		}
	}
	// ② 电源/地标也并入(标坐标=连接点)
	for (const f of flags) { if (!f.net) continue; const k = qkey(f.x, f.y); ensure(k); nameOf.set(find(k), f.net); }
	// ③ 脚贴线(顶点或线段)→ 并入该分量
	const pinRoot = new Map();
	for (const p of pinAt) {
		const pk = qkey(p.x, p.y); ensure(pk); let on = false, nm = '';
		for (const w of wires) { const l = w.line || []; let hit = false;
			for (let i = 0; i + 3 < l.length; i += 2) if (seg(p.x, p.y, l[i], l[i + 1], l[i + 2], l[i + 3]) <= tol) { union(pk, qkey(l[i], l[i + 1])); hit = true; }
			else for (let i = 0; i + 1 < l.length; i += 2) if (near(p.x, p.y, l[i], l[i + 1])) { union(pk, qkey(l[i], l[i + 1])); hit = true; }
			if (hit) { on = true; if (w.net && w.net.trim()) nm = w.net; }
		}
		// 脚也可能贴电源/地标
		for (const f of flags) if (f.net && near(p.x, p.y, f.x, f.y)) { union(pk, qkey(f.x, f.y)); on = true; nm = f.net; }
		if (on) { const r = find(pk); pinRoot.set(p.ref, r); if (nm && !nameOf.has(r)) nameOf.set(r, nm); }
	}
	// ④ 按分量归网:命名分量→命名网(漏脚补回);纯无名(≥2脚)→本地网
	const byRoot = new Map();
	for (const [ref, root] of pinRoot) { if (!byRoot.has(root)) byRoot.set(root, []); byRoot.get(root).push(ref); }
	const nets = [];
	let li = 0;
	for (const [root, refs] of byRoot) {
		const nm = nameOf.get(root);
		if (nm) nets.push({ name: nm, class: classOf(nm), pins: refs });
		else if (refs.length >= 2) nets.push({ name: `LOCAL_${++li}`, class: 'local', pins: refs });
	}
	// 合并同名命名网(同名分量分散时)
	const merged = new Map();
	for (const n of nets) {
		if (n.class === 'local') { merged.set(n.name, n); continue; }
		if (!merged.has(n.name)) merged.set(n.name, { name: n.name, class: n.class, pins: new Set() });
		for (const r of n.pins) merged.get(n.name).pins.add(r);
	}
	const out = [...merged.values()].map(n => ({ name: n.name, class: n.class, pins: n.pins instanceof Set ? [...n.pins] : n.pins }));
	const named = out.filter(n => n.class !== 'local').length, local = out.filter(n => n.class === 'local').length;
	const covered = new Set(); for (const n of out) for (const r of n.pins) covered.add(r);
	return { nets: out, stats: { totalPins: pinAt.length, covered: covered.size, named, local, localPins: out.filter(n => n.class === 'local').reduce((a, n) => a + n.pins.length, 0) } };
}
