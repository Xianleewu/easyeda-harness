// 閫氱敤锛氭妸 cell 缁撴灉(place/wires/flags) + 鍣ㄤ欢鏈湴鍑犱綍 -> 鏀剧疆鍚庢ā鍨?world 寮曡剼 + bbox)
import { withLocalPins, toWorld } from './transform.mjs';

export function placeComps(byDes, place, noConnects = []) {
	const nc = new Set(noConnects.map(x => `${x.ref || x.designator}.${x.pin || x.num}`));
	const comps = [];
	for (const [des, pl] of Object.entries(place)) {
		const c = byDes.get(des);
		if (!c) { console.error('missing comp', des); continue; }
		const pins = c.pins.map(p => {
			const [x, y] = toWorld(p.local, [pl.x, pl.y], pl.rot, pl.mirror);
			return { ...p, x, y, noConnected: nc.has(`${des}.${p.num}`) };
		});
		const lb = c.localBox;
		const corners = [[lb.minX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY], [lb.maxX, lb.minY]].map(([lx, ly]) => toWorld([lx, ly], [pl.x, pl.y], pl.rot, pl.mirror));
		const bbox = { minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])), minY: Math.min(...corners.map(p => p[1])), maxY: Math.max(...corners.map(p => p[1])) };
		comps.push({ id: c.id, designator: des, value: c.value, x: pl.x, y: pl.y, rotation: pl.rot, mirror: pl.mirror, pins, bbox });
	}
	return comps;
}

export function flagBBox(f) {
	const ext = 38, w = 4, gw = 9;
	const rot = (((f.rotation ?? f.rot ?? 0) % 360) + 360) % 360;
	if (f.kind === 'gnd') { // 鏈濆悜鍐冲畾韬綋鏂瑰悜锛岀害 20 闀?11 瀹?		if (rot === 0) return { minX: f.x - gw, maxX: f.x + gw, minY: f.y - 20, maxY: f.y };
		if (rot === 180) return { minX: f.x - gw, maxX: f.x + gw, minY: f.y, maxY: f.y + 20 };
		if (rot === 90) return { minX: f.x, maxX: f.x + 20, minY: f.y - gw, maxY: f.y + gw };
		return { minX: f.x - 20, maxX: f.x, minY: f.y - gw, maxY: f.y + gw };
	}
	if (f.kind === 'power') { // 鐢垫簮绗﹀彿锛歳ot0 鏈濅笂 / rot180 鏈濅笅锛岀珫鍚戝皬鐩?		if (rot === 180) return { minX: f.x - gw, maxX: f.x + gw, minY: f.y - 22, maxY: f.y };
		return { minX: f.x - gw, maxX: f.x + gw, minY: f.y, maxY: f.y + 22 };
	}
	// 淇″彿鏍囩 tag锛氭部 rot 鏂瑰悜浼稿嚭 ~ext
	const fx = f.textX ?? f.x;
	const fy = f.textY ?? f.y;
	const textW = Math.max(38, String(f.net || '').length * 6 + 16);
	const textH = 8;
	if (f.alignMode === 1) return { minX: fx, maxX: fx + textW, minY: fy - textH, maxY: fy };
	if (f.alignMode === 3) return { minX: fx - textW, maxX: fx, minY: fy - textH, maxY: fy };
	if (f.alignMode === 6 || f.alignMode === 7 || f.alignMode == null) return { minX: fx, maxX: fx + textW, minY: fy, maxY: fy + textH };
	if (f.alignMode === 8 || f.alignMode === 9) return { minX: fx - textW, maxX: fx, minY: fy, maxY: fy + textH };
	if (rot === 0) return { minX: fx + 8, maxX: fx + 8 + textW, minY: fy - w, maxY: fy + w };
	if (rot === 180) return { minX: fx - 8 - textW, maxX: fx - 8, minY: fy - w, maxY: fy + w };
	if (rot === 90) return { minX: fx - w, maxX: fx + w, minY: fy + 8, maxY: fy + ext };
	return { minX: fx - w, maxX: fx + w, minY: fy - ext, maxY: fy - 8 };
}

function between(v, a, b) {
	return v >= Math.min(a, b) - 1e-6 && v <= Math.max(a, b) + 1e-6;
}

