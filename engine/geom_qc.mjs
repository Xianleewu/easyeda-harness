// 几何/视觉自检：器件重叠、标签重叠、线压器件、出格、导线交叉
import { readFileSync } from 'node:fs';

export function geomQC(model, opt = {}) {
	const grid = opt.grid || 10;
	const comps = model.components.filter(c => c.bbox);
	const flags = (model.netflags || []);
	const rects = [];
	for (const c of comps) rects.push({ tag: c.designator, ...c.bbox });
	for (const f of flags) if (f.bbox) rects.push({ tag: `[${f.net}]`, minX: f.bbox.minX, minY: f.bbox.minY, maxX: f.bbox.maxX, maxY: f.bbox.maxY });

	const ov = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
	const inset = (r, m) => ({ minX: r.minX + m, minY: r.minY + m, maxX: r.maxX - m, maxY: r.maxY - m });

	// 1) 矩形互相重叠（器件/标签 bbox）
	const overlaps = [];
	for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
		if (ov(inset(rects[i], 1), inset(rects[j], 1))) overlaps.push(`${rects[i].tag} x ${rects[j].tag}`);

	// 2) 导线段穿过器件 bbox 内部
	const segs = [];
	for (const w of model.wires) for (let i = 0; i + 3 < w.line.length; i += 2) {
		const a = [w.line[i], w.line[i + 1]], b = [w.line[i + 2], w.line[i + 3]];
		if (a[0] === b[0] && a[1] === b[1]) continue; segs.push({ a, b, net: w.net });
	}
	const segInRect = (s, r) => { // 仅判轴向线段是否穿过矩形内部（端点贴边不算）
		const ri = inset(r, 1);
		if (s.a[0] === s.b[0]) { const x = s.a[0]; if (x <= ri.minX || x >= ri.maxX) return false; const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]); return y0 < ri.maxY && y1 > ri.minY; }
		if (s.a[1] === s.b[1]) { const y = s.a[1]; if (y <= ri.minY || y >= ri.maxY) return false; const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]); return x0 < ri.maxX && x1 > ri.minX; }
		return false;
	};
	const wireThruComp = [];
	for (const s of segs) for (const c of comps) if (segInRect(s, c.bbox)) wireThruComp.push(`net=${s.net || ''} thru ${c.designator}`);

	// 2b) 导线内部压到引脚（非端点）→ 短路外部脚:EDA 拒建此类线（wireThruComp 只查
	//     本体 bbox,漏了伸出本体外的引脚;这是 live 写回丢线的真实根因）。
	const pins = [];
	for (const c of comps) for (const p of (c.pins || [])) pins.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y });
	const ptOnSegInterior = (px, py, s) => {
		const [ax, ay] = s.a, [bx, by] = s.b;
		if ((Math.abs(px - ax) < 1 && Math.abs(py - ay) < 1) || (Math.abs(px - bx) < 1 && Math.abs(py - by) < 1)) return false; // 端点不算
		if (ay === by) return Math.abs(py - ay) < 1 && px > Math.min(ax, bx) && px < Math.max(ax, bx);
		if (ax === bx) return Math.abs(px - ax) < 1 && py > Math.min(ay, by) && py < Math.max(ay, by);
		return false;
	};
	const wireThruPin = [];
	for (const s of segs) for (const p of pins) if (ptOnSegInterior(p.x, p.y, s)) wireThruPin.push(`net=${s.net || ''} thru pin ${p.ref}`);

	// 3) 出格（引脚 / 导线点不在栅格）
	let offgrid = 0; const offEx = [];
	const chk = (x, y, tag) => { if (x % grid !== 0 || y % grid !== 0) { offgrid++; if (offEx.length < 8) offEx.push(`${tag}(${x},${y})`); } };
	for (const c of comps) for (const p of c.pins || []) chk(p.x, p.y, c.designator);

	// 4) 导线交叉（不同 net 的正交线相交于非端点）
	let crossings = 0; const crossEx = [];
	const H = segs.filter(s => s.a[1] === s.b[1]); const V = segs.filter(s => s.a[0] === s.b[0]);
	for (const h of H) for (const v of V) {
		if (!h.net || !v.net) continue;
		const hx0 = Math.min(h.a[0], h.b[0]), hx1 = Math.max(h.a[0], h.b[0]), hy = h.a[1];
		const vy0 = Math.min(v.a[1], v.b[1]), vy1 = Math.max(v.a[1], v.b[1]), vx = v.a[0];
		if (vx > hx0 && vx < hx1 && hy > vy0 && hy < vy1 && (h.net || '') !== (v.net || '')) { crossings++; if (crossEx.length < 8) crossEx.push(`${h.net}x${v.net}@(${vx},${hy})`); }
	}

	// 5) 共线异网重叠（两段同 y/同 x、范围内部重叠、异网 = 电气短路；上面的正交点相交检测漏掉这类）
	let collinear = 0; const collEx = [];
	const Hs = segs.filter(s => s.a[1] === s.b[1] && s.net);
	const Vs = segs.filter(s => s.a[0] === s.b[0] && s.net);
	const rng = (s, ax) => [Math.min(s.a[ax], s.b[ax]), Math.max(s.a[ax], s.b[ax])];
	const checkColl = (arr, lineAx, rngAx) => {
		for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
			const s = arr[i], t = arr[j];
			if (s.a[lineAx] !== t.a[lineAx]) continue;            // 不同线坐标
			if ((s.net || '') === (t.net || '')) continue;        // 同网不是短路
			const [s0, s1] = rng(s, rngAx), [t0, t1] = rng(t, rngAx);
			if (Math.max(s0, t0) < Math.min(s1, t1)) {            // 内部重叠（严格,端点相贴不算）
				collinear++; if (collEx.length < 8) collEx.push(`${s.net}|${t.net}@${lineAx === 1 ? 'y' : 'x'}=${s.a[lineAx]}`);
			}
		}
	};
	checkColl(Hs, 1, 0);   // 水平段:同 y(轴1)、比 x 范围(轴0)
	checkColl(Vs, 0, 1);   // 竖直段:同 x(轴0)、比 y 范围(轴1)

	// 6) 异网端点重合（两条异网线在同一点都有端点 = 该点把两网短在一起；crossings/collinear/wireThruPin 都排端点故漏）
	let endpointShort = 0; const endEx = [];
	const ptNet = new Map();   // "x,y" → Set(net)
	for (const s of segs) {
		if (!s.net) continue;
		for (const [px, py] of [s.a, s.b]) {
			const k = `${px},${py}`;
			if (!ptNet.has(k)) ptNet.set(k, new Set());
			ptNet.get(k).add(s.net);
		}
	}
	for (const [k, nets] of ptNet) {
		if (nets.size > 1) { endpointShort++; if (endEx.length < 8) endEx.push(`${[...nets].join('|')}@${k}`); }
	}

	// 7) 异网 T 接（一条线端点落在另一条异网线内部 = 该点短路；wireThruPin 的线-线类比，前述检测皆漏）
	let endpointOnWire = 0; const eowEx = [];
	for (const s of segs) {
		if (!s.net) continue;
		for (const [px, py] of [s.a, s.b]) {
			for (const t of segs) {
				if (t === s || !t.net || t.net === s.net) continue;
				if (ptOnSegInterior(px, py, t)) { endpointOnWire++; if (eowEx.length < 8) eowEx.push(`${s.net}|${t.net}@${px},${py}`); }
			}
		}
	}

	return { overlaps, wireThruComp, wireThruPin, offgrid, offEx, crossings, crossEx, collinear, collEx, endpointShort, endEx, endpointOnWire, eowEx };
}

if (process.argv[1] && process.argv[1].endsWith('geom_qc.mjs') && process.argv[2]) {
	const m = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
	const r = geomQC(m);
	console.log('=== GEOM QC:', process.argv[2], '===');
	console.log('bbox重叠:', r.overlaps.length); r.overlaps.slice(0, 20).forEach(s => console.log('  ', s));
	console.log('线压器件:', r.wireThruComp.length); r.wireThruComp.slice(0, 12).forEach(s => console.log('  ', s));
	console.log('出格脚:', r.offgrid, r.offEx.join(' '));
	console.log('异网交叉:', r.crossings, r.crossEx.join(' '));
}
