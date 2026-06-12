import { CONFIG } from '../config.mjs';
import { round2 } from '../model.mjs';
import { rawWireStats } from '../raw_wire_quality.mjs';

const POWER_NETS = new Set(['GND', 'SYS_3V3', 'SYS_5V', 'VIN_12_19V', 'VOUT_SW']);
const parseKey = (k) => k.split(',').map(Number);
const pointKey = (x, y) => `${Math.round(x / CONFIG.match.snap) * CONFIG.match.snap},${Math.round(y / CONFIG.match.snap) * CONFIG.match.snap}`;
const collinear = (ax, ay, bx, by, cx, cy) =>
	Math.abs((by - ay) * (cx - bx) - (cy - by) * (bx - ax)) < CONFIG.wiring.collinearEps;

function betweenInclusive(v, a, b) {
	const snap = CONFIG.match.snap;
	return v >= Math.min(a, b) - snap - 1e-6 && v <= Math.max(a, b) + snap + 1e-6;
}

function pointOnOrthogonalSegment(x, y, s) {
	const snap = CONFIG.match.snap;
	if (Math.abs(s.x1 - s.x2) < 1e-6) return Math.abs(x - s.x1) < snap + 1e-6 && betweenInclusive(y, s.y1, s.y2);
	if (Math.abs(s.y1 - s.y2) < 1e-6) return Math.abs(y - s.y1) < snap + 1e-6 && betweenInclusive(x, s.x1, s.x2);
	return false;
}

function groupHasFlagLikeAnchor(g, flagLike) {
	const points = g.points || new Set();
	return flagLike.some(f => {
		if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) return false;
		if (points.has(pointKey(f.x, f.y))) return true;
		return g.segs.some(s => pointOnOrthogonalSegment(f.x, f.y, s));
	});
}

function countBends(g) {
	let bends = 0, junctions = 0;
	for (const [k, nb] of g.adj) {
		const deg = nb.size;
		if (deg >= 3) {
			junctions++;
			continue;
		}
		if (deg === 2) {
			const [n1, n2] = [...nb];
			const [bx, by] = parseKey(k);
			const [ax, ay] = parseKey(n1);
			const [cx, cy] = parseKey(n2);
			if (!collinear(ax, ay, bx, by, cx, cy)) bends++;
		}
	}
	return { bends, junctions };
}

