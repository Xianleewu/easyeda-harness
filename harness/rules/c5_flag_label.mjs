import { flagBBox } from '../../engine/buildmodel.mjs';
import { CONFIG } from '../config.mjs';
import { rectsGap } from '../model.mjs';

const EPS = 1;

function snapModel(m) {
	const comps = (m.components || m.parts || []).map(c => ({
		designator: c.designator,
		value: c.value,
		name: c.name,
		bbox: c.bbox,
		bodyBBox: c.bodyBBox,
		pins: c.pins || [],
	}));
	const flagSource = [
		...(m.netflags || []),
		...(m.netports || []),
		...(m.netlabels || []),
	];
	const netflags = flagSource.map(f => ({
		...f,
		kind: f.kind || (f.type === 'netport' || f.type === 'netlabel' ? 'sig' : (f.net === 'GND' ? 'gnd' : 'power')),
		rotation: f.rotation ?? f.rot ?? 0,
		bbox: f.bbox || flagBBox({
			...f,
			rotation: f.rotation ?? f.rot ?? 0,
			kind: f.kind || (f.type === 'netport' || f.type === 'netlabel' ? 'sig' : 'gnd'),
		}),
	}));
	return { components: comps, segments: m.segments || [], wires: m.rawWires || m.wires || [], netflags };
}

function segs(m) {
	if (Array.isArray(m.segments) && m.segments.length) {
		return m.segments.map(s => ({ a: [s.x1, s.y1], b: [s.x2, s.y2], net: s.net || '' }));
	}
	const out = [];
	const wires = m.wires || [];
	for (const w of wires) {
		const l = w.line || [];
		const step = w.id && l.length >= 8 && l.length % 4 === 0 ? 4 : 2;
		for (let i = 0; i + 3 < l.length; i += step) {
			const a = [l[i], l[i + 1]];
			const b = [l[i + 2], l[i + 3]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			out.push({ a, b, net: w.net || '' });
		}
	}
	return out;
}

function expectRot(kind, dx, dy) {
	if (Math.abs(dx) >= Math.abs(dy)) {
		if (dx > EPS) return kind === 'gnd' ? 270 : 180;
		if (dx < -EPS) return kind === 'gnd' ? 90 : 0;
	}
	if (dy > EPS) return kind === 'gnd' ? 0 : 180;
	if (dy < -EPS) return kind === 'gnd' ? 180 : 0;
	return null;
}

function wireAtFlag(S, fx, fy) {
	for (const s of S) {
		if (Math.abs(s.a[0] - fx) < EPS && Math.abs(s.a[1] - fy) < EPS) return { from: s.b, to: s.a };
		if (Math.abs(s.b[0] - fx) < EPS && Math.abs(s.b[1] - fy) < EPS) return { from: s.a, to: s.b };
	}
	return null;
}

function sigBBox(f) {
	if (f.source === 'text-net-label' && f.bbox) return f.bbox;
	const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
	const len = labelWidth(f.net);
	const h = 7;
	const x = f.textX ?? f.x;
	const y = f.textY ?? f.y;
	if (f.alignMode === 1) return { minX: x, maxX: x + len, minY: y - h, maxY: y };
	if (f.alignMode === 3) return { minX: x - len, maxX: x, minY: y - h, maxY: y };
	if (f.alignMode === 6 || f.alignMode === 7 || f.alignMode == null) return { minX: x, maxX: x + len, minY: y, maxY: y + h };
	if (f.alignMode === 8 || f.alignMode === 9) return { minX: x - len, maxX: x, minY: y, maxY: y + h };
	if (rot === 180) return { minX: x - len, maxX: x - 6, minY: y - h, maxY: y + h };
	if (rot === 0) return { minX: x + 6, maxX: x + len, minY: y - h, maxY: y + h };
	if (rot === 90) return { minX: x - h, maxX: x + h, minY: y + 6, maxY: y + len };
	return { minX: x - h, maxX: x + h, minY: y - len, maxY: y - 6 };
}

function labelWidth(net) {
	const cfg = CONFIG.label || {};
	return Math.max(cfg.minTextWidth ?? 38, String(net || '').length * (cfg.textWidthPerChar ?? 6) + (cfg.textWidthPadding ?? 16));
}

function ov(a, b) {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function segCutsRectInterior(s, r, pad = 0.5) {
	const ri = { minX: r.minX + pad, minY: r.minY + pad, maxX: r.maxX - pad, maxY: r.maxY - pad };
	if (ri.maxX <= ri.minX || ri.maxY <= ri.minY) return false;
	const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
	if (Math.abs(ax - bx) < EPS) {
		const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
		return ax > ri.minX && ax < ri.maxX && y0 < ri.maxY && y1 > ri.minY;
	}
	if (Math.abs(ay - by) < EPS) {
		const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
		return ay > ri.minY && ay < ri.maxY && x0 < ri.maxX && x1 > ri.minX;
	}
	return false;
}

function labelOwnEndpointContact(f, s) {
	if (!f?.net || s.net !== f.net) return false;
	const x = f.textX ?? f.x;
	const y = f.textY ?? f.y;
	return (Math.abs(s.a[0] - x) < EPS && Math.abs(s.a[1] - y) < EPS) ||
		(Math.abs(s.b[0] - x) < EPS && Math.abs(s.b[1] - y) < EPS);
}

function xColumns(flags, tol = 12) {
	const visualX = f => f.textX ?? f.x;
	const sorted = [...flags].sort((a, b) => visualX(a) - visualX(b));
	const cols = [];
	for (const f of sorted) {
		const x = visualX(f);
		const col = cols.find(c => Math.abs(c.x - x) <= tol);
		if (col) {
			col.items.push(f);
			col.x = col.items.reduce((a, i) => a + visualX(i), 0) / col.items.length;
		} else {
			cols.push({ x, items: [f] });
		}
	}
	return cols.map(c => c.items).filter(c => c.length >= 2);
}

function segKey(s) {
	const a = `${s.a[0]},${s.a[1]}`;
	const b = `${s.b[0]},${s.b[1]}`;
	return [a, b].sort().join('|');
}

function segLen(s) {
	return Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]);
}