function pointOnSegment(x, y, line) {
	const [x1, y1, x2, y2] = line;
	if (Math.abs(x1 - x2) < 1e-6) return Math.abs(x - x1) < 1e-6 && between(y, y1, y2);
	if (Math.abs(y1 - y2) < 1e-6) return Math.abs(y - y1) < 1e-6 && between(x, x1, x2);
	return false;
}

function splitWireTaps(wires) {
	const segments = [];
	for (let wi = 0; wi < wires.length; wi++) {
		const w = wires[wi];
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			if (l[i] === l[i + 2] && l[i + 1] === l[i + 3]) continue;
			segments.push({ wireIndex: wi, net: w.net || '', line: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
		}
	}
	const cuts = segments.map(s => new Map([
		[`${s.line[0]},${s.line[1]}`, [s.line[0], s.line[1]]],
		[`${s.line[2]},${s.line[3]}`, [s.line[2], s.line[3]]],
	]));
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			const a = segments[i], b = segments[j];
			if (a.net && b.net && a.net !== b.net) continue;
			const ah = Math.abs(a.line[1] - a.line[3]) < 1e-6;
			const bh = Math.abs(b.line[1] - b.line[3]) < 1e-6;
			const av = Math.abs(a.line[0] - a.line[2]) < 1e-6;
			const bv = Math.abs(b.line[0] - b.line[2]) < 1e-6;
			if (ah && bh && Math.abs(a.line[1] - b.line[1]) < 1e-6) {
				for (const x of [a.line[0], a.line[2], b.line[0], b.line[2]]) {
					if (pointOnSegment(x, a.line[1], a.line)) cuts[i].set(`${x},${a.line[1]}`, [x, a.line[1]]);
					if (pointOnSegment(x, b.line[1], b.line)) cuts[j].set(`${x},${b.line[1]}`, [x, b.line[1]]);
				}
				continue;
			}
			if (av && bv && Math.abs(a.line[0] - b.line[0]) < 1e-6) {
				for (const y of [a.line[1], a.line[3], b.line[1], b.line[3]]) {
					if (pointOnSegment(a.line[0], y, a.line)) cuts[i].set(`${a.line[0]},${y}`, [a.line[0], y]);
					if (pointOnSegment(b.line[0], y, b.line)) cuts[j].set(`${b.line[0]},${y}`, [b.line[0], y]);
				}
				continue;
			}
			if (ah === bh) continue;
			const h = ah ? a : b;
			const v = ah ? b : a;
			const x = v.line[0];
			const y = h.line[1];
			if (!pointOnSegment(x, y, h.line) || !pointOnSegment(x, y, v.line)) continue;
			cuts[i].set(`${x},${y}`, [x, y]);
			cuts[j].set(`${x},${y}`, [x, y]);
		}
	}
	const out = [];
	const seen = new Set();
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		const pts = [...cuts[i].values()];
		const horizontal = Math.abs(s.line[1] - s.line[3]) < 1e-6;
		pts.sort((a, b) => horizontal ? a[0] - b[0] : a[1] - b[1]);
		for (let j = 0; j + 1 < pts.length; j++) {
			const a = pts[j], b = pts[j + 1];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			const p1 = `${a[0]},${a[1]}`;
			const p2 = `${b[0]},${b[1]}`;
			const key = `${s.net}|${[p1, p2].sort().join('|')}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ ...wires[s.wireIndex], line: [a[0], a[1], b[0], b[1]] });
		}
	}
	return out;
}

export function buildModel(byDes, cell) {
	const comps = placeComps(byDes, cell.place, cell.noConnects || []);
	const netflags = (cell.flags || []).map(f => {
		const rotation = f.rotation ?? f.rot ?? 0;
		const g = { ...f, rotation };
		return { ...g, bbox: flagBBox(g) };
	});
	const wires = [];
	for (const w of cell.wires || []) {
		const line = w.line || [];
		const clean = [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			const x = line[i], y = line[i + 1];
			if (clean.length >= 2 && clean[clean.length - 2] === x && clean[clean.length - 1] === y) continue;
			clean.push(x, y);
		}
		if (clean.length >= 4) wires.push({ ...w, line: clean });
	}
	return { components: comps, wires: splitWireTaps(wires), netflags, noConnects: cell.noConnects || [] };
}