export function c4Wiring(m) {
	const F = [];
	const raw = rawWireStats(m.rawWires || []);
	if (raw.zeroSegments) {
		F.push({
			rule: 'C4.5-raw-wire-zero',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw wire primitives contain ${raw.zeroSegments} zero-length segment(s)`,
			where: { offenders: raw.offenders.filter(w => w.zeroSegments).slice(0, 10) },
		});
	}
	if (raw.duplicateSegments) {
		F.push({
			rule: 'C4.6-raw-wire-duplicate',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw wire primitives contain ${raw.duplicateSegments} duplicate segment(s)`,
			where: { offenders: raw.offenders.filter(w => w.duplicateSegments).slice(0, 10) },
		});
	}
	if (raw.overSharedPointPrimitives) {
		F.push({
			rule: 'C4.9-raw-wire-shared-point',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw wire primitives contain ${raw.overSharedPointPrimitives} primitive(s) with repeated internal points`,
			where: { maxDuplicatePoints: raw.maxDuplicatePoints, offenders: raw.offenders.filter(w => w.duplicatePoints > raw.maxDuplicatePoints).slice(0, 10) },
		});
	}
	if (raw.diagonalSegments) {
		F.push({
			rule: 'C4.7-raw-wire-diagonal',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw wire primitives contain ${raw.diagonalSegments} non-orthogonal segment(s)`,
			where: { offenders: raw.offenders.filter(w => w.diagonalSegments).slice(0, 10) },
		});
	}
	if (raw.overComplexPrimitives) {
		F.push({
			rule: 'C4.8-raw-wire-complex',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw wire primitives contain ${raw.overComplexPrimitives} over-complex primitive(s)`,
			where: { maxPrimitiveSegments: raw.maxPrimitiveSegments, offenders: raw.offenders.filter(w => w.segmentCount > raw.maxPrimitiveSegments).slice(0, 10) },
		});
	}
	if (raw.overBranchedPairPrimitives) {
		F.push({
			rule: 'C4.11-raw-wire-branched-pair',
			severity: 'hard',
			category: 'wiring',
			msg: `Raw live wire primitives contain ${raw.overBranchedPairPrimitives} branched segment-pair primitive(s)`,
			where: {
				maxPairBranchPoints: raw.maxPairBranchPoints,
				offenders: raw.offenders.filter(w => (w.pairBranchPoints || []).length > raw.maxPairBranchPoints).slice(0, 10),
			},
		});
	}

	const flagLike = [
		...(m.netflags || []),
		...(m.netports || []),
		...(m.netlabels || []),
	].filter(f => f && f.net);
	for (const g of m.groups) {
		if ((g.pins || []).length) continue;
		if (groupHasFlagLikeAnchor(g, flagLike)) continue;
		F.push({
			rule: 'C4.10-non-electrical-wire',
			severity: 'hard',
			category: 'wiring',
			msg: 'Wire group has no electrical endpoint; WIRE must not be used for document arrows or explanatory graphics',
			where: {
				segments: g.segs.slice(0, 8).map(s => [s.x1, s.y1, s.x2, s.y2]),
				totalLen: g.totalLen,
			},
		});
	}

	for (const s of m.segments) {
		if (POWER_NETS.has(s.net)) continue;
		if (s.len > CONFIG.segment.long) {
			F.push({
				rule: 'C4.1-long-seg',
				severity: 'hard',
				category: 'wiring',
				msg: `Segment too long ${s.len} (>${CONFIG.segment.long}) seg=[${s.x1},${s.y1},${s.x2},${s.y2}]`,
				where: { seg: [s.x1, s.y1, s.x2, s.y2], len: s.len },
			});
		}
	}

	for (const g of m.groups) {
		const nets = [...new Set(g.segs.map(s => s.net).filter(Boolean))];
		if (nets.some(n => POWER_NETS.has(n))) continue;
		const pinPts = [...new Set(g.pins.map(p => `${p.x},${p.y}`))].map(parseKey);
		const { bends, junctions } = countBends(g);

		if (pinPts.length !== 2 || junctions !== 0) continue;
		const samePart = new Set(g.pins.map(p => p.designator)).size === 1;
		if (samePart) continue;

		const [a, b] = pinPts;
		const manhattan = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
		const ratio = manhattan > 0 ? round2(g.totalLen / manhattan) : 0;
		const aligned = Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;

		if (aligned && bends > 0) {
			F.push({
				rule: 'C4.3-redundant-bend',
				severity: 'hard',
				category: 'wiring',
				msg: `Aligned two-pin connection has ${bends} redundant bend(s): ${g.pins.map(p => p.designator + '.' + p.pinName).join(' -> ')}`,
				where: { pins: g.pins, bends, pts: pinPts },
			});
		} else if (ratio > CONFIG.wiring.detourRatio) {
			F.push({
				rule: 'C4.2-detour',
				severity: 'hard',
				category: 'wiring',
				msg: `Detour route: actual ${g.totalLen} / manhattan ${manhattan} = ${ratio}x, ${g.pins.map(p => p.designator + '.' + p.pinName).join(' -> ')}`,
				where: { ratio, actual: g.totalLen, manhattan, pins: g.pins },
			});
		} else if (bends > CONFIG.wiring.maxLocalBends) {
			F.push({
				rule: 'C4.4-wander',
				severity: 'hard',
				category: 'wiring',
				msg: `Local two-pin connection has ${bends} bend(s) (>${CONFIG.wiring.maxLocalBends}): ${g.pins.map(p => p.designator + '.' + p.pinName).join(' -> ')}`,
				where: { bends, pins: g.pins },
			});
		}
	}

	return F;
}