function pointOnSeg(f, s) {
	const horiz = Math.abs(s.a[1] - s.b[1]) < EPS;
	const vert = Math.abs(s.a[0] - s.b[0]) < EPS;
	if (horiz && Math.abs(f.y - s.a[1]) < EPS) return f.x >= Math.min(s.a[0], s.b[0]) - EPS && f.x <= Math.max(s.a[0], s.b[0]) + EPS;
	if (vert && Math.abs(f.x - s.a[0]) < EPS) return f.y >= Math.min(s.a[1], s.b[1]) - EPS && f.y <= Math.max(s.a[1], s.b[1]) + EPS;
	return false;
}

function flagSegmentKey(f, segments) {
	const hits = segments.filter(s => s.net === f.net && pointOnSeg(f, s));
	if (!hits.length) return null;
	const best = hits.reduce((a, b) => segLen(b) < segLen(a) ? b : a, hits[0]);
	return segKey(best);
}

function isIcLike(c) {
	if (!c?.designator) return false;
	return /^U\d+/i.test(c.designator) && (c.pins || []).length >= 8;
}

function isConnectorLike(c) {
	if (!c?.designator) return false;
	if (/^J\d+|^CN\d+/i.test(c.designator)) return true;
	return /(USB|TYPE.?C|CONNECTOR|HEADER|CONN)/i.test(`${c.value || ''} ${c.name || ''}`);
}

function anchorGapToRect(f, r) {
	const dx = f.x < r.minX ? r.minX - f.x : f.x > r.maxX ? f.x - r.maxX : 0;
	const dy = f.y < r.minY ? r.minY - f.y : f.y > r.maxY ? f.y - r.maxY : 0;
	return Math.hypot(dx, dy);
}

