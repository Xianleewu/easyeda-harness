import { CONFIG } from '../config.mjs';

function part(parts, ref) {
	return parts.get(ref) || null;
}

function pin(p, numOrName) {
	return (p?.pins || []).find(x => String(x.num) === String(numOrName) || String(x.name) === String(numOrName)) || null;
}

function center(p) {
	const b = p?.bodyBBox || p?.bbox;
	return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

function fail(F, rule, msg, where) {
	F.push({ rule, severity: 'hard', category: 'layout', msg, where });
}

function wireSegments(m, net) {
	const out = [];
	for (const s of m.segments || []) {
		if (net && s.net !== net) continue;
		out.push({ net: s.net || '', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
	}
	if (out.length) return out;
	for (const w of m.wires || []) {
		if (net && w.net !== net) continue;
		const line = w.line || [];
		for (let i = 0; i + 3 < line.length; i += 2) {
			const [x1, y1, x2, y2] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
			if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
			if (x1 === x2 && y1 === y2) continue;
			out.push({ net: w.net || '', x1, y1, x2, y2 });
		}
	}
	return out;
}

function segmentConnects(a, b, seg, eps = 0.6) {
	const ax = a?.x, ay = a?.y, bx = b?.x, by = b?.y;
	if (![ax, ay, bx, by].every(Number.isFinite)) return false;
	const sameForward = Math.abs(seg.x1 - ax) <= eps && Math.abs(seg.y1 - ay) <= eps && Math.abs(seg.x2 - bx) <= eps && Math.abs(seg.y2 - by) <= eps;
	const sameReverse = Math.abs(seg.x1 - bx) <= eps && Math.abs(seg.y1 - by) <= eps && Math.abs(seg.x2 - ax) <= eps && Math.abs(seg.y2 - ay) <= eps;
	return sameForward || sameReverse;
}

export function c15PmosSupport(m) {
	const F = [];
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	const q1 = part(parts, 'Q1');
	const q2 = part(parts, 'Q2');
	const r1 = part(parts, 'R1');
	const r2 = part(parts, 'R2');
	const r3 = part(parts, 'R3');
	const r4 = part(parts, 'R4');
	const d1 = part(parts, 'D1');
	if (!q1 || !q2 || !r1 || !r2 || !r3 || !r4 || !d1) return F;

	const cfg = CONFIG.pmosSupport || {};
	const q1c = center(q1);
	const q2c = center(q2);
	const r1c = center(r1);
	const r2c = center(r2);
	const r3c = center(r3);
	const r4c = center(r4);
	const d1c = center(d1);
	if (!q1c || !q2c || !r1c || !r2c || !r3c || !r4c || !d1c) return F;

	const q1Gate = pin(q1, '4') || pin(q1, 'G');
	const q2Gate = pin(q2, '1') || pin(q2, 'G');
	const q2Drain = pin(q2, '3') || pin(q2, 'D');
	const r2Pull = pin(r2, '1');
	const r3Out = pin(r3, '2');
	const r4Gate = pin(r4, '1');

	const clampRowDelta = Math.abs(r1c.y - d1c.y);
	const clampColumnGap = Math.abs(r1c.x - d1c.x);
	if (clampRowDelta > (cfg.maxClampRowDelta ?? 8) ||
		clampColumnGap < (cfg.minClampColumnGap ?? 20) ||
		clampColumnGap > (cfg.maxClampColumnGap ?? 55)) {
		fail(F, 'C15.1-pmos-clamp-pair', 'R1 pull-up and D1 clamp must be a tight row-aligned gate/source pair', {
			refs: ['R1', 'D1'],
			rowDelta: clampRowDelta,
			columnGap: clampColumnGap,
			maxRowDelta: cfg.maxClampRowDelta ?? 8,
			minColumnGap: cfg.minClampColumnGap ?? 20,
			maxColumnGap: cfg.maxClampColumnGap ?? 55,
		});
	}

	const supportColumnSkew = Math.abs(r1c.x - r2c.x);
	const supportVerticalSpan = Math.abs(r1c.y - r2c.y);
	const supportToQ1XGap = q1Gate ? Math.abs(q1Gate.x - r1c.x) : Math.abs(q1c.x - r1c.x);
	if (supportColumnSkew > (cfg.maxGateSupportColumnSkew ?? 12) ||
		supportVerticalSpan < (cfg.minGateSupportVerticalSpan ?? 90) ||
		supportVerticalSpan > (cfg.maxGateSupportVerticalSpan ?? 190) ||
		supportToQ1XGap > (cfg.maxGateSupportToQ1XGap ?? 90)) {
		fail(F, 'C15.2-pmos-gate-support-column', 'R1/R2 must form a compact local gate-support column beside Q1.G', {
			refs: ['Q1', 'R1', 'R2'],
			supportColumnSkew,
			supportVerticalSpan,
			supportToQ1XGap,
			maxColumnSkew: cfg.maxGateSupportColumnSkew ?? 12,
			minVerticalSpan: cfg.minGateSupportVerticalSpan ?? 90,
			maxVerticalSpan: cfg.maxGateSupportVerticalSpan ?? 190,
			maxQ1Gap: cfg.maxGateSupportToQ1XGap ?? 90,
		});
	}

	const driverBelowQ1 = q1c.y - q2c.y;
	const driverColumnSkew = Math.abs(r2c.x - q2c.x);
	if (driverBelowQ1 < (cfg.minDriverBelowQ1 ?? 95) ||
		driverBelowQ1 > (cfg.maxDriverBelowQ1 ?? 200) ||
		driverColumnSkew > (cfg.maxDriverColumnSkew ?? 35)) {
		fail(F, 'C15.3-pmos-driver-position', 'Q2 driver must sit below the Q1 gate-support column, not as a detached island', {
			refs: ['Q1', 'R2', 'Q2'],
			driverBelowQ1,
			driverColumnSkew,
			minBelow: cfg.minDriverBelowQ1 ?? 95,
			maxBelow: cfg.maxDriverBelowQ1 ?? 200,
			maxColumnSkew: cfg.maxDriverColumnSkew ?? 35,
		});
	}

	if (q2Drain && r2Pull) {
		const xSkew = Math.abs(q2Drain.x - r2Pull.x);
		const yGap = Math.abs(q2Drain.y - r2Pull.y);
		const directSegment = wireSegments(m, 'PGATE_PULL').some(seg => segmentConnects(q2Drain, r2Pull, seg, cfg.directWireEps ?? 0.6));
		if (xSkew > (cfg.maxR2Q2DirectXSkew ?? 1) || yGap > (cfg.maxR2Q2DirectYGap ?? 40) || !directSegment) {
			fail(F, 'C15.6-pmos-r2-q2-direct-wire', 'R2.1 to Q2.D is a local adjacent connection and must be a single straight vertical wire', {
				refs: ['R2', 'Q2'],
				r2Pull: { x: r2Pull.x, y: r2Pull.y },
				q2Drain: { x: q2Drain.x, y: q2Drain.y },
				xSkew,
				yGap,
				directSegment,
				maxXSkew: cfg.maxR2Q2DirectXSkew ?? 1,
				maxYGap: cfg.maxR2Q2DirectYGap ?? 40,
			});
		}
	}

	if (q2Gate && r3Out) {
		const r3ToQ2GateGap = Math.abs(q2Gate.x - r3Out.x) + Math.abs(q2Gate.y - r3Out.y);
		if (r3c.x >= q2Gate.x || r3ToQ2GateGap > (cfg.maxR3ToQ2GateGap ?? 75)) {
			fail(F, 'C15.4-pmos-driver-input-resistor', 'R3 must sit on the MCU-control input side and close to Q2.G', {
				refs: ['R3', 'Q2'],
				r3Center: r3c,
				q2Gate: { x: q2Gate.x, y: q2Gate.y },
				r3Out: { x: r3Out.x, y: r3Out.y },
				r3ToQ2GateGap,
				maxGap: cfg.maxR3ToQ2GateGap ?? 75,
			});
		}
	}

	if (q2Gate && r4Gate) {
		const r4GateRowDelta = Math.abs(r4Gate.y - q2Gate.y);
		const r4ToQ2GateXGap = Math.abs(r4Gate.x - q2Gate.x);
		if (r4c.y >= q2c.y || r4GateRowDelta > (cfg.maxR4GateRowDelta ?? 35) ||
			r4ToQ2GateXGap > (cfg.maxR4ToQ2GateXGap ?? 45)) {
			fail(F, 'C15.5-pmos-driver-pulldown', 'R4 pulldown must stay locally tied to Q2.G with its ground side below/away', {
				refs: ['R4', 'Q2'],
				r4Center: r4c,
				q2Center: q2c,
				q2Gate: { x: q2Gate.x, y: q2Gate.y },
				r4Gate: { x: r4Gate.x, y: r4Gate.y },
				r4GateRowDelta,
				r4ToQ2GateXGap,
				maxRowDelta: cfg.maxR4GateRowDelta ?? 35,
				maxXGap: cfg.maxR4ToQ2GateXGap ?? 45,
			});
		}
	}

	return F;
}
