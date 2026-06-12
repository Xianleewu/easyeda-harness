import { CONFIG } from './config.mjs';

function pointKey(x, y) {
	return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

export function rawWireStats(rawWires = [], limits = CONFIG.rawWire || {}) {
	const maxPrimitiveSegments = limits.maxPrimitiveSegments ?? 16;
	const maxPairSegments = limits.maxPairSegments ?? 32;
	const maxDuplicatePoints = limits.maxDuplicatePoints ?? 0;
	const maxPairBranchPoints = limits.maxPairBranchPoints ?? null;
	const findings = [];
	const rows = [];
	let zeroSegments = 0;
	let duplicateSegments = 0;
	let repeatedPointTotal = 0;
	let diagonalSegments = 0;
	let overComplexPrimitives = 0;
	let overSharedPointPrimitives = 0;
	let overBranchedPairPrimitives = 0;
	let pairBranchPointTotal = 0;

	for (const w of rawWires || []) {
		const l = w.line || [];
		function scan(step) {
			const seenSeg = new Map();
			const seenPt = new Map();
			const neighbors = new Map();
			let segmentCount = 0;
			let zero = 0;
			let duplicate = 0;
			let diagonal = 0;
			for (let i = 0; i + 3 < l.length; i += step) {
				const [x1, y1, x2, y2] = [l[i], l[i + 1], l[i + 2], l[i + 3]];
				segmentCount++;
				const a = pointKey(x1, y1);
				const b = pointKey(x2, y2);
				seenPt.set(a, (seenPt.get(a) || 0) + 1);
				seenPt.set(b, (seenPt.get(b) || 0) + 1);
				if (a === b) {
					zero++;
					continue;
				}
				if (!neighbors.has(a)) neighbors.set(a, new Set());
				if (!neighbors.has(b)) neighbors.set(b, new Set());
				neighbors.get(a).add(b);
				neighbors.get(b).add(a);
				if (x1 !== x2 && y1 !== y2) diagonal++;
				const sk = [a, b].sort().join('|');
				if (seenSeg.has(sk)) duplicate++;
				seenSeg.set(sk, (seenSeg.get(sk) || 0) + 1);
			}
			const duplicatePoints = [...seenPt.values()].filter(n => n > 1).reduce((a, n) => a + n - 1, 0);
			const branchPoints = [...neighbors.entries()]
				.filter(([, nb]) => nb.size > 2)
				.map(([point, nb]) => ({ point, degree: nb.size }));
			return { segmentCount, zero, duplicate, diagonal, duplicatePoints, branchPoints };
		}
		const pairMode = l.length >= 8 && l.length % 4 === 0;
		const pairScan = pairMode ? scan(4) : null;
		const polyScan = scan(2);
		const usePair = pairScan && !pairScan.zero && !pairScan.duplicate && !pairScan.diagonal;
		const chosen = usePair ? pairScan : polyScan;
		let segmentCount = chosen.segmentCount;
		let zero = chosen.zero;
		let duplicate = chosen.duplicate;
		let diagonal = chosen.diagonal;
		const repeatedPoints = chosen.duplicatePoints;
		const branchPoints = usePair ? chosen.branchPoints : [];
		if (!usePair && pairScan) {
			zero = Math.max(zero, pairScan.zero);
			duplicate = Math.max(duplicate, pairScan.duplicate);
			diagonal = Math.max(diagonal, pairScan.diagonal);
		}
		const overComplex = usePair ? segmentCount > maxPairSegments : segmentCount > maxPrimitiveSegments;
		const overSharedPoint = !usePair && repeatedPoints > maxDuplicatePoints;
		const enforcePairBranches = Number.isFinite(maxPairBranchPoints);
		const overBranchedPair = enforcePairBranches && usePair && branchPoints.length > maxPairBranchPoints;
		if (zero || duplicate || diagonal || overComplex || overSharedPoint || overBranchedPair) {
			rows.push({
				id: w.id || '',
				net: w.net || '',
				mode: usePair ? 'segment-pairs' : 'polyline',
				segmentCount,
				duplicatePoints: repeatedPoints,
				duplicateSegments: duplicate,
				zeroSegments: zero,
				diagonalSegments: diagonal,
				pairBranchPoints: branchPoints,
				line: l,
			});
		}
		zeroSegments += zero;
		duplicateSegments += duplicate;
		repeatedPointTotal += repeatedPoints;
		diagonalSegments += diagonal;
		if (overComplex) overComplexPrimitives++;
		if (overSharedPoint) overSharedPointPrimitives++;
		if (overBranchedPair) overBranchedPairPrimitives++;
		pairBranchPointTotal += branchPoints.length;
	}

	rows.sort((a, b) =>
		(b.zeroSegments + b.duplicateSegments + b.diagonalSegments + b.segmentCount)
		- (a.zeroSegments + a.duplicateSegments + a.diagonalSegments + a.segmentCount));

	if (zeroSegments) findings.push({ kind: 'zero', count: zeroSegments });
	if (duplicateSegments) findings.push({ kind: 'duplicate', count: duplicateSegments });
	if (overSharedPointPrimitives) findings.push({ kind: 'shared-point', count: overSharedPointPrimitives });
	if (diagonalSegments) findings.push({ kind: 'diagonal', count: diagonalSegments });
	if (overComplexPrimitives) findings.push({ kind: 'complex', count: overComplexPrimitives });
	if (Number.isFinite(maxPairBranchPoints) && overBranchedPairPrimitives) findings.push({ kind: 'branched-pair', count: overBranchedPairPrimitives });

	return {
		wireCount: rawWires.length,
		maxPrimitiveSegments,
		maxPairSegments,
		maxDuplicatePoints,
		maxPairBranchPoints,
		zeroSegments,
		duplicateSegments,
		duplicatePoints: repeatedPointTotal,
		diagonalSegments,
		overComplexPrimitives,
		overSharedPointPrimitives,
		overBranchedPairPrimitives,
		pairBranchPoints: pairBranchPointTotal,
		offenders: rows,
		findings,
		pass: findings.length === 0,
	};
}
