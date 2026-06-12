import { CONFIG } from '../config.mjs';
import { shrinkRect, ptInRect, segIntersectsRect, segSeg, rectsGap, samePt } from '../model.mjs';

function crossPoint(a, b) {
	if (a.x1 === a.x2 && b.y1 === b.y2) return { x: a.x1, y: b.y1 };
	if (a.y1 === a.y2 && b.x1 === b.x2) return { x: b.x1, y: a.y1 };
	return null;
}

function isSegEndpoint(s, pt) {
	if (!pt) return false;
	return samePt(s.x1, s.y1, pt.x, pt.y) || samePt(s.x2, s.y2, pt.x, pt.y);
}

function sharedEndpointAtCrossing(a, b) {
	const pt = crossPoint(a, b);
	return isSegEndpoint(a, pt) && isSegEndpoint(b, pt);
}

function orthogonalMidContact(a, b) {
	if (a.diagonal || b.diagonal) return null;
	const pt = crossPoint(a, b);
	if (!pt) return null;
	const aHorizontal = a.y1 === a.y2;
	const bHorizontal = b.y1 === b.y2;
	if (aHorizontal === bHorizontal) return null;
	const h = aHorizontal ? a : b;
	const v = aHorizontal ? b : a;
	const onH = pt.x >= Math.min(h.x1, h.x2) && pt.x <= Math.max(h.x1, h.x2);
	const onV = pt.y >= Math.min(v.y1, v.y2) && pt.y <= Math.max(v.y1, v.y2);
	if (!onH || !onV) return null;
	const aEndpoint = isSegEndpoint(a, pt);
	const bEndpoint = isSegEndpoint(b, pt);
	if (aEndpoint && bEndpoint) return null;
	return { x: pt.x, y: pt.y, endpoint: [aEndpoint, bEndpoint] };
}

function isDocumentText(t) {
	const content = String(t.content || '').trim();
	if (t.role || t.kind === 'doc-text') return true;
	return /^(AIHWDEBUGER CONTROL & POWER|P1 DETAIL SCHEMATIC|PROJECT:\s*AIHWDEBUGER|REV:\s*[A-Z0-9.-]+\s*\|\s*STATUS:\s*(REVIEW|RELEASED|DRAFT|PASS)|SHEET:\s*\d+\s+OF\s+\d+|SOURCE:\s*HARNESS\s+PASS|DRC: 0 ERR \/ 0 WARN \/ 0 INFO|USB\/power\s*->\s*ESP32-C3\s*->\s*switched and relay outputs|USB-C INPUT|5V TO 3V3 POWER|RESET SUPPORT|BOOT SUPPORT|ESP32-C3 MCU|HIGH-SIDE POWER SWITCH|RELAY OUTPUT [12])$/i.test(content);
}

function textNetLabel(m, t) {
	const content = String(t.content || '').trim();
	return (m.netlabels || []).find(f => f.source === 'text-net-label'
		&& f.net === content
		&& Math.abs(Number(f.x) - Number(t.x)) <= 1
		&& Math.abs(Number(f.y) - Number(t.y)) <= 1);
}

