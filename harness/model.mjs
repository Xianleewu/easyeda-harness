import { CONFIG } from './config.mjs';

export const round2 = (v) => Math.round(v * 100) / 100;
export const onGrid = (v, g) => Math.abs(v / g - Math.round(v / g)) < 1e-6;
const SNAP = CONFIG.match.snap;
export const key = (x, y) => `${Math.round(x / SNAP) * SNAP},${Math.round(y / SNAP) * SNAP}`;
export const samePt = (ax, ay, bx, by) => Math.abs(ax - bx) < SNAP + 1e-6 && Math.abs(ay - by) < SNAP + 1e-6;
const POWER_NETS = new Set(['GND', 'SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW']);
const TEXT_NET_LABELS = new Set([
	'USB_CC1', 'USB_CC2', 'USB_DN', 'USB_DP', 'RESET_EN', 'BOOT_IO9', 'EXT_PWR_EN', 'RELAY1_EN', 'RELAY2_EN',
]);

function textBBox(t) {
	if (t.bbox) return t.bbox;
	const content = String(t.content || '');
	const x = Number(t.x || 0);
	const y = Number(t.y || 0);
	const width = Math.max(40, content.length * 6);
	const height = 14;
	return { minX: x, maxX: x + width, minY: y - height, maxY: y + height };
}

// geometry helpers
export function ptInRect(x, y, r) {
	return x > r.minX && x < r.maxX && y > r.minY && y < r.maxY;
}
export function shrinkRect(b, s) {
	return { minX: b.minX + s, maxX: b.maxX - s, minY: b.minY + s, maxY: b.maxY - s };
}
function ccw(ax, ay, bx, by, cx, cy) { return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax); }
export function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
	const d1 = ccw(cx, cy, dx, dy, ax, ay), d2 = ccw(cx, cy, dx, dy, bx, by);
	const d3 = ccw(ax, ay, bx, by, cx, cy), d4 = ccw(ax, ay, bx, by, dx, dy);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function segIntersectsRect(s, r) {
	if (ptInRect(s.x1, s.y1, r) || ptInRect(s.x2, s.y2, r)) return true;
	const E = [
		[r.minX, r.minY, r.maxX, r.minY], [r.maxX, r.minY, r.maxX, r.maxY],
		[r.maxX, r.maxY, r.minX, r.maxY], [r.minX, r.maxY, r.minX, r.minY],
	];
	return E.some(e => segSeg(s.x1, s.y1, s.x2, s.y2, e[0], e[1], e[2], e[3]));
}
export function rectsGap(a, b) {
	const gx = Math.max(b.minX - a.maxX, a.minX - b.maxX);
	const gy = Math.max(b.minY - a.maxY, a.minY - b.maxY);
	return round2(Math.max(gx, gy));
}

function betweenInclusive(v, a, b) {
	return v >= Math.min(a, b) - SNAP - 1e-6 && v <= Math.max(a, b) + SNAP + 1e-6;
}

function pointOnOrthogonalSegment(x, y, s) {
	if (Math.abs(s.x1 - s.x2) < 1e-6) return Math.abs(x - s.x1) < SNAP + 1e-6 && betweenInclusive(y, s.y1, s.y2);
	if (Math.abs(s.y1 - s.y2) < 1e-6) return Math.abs(y - s.y1) < SNAP + 1e-6 && betweenInclusive(x, s.x1, s.x2);
	return false;
}

function splitOrthogonalTouches(segments) {
	const cuts = segments.map(s => new Map([
		[key(s.x1, s.y1), { x: s.x1, y: s.y1 }],
		[key(s.x2, s.y2), { x: s.x2, y: s.y2 }],
	]));
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			const a = segments[i];
			const b = segments[j];
			if (!a.net || !b.net || a.net !== b.net) continue;
			if (a.diagonal || b.diagonal) continue;
			const aHoriz = Math.abs(a.y1 - a.y2) < 1e-6;
			const bHoriz = Math.abs(b.y1 - b.y2) < 1e-6;
			if (aHoriz === bHoriz) continue;
			const h = aHoriz ? a : b;
			const v = aHoriz ? b : a;
			const x = v.x1;
			const y = h.y1;
			if (!pointOnOrthogonalSegment(x, y, h) || !pointOnOrthogonalSegment(x, y, v)) continue;
			const pt = { x, y };
			cuts[i].set(key(x, y), pt);
			cuts[j].set(key(x, y), pt);
		}
	}

	const out = [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		const pts = [...cuts[i].values()];
		if (pts.length <= 2 || s.diagonal) {
			out.push(s);
			continue;
		}
		pts.sort((a, b) => Math.abs(s.x1 - s.x2) < 1e-6 ? a.y - b.y : a.x - b.x);
		for (let j = 0; j + 1 < pts.length; j++) {
			const a = pts[j];
			const b = pts[j + 1];
			if (samePt(a.x, a.y, b.x, b.y)) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			out.push({ ...s, x1: a.x, y1: a.y, x2: b.x, y2: b.y, len: round2(Math.hypot(dx, dy)), splitFrom: s.wireId });
		}
	}
	return out;
}

