import { CONFIG } from '../config.mjs';
import { key, onGrid, round2 } from '../model.mjs';

export function c1Layout(m) {
	const F = [];
	const { primary, fallback } = CONFIG.grid;

	const off5 = new Set();
	const off10 = new Set();
	const terminalPts = new Set();
	for (const p of m.parts) {
		for (const pin of p.pins || []) terminalPts.add(key(pin.x, pin.y));
	}
	for (const nf of m.netflags || []) terminalPts.add(key(nf.x, nf.y));
	for (const np of m.netports || []) terminalPts.add(key(np.x, np.y));
	const pinAdjacent = new Set();
	for (const s of m.segments) {
		const a = key(s.x1, s.y1);
		const b = key(s.x2, s.y2);
		if (terminalPts.has(a)) pinAdjacent.add(b);
		if (terminalPts.has(b)) pinAdjacent.add(a);
	}
	for (const s of m.segments) {
		for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
			const pt = key(x, y);
			if (terminalPts.has(pt)) continue;
			if (pinAdjacent.has(pt)) continue;
			if (!onGrid(x, fallback) || !onGrid(y, fallback)) off5.add(`${x},${y}`);
			else if (!onGrid(x, primary) || !onGrid(y, primary)) off10.add(`${x},${y}`);
		}
	}
	for (const pt of off5) F.push({ rule: 'C1.1-offgrid5', severity: 'hard', category: 'layout', msg: `Endpoint is off ${fallback}-grid: ${pt}`, where: pt });
	if (off10.size) F.push({ rule: 'C1.1-offgrid10', severity: 'hard', category: 'layout', msg: `${off10.size} non-pin endpoints are only on ${fallback}-grid, not ${primary}-grid`, where: [...off10] });

	const tol = CONFIG.align.tolerance;
	const findClusters = (axis) => {
		const arr = m.parts.map(p => ({ d: p.designator, v: axis === 'x' ? p.cx : p.cy, other: axis === 'x' ? p.cy : p.cx }))
			.sort((a, b) => a.v - b.v);
		const clusters = [];
		let cur = [];
		for (const it of arr) {
			if (cur.length && Math.abs(it.v - cur[cur.length - 1].v) > tol) {
				if (cur.length >= CONFIG.align.minCluster) clusters.push(cur);
				cur = [];
			}
			cur.push(it);
		}
		if (cur.length >= CONFIG.align.minCluster) clusters.push(cur);
		return clusters.filter(c => {
			const vs = c.map(i => i.v);
			return Math.max(...vs) - Math.min(...vs) > 1e-6;
		});
	};

	if (process.env.EASYEDA_HARNESS_ALIGN_ADVISORY === '1') {
		for (const c of findClusters('x')) {
			if (c.length >= 4) F.push({ rule: 'C1.2-misalign-col', severity: 'hard', category: 'layout',
				msg: `Likely column alignment drift: ${c.map(i => `${i.d}@x=${round2(i.v)}`).join(', ')}`, where: c.map(i => i.d) });
		}
		for (const c of findClusters('y')) {
			if (c.length >= 4) F.push({ rule: 'C1.2-misalign-row', severity: 'hard', category: 'layout',
				msg: `Likely row alignment drift: ${c.map(i => `${i.d}@y=${round2(i.v)}`).join(', ')}`, where: c.map(i => i.d) });
		}
	}

	if (m.parts.length) {
		const boxes = m.parts.map(p => p.bodyBBox || p.bbox);
		const bb = {
			minX: Math.min(...boxes.map(b => b.minX)),
			maxX: Math.max(...boxes.map(b => b.maxX)),
			minY: Math.min(...boxes.map(b => b.minY)),
			maxY: Math.max(...boxes.map(b => b.maxY)),
		};
		const width = round2(bb.maxX - bb.minX);
		const height = round2(bb.maxY - bb.minY);
		const areaPerPart = round2((width * height) / Math.max(1, m.parts.length));
		const cfg = CONFIG.activeArea;
		if (width > cfg.maxWidth) F.push({ rule: 'C1.4-active-width', severity: 'hard', category: 'layout',
			msg: `Active schematic width too large: ${width} > ${cfg.maxWidth}`, where: { width, bbox: bb } });
		if (height > cfg.maxHeight) F.push({ rule: 'C1.5-active-height', severity: 'hard', category: 'layout',
			msg: `Active schematic height too large: ${height} > ${cfg.maxHeight}`, where: { height, bbox: bb } });
		if (areaPerPart > cfg.maxAreaPerPart) F.push({ rule: 'C1.6-active-area-per-part', severity: 'hard', category: 'layout',
			msg: `Active area per part too sparse: ${areaPerPart} > ${cfg.maxAreaPerPart}`, where: { areaPerPart, parts: m.parts.length, bbox: bb } });
	}

	const sb = m.sheetBBox;
	/* 密度规则对"满图"才有意义；元件极少的小项目在标准图框上天然稀疏，
	 * 不应据此判失败（AIHWDEBUGER 34 件 >= 阈值，行为不变）。 */
	const MIN_PARTS_FOR_DENSITY = 8;
	if (sb && m.parts.length >= MIN_PARTS_FOR_DENSITY) {
		const sheetArea = (sb.maxX - sb.minX) * (sb.maxY - sb.minY);
		const partArea = m.parts.reduce((a, p) => a + (p.bbox.maxX - p.bbox.minX) * (p.bbox.maxY - p.bbox.minY), 0);
		const density = sheetArea > 0 ? round2(partArea / sheetArea * 100) : 0;
		if (density < 1) F.push({ rule: 'C1.3-density', severity: 'hard', category: 'layout',
			msg: `Sheet component density too low: ${density}% (${round2(sb.maxX - sb.minX)}x${round2(sb.maxY - sb.minY)})`, where: { density, sheet: sb } });
	}

	return F;
}