export function c2Overlap(m) {
	const F = [];

	for (let i = 0; i < m.parts.length; i++) {
		for (let j = i + 1; j < m.parts.length; j++) {
			const a = m.parts[i].bodyBBox || m.parts[i].bbox;
			const b = m.parts[j].bodyBBox || m.parts[j].bbox;
			const gap = rectsGap(a, b);
			const hardGap = rectsGap(shrinkRect(a, CONFIG.body.overlapShrink), shrinkRect(b, CONFIG.body.overlapShrink));
			if (hardGap < 0) F.push({ rule: 'C2.1-overlap', severity: 'hard', category: 'overlap',
				msg: `Component bodies overlap deeply: ${m.parts[i].designator} -> ${m.parts[j].designator} (gap ${hardGap})`, where: [m.parts[i].designator, m.parts[j].designator] });
			else if (gap < CONFIG.spacing.minComponentGap) F.push({ rule: 'C2.1-near', severity: 'hard', category: 'overlap',
				msg: `Component spacing below ${CONFIG.spacing.minComponentGap}: ${m.parts[i].designator} -> ${m.parts[j].designator} (gap ${gap})`, where: [m.parts[i].designator, m.parts[j].designator] });
		}
	}

	for (const s of m.segments) {
		for (const p of m.parts) {
			const r = shrinkRect(p.bodyBBox || p.bbox, CONFIG.body.shrink);
			if (r.maxX <= r.minX || r.maxY <= r.minY) continue;
			if (!segIntersectsRect(s, r)) continue;
			const through = !ptInRect(s.x1, s.y1, r) && !ptInRect(s.x2, s.y2, r);
			F.push({ rule: 'C2.2-wire-thru-body', severity: 'hard', category: 'overlap',
				msg: `Wire ${through ? 'passes through' : 'enters'} component body ${p.designator}(${p.name}) seg=[${s.x1},${s.y1},${s.x2},${s.y2}]`,
				where: { designator: p.designator, seg: [s.x1, s.y1, s.x2, s.y2] } });
		}
	}

	for (const t of m.texts) {
		if (textNetLabel(m, t)) continue;
		if (isDocumentText(t)) continue;
		const allowed = (CONFIG.text.allowedPatterns || []).some(p => new RegExp(p).test(t.content || ''));
		if (!CONFIG.text.allowFloating && !allowed) {
			F.push({ rule: 'C2.0-floating-text', severity: 'hard', category: 'overlap',
				msg: `Uncontrolled schematic text: "${(t.content || '').slice(0, 40)}" @(${t.x},${t.y})`,
				where: { x: t.x, y: t.y, content: (t.content || '').slice(0, 80) } });
		}
	}

	for (const t of m.texts) {
		const netLabel = textNetLabel(m, t);
		if (netLabel) continue;
		if (isDocumentText(t)) continue;
		const r = shrinkRect(t.bbox, 1);
		if (r.maxX <= r.minX || r.maxY <= r.minY) continue;
		const hit = m.segments.find(s => segIntersectsRect(s, r));
		if (hit) F.push({ rule: 'C2.3-text-over-wire', severity: 'hard', category: 'overlap',
			msg: `Text overlaps wire: "${(t.content || '').slice(0, 40)}" @(${t.x},${t.y})`, where: { x: t.x, y: t.y, content: (t.content || '').slice(0, 60) } });
	}

	for (const t of m.texts) {
		if (textNetLabel(m, t)) continue;
		if (isDocumentText(t)) continue;
		for (const p of m.parts) {
			const a = t.bbox;
			const b = shrinkRect(p.bodyBBox || p.bbox, 1);
			const overlap = !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
			if (overlap) {
				F.push({ rule: 'C2.4-text-over-body', severity: 'hard', category: 'overlap',
					msg: `Text overlaps component body ${p.designator}: "${(t.content || '').slice(0, 30)}"`, where: { designator: p.designator, content: (t.content || '').slice(0, 40) } });
				break;
			}
		}
	}

	const hs = CONFIG.netflag.halfSize;
	for (const nf of m.netflags) {
		if (nf.kind === 'sig' || nf.type === 'netport') continue;
		const r = { minX: nf.x - hs, maxX: nf.x + hs, minY: nf.y - hs, maxY: nf.y + hs };
		for (const s of m.segments) {
			const through = !samePt(s.x1, s.y1, nf.x, nf.y) && !samePt(s.x2, s.y2, nf.x, nf.y) && segIntersectsRect(s, r);
			if (through) {
				F.push({ rule: 'C2.5-wire-thru-netflag', severity: 'hard', category: 'overlap',
					msg: `Wire passes through ${nf.net} netflag @(${nf.x},${nf.y})`, where: { net: nf.net, at: [nf.x, nf.y] } });
				break;
			}
		}
	}

	let crossings = 0;
	const samples = [];
	for (let i = 0; i < m.segments.length; i++) {
		for (let j = i + 1; j < m.segments.length; j++) {
			const a = m.segments[i];
			const b = m.segments[j];
			if (!a.net && !b.net) continue;
			if (a.net && b.net && a.net === b.net) continue;
			if (segSeg(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2)) {
				if (sharedEndpointAtCrossing(a, b)) continue;
				crossings++;
				if (samples.length < 15) samples.push({ a: [a.x1, a.y1, a.x2, a.y2], b: [b.x1, b.y1, b.x2, b.y2], nets: [a.net || '', b.net || ''] });
			}
		}
	}
	if (crossings) F.push({ rule: 'C2.6-wire-cross', severity: 'hard', category: 'overlap',
		msg: `${crossings} wire crossings without a shared endpoint`, where: samples });

	let midContacts = 0;
	const midSamples = [];
	const rawSegments = m.rawSegments || m.segments || [];
	for (let i = 0; i < rawSegments.length; i++) {
		for (let j = i + 1; j < rawSegments.length; j++) {
			const a = rawSegments[i];
			const b = rawSegments[j];
			const pt = orthogonalMidContact(a, b);
			if (!pt) continue;
			midContacts++;
			if (midSamples.length < 15) midSamples.push({
				a: [a.x1, a.y1, a.x2, a.y2],
				b: [b.x1, b.y1, b.x2, b.y2],
				nets: [a.net || '', b.net || ''],
				point: [pt.x, pt.y],
				endpoint: pt.endpoint,
			});
		}
	}
	if (midContacts) F.push({ rule: 'C2.7-wire-mid-contact', severity: 'hard', category: 'overlap',
		msg: `${midContacts} wire mid-segment contacts without explicit shared endpoints`, where: midSamples });

	return F;
}