function bodyBBox(c) {
	const pins = c.pins || [];
	if (!pins.length) return c.bbox;
	const xs = pins.map(p => p.x), ys = pins.map(p => p.y);
	const px = Math.min(...xs), qx = Math.max(...xs), py = Math.min(...ys), qy = Math.max(...ys);
	const body = {
		minX: Math.max(c.bbox.minX, px),
		maxX: Math.min(c.bbox.maxX, qx),
		minY: Math.max(c.bbox.minY, py),
		maxY: Math.min(c.bbox.maxY, qy),
	};
	if (body.maxX <= body.minX || body.maxY <= body.minY) return c.bbox;
	return body;
}

// Union-Find for wire connectivity
class UF {
	constructor() { this.p = new Map(); }
	find(x) { if (!this.p.has(x)) this.p.set(x, x); while (this.p.get(x) !== x) { this.p.set(x, this.p.get(this.p.get(x))); x = this.p.get(x); } return x; }
	union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

// 把快照解析为干净模型
export function buildModel(snap) {
	if (!snap || !Array.isArray(snap.wires) || !Array.isArray(snap.components)) {
		throw new Error('invalid snapshot: missing wires/components');
	}

	const rawWires = (snap.wires || []).map(w => ({ ...w }));
	const wireNetLabels = [];
	for (const w of rawWires) {
		const netAttr = (w.attrs || []).find(a => (a.key === 'NET' || a.key === 'Name') && a.valueVisible !== false);
		if (!netAttr || !w.net) continue;
		if (!Number.isFinite(netAttr.x) || !Number.isFinite(netAttr.y)) continue;
		wireNetLabels.push({
			id: netAttr.id,
			type: 'netlabel',
			source: 'wire-net-attr',
			net: String(netAttr.value || w.net),
			x: netAttr.x,
			y: netAttr.y,
			rotation: netAttr.rotation ?? 0,
			alignMode: netAttr.alignMode ?? null,
			wireId: w.id,
		});
	}
	const rawComps = Array.isArray(snap.components) ? snap.components : [];
	const rawFlags = Array.isArray(snap.netflags) ? snap.netflags : [];
	const textNetLabels = (snap.texts || [])
		.map(t => ({ ...t, content: String(t.content || '').trim() }))
		.filter(t => TEXT_NET_LABELS.has(t.content) && Number.isFinite(t.x) && Number.isFinite(t.y))
		.map(t => ({
			id: t.id,
			type: 'netlabel',
			source: 'text-net-label',
			net: t.content,
			x: t.x,
			y: t.y,
			rotation: t.rotation ?? 0,
			alignMode: t.alignMode ?? null,
			bbox: t.bbox || textBBox(t),
		}));
	const normalizedComponents = [
		...rawComps.map(c => ({ ...c, type: c.type || (c.designator ? 'part' : c.componentType) })),
		...rawFlags.map(f => ({ ...f, type: f.type || 'netflag' })),
		...wireNetLabels,
		...textNetLabels,
	];
	const flagLike = normalizedComponents.filter(c => c.type === 'netflag' || c.type === 'netport' || c.type === 'netlabel');

	// segments（去重）
	const segMap = new Map();
	const rawSegments = [];
	for (const w of rawWires) {
		const l = w.line || [];
		const step = w.id && l.length >= 8 && l.length % 4 === 0 ? 4 : 2;
		for (let i = 0; i + 3 < l.length; i += step) {
			const x1 = l[i], y1 = l[i + 1], x2 = l[i + 2], y2 = l[i + 3];
			if (x1 === x2 && y1 === y2) continue;
			const dx = x2 - x1, dy = y2 - y1;
			rawSegments.push({ x1, y1, x2, y2, net: w.net || '', wireId: w.id, len: round2(Math.hypot(dx, dy)), diagonal: dx !== 0 && dy !== 0 });
			const k = [key(x1, y1), key(x2, y2)].sort().join('|');
			if (segMap.has(k)) continue;
			segMap.set(k, { x1, y1, x2, y2, net: w.net || '', wireId: w.id, len: round2(Math.hypot(dx, dy)), diagonal: dx !== 0 && dy !== 0 });
		}
	}
	const segments = splitOrthogonalTouches([...segMap.values()]);

	const parts = normalizedComponents.filter(c => c.type === 'part' && c.bbox)
		.map(c => {
			const body = bodyBBox(c);
			return { ...c, bodyBBox: body, cx: (body.minX + body.maxX) / 2, cy: (body.minY + body.maxY) / 2 };
		});
	const netflags = normalizedComponents.filter(c => c.type === 'netflag');
	const netports = normalizedComponents.filter(c => c.type === 'netport');
	const netlabels = normalizedComponents.filter(c => c.type === 'netlabel');
	const texts = (snap.texts || []).map(t => ({ ...t, bbox: textBBox(t) }));
	const rectangles = (snap.rectangles || []).map(r => {
		const b = r.bbox || r;
		const box = b && [b.minX, b.minY, b.maxX, b.maxY].every(v => typeof v === 'number' && Number.isFinite(v))
			? { minX: Math.min(b.minX, b.maxX), minY: Math.min(b.minY, b.maxY), maxX: Math.max(b.minX, b.maxX), maxY: Math.max(b.minY, b.maxY) }
			: null;
		return box ? { ...r, bbox: box } : r;
	});

	// pin 索引：pointKey -> [{part, pin}]
	const pinAt = new Map();
	for (const p of parts) {
		for (const pin of p.pins || []) {
			const k = key(pin.x, pin.y);
			if (!pinAt.has(k)) pinAt.set(k, []);
			pinAt.get(k).push({ part: p, pin });
		}
	}

	// 连通分组（按共享端点）
	const uf = new UF();
	for (const s of segments) uf.union(key(s.x1, s.y1), key(s.x2, s.y2));
	const groups = new Map(); // root -> { segs, points:Set, adj:Map }
	const ensure = (root) => { if (!groups.has(root)) groups.set(root, { segs: [], points: new Set(), adj: new Map() }); return groups.get(root); };
	const addAdj = (g, a, b) => { if (!g.adj.has(a)) g.adj.set(a, new Set()); g.adj.get(a).add(b); };
	for (const s of segments) {
		const ka = key(s.x1, s.y1), kb = key(s.x2, s.y2);
		const g = ensure(uf.find(ka));
		g.segs.push(s); g.points.add(ka); g.points.add(kb);
		addAdj(g, ka, kb); addAdj(g, kb, ka);
	}

	for (const g of groups.values()) {
		const nets = new Set(g.segs.map(s => s.net).filter(Boolean));
		for (const f of flagLike) {
			if (!f.net) continue;
			if (g.segs.some(s => pointOnOrthogonalSegment(f.x, f.y, s))) nets.add(f.net);
		}
		const explicit = [...nets];
		const power = explicit.filter(n => POWER_NETS.has(n));
		const inferred = explicit.length === 1 ? explicit[0] : (power.length === 1 && explicit.every(n => n === power[0]) ? power[0] : null);
		if (inferred) for (const s of g.segs) if (!s.net) s.net = inferred;
	}

	// 给每个分组标注它连接到的引脚
	for (const g of groups.values()) {
		g.pins = [];
		for (const pk of g.points) {
			const hit = pinAt.get(pk);
			if (hit) for (const h of hit) g.pins.push({ designator: h.part.designator, pinName: h.pin.name, x: h.pin.x, y: h.pin.y });
		}
		g.totalLen = round2(g.segs.reduce((a, s) => a + s.len, 0));
	}

	return {
		project: snap.project, sheetBBox: snap.sheetBBox, rawWires,
		rawSegments, segments, parts, netflags, netports, netlabels, texts, rectangles,
		pinAt, groups: [...groups.values()],
	};
}