export function c5FlagLabel(raw) {
	const m = snapModel(raw);
	const F = [];
	const S = segs(m);
	const flags = m.netflags || [];

	for (const f of flags) {
		if (f.kind !== 'gnd' && f.kind !== 'power') continue;
		const kind = f.net === 'GND' || (f.symbol || '').includes('ground') ? 'gnd' : 'power';
		const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
		const hit = wireAtFlag(S, f.x, f.y);
		if (!hit) continue;
		const dx = hit.from[0] - hit.to[0];
		const dy = hit.from[1] - hit.to[1];
		const want = expectRot(kind, dx, dy);
		if (want !== null && want !== rot) F.push({ rule: 'C5.1-flag-rot', severity: 'hard', category: 'orientation',
			msg: `${f.net} @(${f.x},${f.y}) rot=${rot} expected ${want}`, where: { net: f.net, x: f.x, y: f.y, rot, want } });
	}

	for (const f of flags.filter(x => x.kind === 'sig')) {
		const bb = sigBBox(f);
		for (const c of m.components) {
			if (c.bbox && ov(bb, c.bbox)) F.push({ rule: 'C5.2-net-over-comp', severity: 'hard', category: 'overlap',
				msg: `Net label [${f.net}] overlaps ${c.designator}`, where: { net: f.net, comp: c.designator } });
		}
	}

	const connectors = m.components.filter(isConnectorLike);
	const connectorLabelClearance = CONFIG.label?.connectorClearance ?? 10;
	for (const f of flags.filter(x => x.kind === 'sig')) {
		const bb = sigBBox(f);
		for (const c of connectors) {
			const cb = c.bodyBBox || c.bbox;
			if (!cb) continue;
			const textGap = rectsGap(bb, cb);
			if (textGap < connectorLabelClearance) {
				F.push({ rule: 'C5.7-label-connector-clearance', severity: 'hard', category: 'label',
					msg: `Signal label [${f.net}] is too close to connector ${c.designator}: gap ${Math.round(textGap)} < ${connectorLabelClearance}`,
					where: { net: f.net, comp: c.designator, x: f.x, y: f.y, gap: textGap, min: connectorLabelClearance } });
			}
		}
	}

	for (const f of flags.filter(x => x.kind === 'sig')) {
		const bb = sigBBox(f);
		for (const s of S) {
			if (!segCutsRectInterior(s, bb)) continue;
			if (labelOwnEndpointContact(f, s)) continue;
			F.push({ rule: 'C5.8-wire-through-visible-net-label', severity: 'hard', category: 'label',
				msg: `Wire segment passes through visible net label [${f.net}]`,
				where: { net: f.net, label: { x: f.x, y: f.y, alignMode: f.alignMode ?? null }, bbox: bb, seg: [...s.a, ...s.b] } });
		}
	}

	const minFlagGap = CONFIG.label?.minFlagGap ?? 8;
	const minSignalLabelGap = CONFIG.label?.minSignalLabelGap ?? 1;
	for (let i = 0; i < flags.length; i++) {
		for (let j = i + 1; j < flags.length; j++) {
			const a = flags[i];
			const b = flags[j];
			if (!a.bbox || !b.bbox) continue;
			const gap = rectsGap(a.bbox, b.bbox);
			const minGap = a.kind === 'sig' && b.kind === 'sig' ? minSignalLabelGap : minFlagGap;
			if (gap >= minGap) continue;
			F.push({ rule: 'C5.6-netflag-clearance', severity: 'hard', category: 'label',
				msg: `Netflag labels too close: [${a.net}] to [${b.net}] gap ${Math.round(gap)} < ${minGap}`,
				where: {
					a: { net: a.net, kind: a.kind, x: a.x, y: a.y },
					b: { net: b.net, kind: b.kind, x: b.x, y: b.y },
					gap,
					min: minGap,
				} });
		}
	}

	const sigs = flags.filter(x => x.kind === 'sig');
	const bySegment = new Map();
	for (const f of sigs) {
		const key = flagSegmentKey(f, S);
		if (!key) continue;
		const bucket = `${f.net}|${key}`;
		if (!bySegment.has(bucket)) bySegment.set(bucket, []);
		bySegment.get(bucket).push(f);
	}
	for (const arr of bySegment.values()) {
		if (arr.length < 2) continue;
		F.push({ rule: 'C5.4-dup-label-on-segment', severity: 'hard', category: 'label',
			msg: `Signal net [${arr[0].net}] has ${arr.length} labels on the same wire segment`,
			where: arr.map(f => ({ net: f.net, x: f.x, y: f.y })) });
	}

	const ics = m.components.filter(isIcLike);
	for (const f of sigs) {
		const want = labelWidth(f.net);
		for (const c of ics) {
			if (!c.bbox) continue;
			const textGap = rectsGap(sigBBox(f), c.bbox);
			if (textGap < 0) continue;
			const anchorGap = anchorGapToRect(f, c.bbox);
			if (anchorGap + (CONFIG.label?.icClearanceSlack ?? 2) < want) {
				F.push({ rule: 'C5.5-label-ic-clearance', severity: 'hard', category: 'label',
					msg: `Signal label [${f.net}] is too close to ${c.designator}: anchor gap ${Math.round(anchorGap)} < ${Math.round(want)}`,
					where: { net: f.net, comp: c.designator, x: f.x, y: f.y, anchorGap, min: want } });
			}
		}
	}

	const left = flags.filter(f => f.kind === 'sig' && ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360 === 180);
	for (const col of xColumns(left)) {
		const xs = col.map(f => f.textX ?? f.x);
		const spread = Math.max(...xs) - Math.min(...xs);
		if (spread > 2) F.push({ rule: 'C5.3-align-left', severity: 'hard', category: 'label',
			msg: `Left-facing label column x spread=${spread}: ${col.map(f => f.net).join(', ')}`,
			where: col.map(f => f.net) });
	}

	return F;
}
