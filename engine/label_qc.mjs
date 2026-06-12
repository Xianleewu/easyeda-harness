import { flagBBox } from './buildmodel.mjs';
import { wireLabelQC } from './wire_label_qc.mjs';

const TOL = 2;
const CLR = 12;

function segs(model) {
	const out = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const a = [l[i], l[i + 1]];
			const b = [l[i + 2], l[i + 3]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			out.push({ a, b, net: w.net || '' });
		}
	}
	return out;
}

function ov(a, b) {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function sigBBox(f) {
	const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
	const len = Math.max(40, String(f.net || '').length * 6 + 18);
	const h = 8;
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

function segThruRect(s, r) {
	const ri = { minX: r.minX + 1, minY: r.minY + 1, maxX: r.maxX - 1, maxY: r.maxY - 1 };
	if (ri.maxX <= ri.minX || ri.maxY <= ri.minY) return false;
	const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
	const inA = ax > ri.minX && ax < ri.maxX && ay > ri.minY && ay < ri.maxY;
	const inB = bx > ri.minX && bx < ri.maxX && by > ri.minY && by < ri.maxY;
	if (ax === bx) {
		const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
		if (ax > ri.minX && ax < ri.maxX && y0 < ri.maxY && y1 > ri.minY) return !(inA || inB);
	}
	if (ay === by) {
		const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
		if (ay > ri.minY && ay < ri.maxY && x0 < ri.maxX && x1 > ri.minX) return !(inA || inB);
	}
	return false;
}

function segCutsRectInterior(s, r, pad = 0.5) {
	const ri = { minX: r.minX + pad, minY: r.minY + pad, maxX: r.maxX - pad, maxY: r.maxY - pad };
	if (ri.maxX <= ri.minX || ri.maxY <= ri.minY) return false;
	const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
	if (ax === bx) {
		const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
		return ax > ri.minX && ax < ri.maxX && y0 < ri.maxY && y1 > ri.minY;
	}
	if (ay === by) {
		const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
		return ay > ri.minY && ay < ri.maxY && x0 < ri.maxX && x1 > ri.minX;
	}
	return false;
}

function labelOwnEndpointContact(f, s) {
	if (!f?.net || s.net !== f.net) return false;
	const x = f.textX ?? f.x;
	const y = f.textY ?? f.y;
	return (Math.abs(s.a[0] - x) <= 1 && Math.abs(s.a[1] - y) <= 1) ||
		(Math.abs(s.b[0] - x) <= 1 && Math.abs(s.b[1] - y) <= 1);
}

function labelBox(f) {
	return f.kind === 'sig' ? sigBBox(f) : (f.bbox || flagBBox({ ...f, rotation: f.rotation ?? f.rot ?? 0 }));
}

export function labelQC(model, opts = {}) {
	const findings = [];
	const flags = model.netflags || [];
	const comps = (model.components || []).filter(c => c.bbox);
	const S = segs(model);

	const groups = { left: [], right: [] };
	for (const f of flags) {
		if (f.kind !== 'sig') continue;
		const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
		if (rot === 180) groups.left.push(f);
		else if (rot === 0) groups.right.push(f);
	}
	const bucketCol = (arr, axis) => {
		const m = new Map();
		for (const f of arr) {
			const k = Math.round((axis === 'x' ? (f.textX ?? f.x) : (f.textY ?? f.y)) / 10) * 10;
			if (!m.has(k)) m.set(k, []);
			m.get(k).push(f);
		}
		return [...m.values()].filter(c => c.length >= 2);
	};
	for (const col of bucketCol(groups.left, 'x')) {
		const xs = col.map(f => f.textX ?? f.x);
		const spread = Math.max(...xs) - Math.min(...xs);
		if (spread > TOL) findings.push({ rule: 'L1-align-left-col', severity: 'hard', category: 'label',
			msg: `left-facing net label column x spread=${spread}: ${col.map(f => f.net).join(', ')}`, where: col.map(f => f.net) });
	}
	for (const col of bucketCol(groups.right, 'x')) {
		const xs = col.map(f => f.textX ?? f.x);
		const spread = Math.max(...xs) - Math.min(...xs);
		if (spread > TOL) findings.push({ rule: 'L1-align-right-col', severity: 'hard', category: 'label',
			msg: `right-facing net label column x spread=${spread}: ${col.map(f => f.net).join(', ')}`, where: col.map(f => f.net) });
	}

	for (const f of flags) {
		const bb = labelBox(f);
		for (const c of comps) {
			if (ov(bb, c.bbox)) findings.push({ rule: 'L2-label-over-comp', severity: 'hard', category: 'overlap',
				msg: `label [${f.net}] overlaps ${c.designator}`, where: { net: f.net, comp: c.designator } });
		}
	}

	for (let i = 0; i < flags.length; i++) {
		for (let j = i + 1; j < flags.length; j++) {
			const a = flags[i], b = flags[j];
			if (ov(labelBox(a), labelBox(b))) findings.push({ rule: 'L3-label-over-label', severity: 'hard', category: 'overlap',
				msg: `label [${a.net}] overlaps [${b.net}]`, where: [a.net, b.net] });
		}
	}

	for (const s of S) {
		if (!s.net) continue;
		for (const c of comps) {
			if (!c.bbox || !segThruRect(s, c.bbox)) continue;
			findings.push({ rule: 'L5-net-wire-thru-comp', severity: 'hard', category: 'overlap',
				msg: `named wire [${s.net}] passes through ${c.designator}`, where: { net: s.net, comp: c.designator, seg: [...s.a, ...s.b] } });
		}
	}

	for (const f of flags.filter(x => x.kind === 'sig')) {
		const bb = sigBBox(f);
		for (const c of comps) {
			if (!c.bbox) continue;
			const ko = { minX: c.bbox.minX - CLR, minY: c.bbox.minY - CLR, maxX: c.bbox.maxX + CLR, maxY: c.bbox.maxY + CLR };
			if (ov(bb, ko)) findings.push({ rule: 'L6-label-in-keepout', severity: 'hard', category: 'overlap',
				msg: `net label [${f.net}] enters ${c.designator} keepout`, where: { net: f.net, comp: c.designator } });
		}
	}

	for (const f of flags) {
		const bb = labelBox(f);
		for (const s of S) {
			if (!segCutsRectInterior(s, bb)) continue;
			if (labelOwnEndpointContact(f, s)) continue;
			findings.push({ rule: 'L4-wire-thru-label', severity: 'hard', category: 'overlap',
				msg: `wire net=${s.net} passes through label [${f.net}]`, where: { net: f.net, seg: [...s.a, ...s.b] } });
		}
	}

	if (!opts.skipWireLabel) findings.push(...wireLabelQC(model));
	return findings;
}
