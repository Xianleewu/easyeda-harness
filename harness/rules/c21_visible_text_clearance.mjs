import { segIntersectsRect } from '../model.mjs';

const TEXT_PAD = 1.5;

function finite(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

function normalizeBox(b) {
	if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(finite)) return null;
	return {
		minX: Math.min(b.minX, b.maxX),
		minY: Math.min(b.minY, b.maxY),
		maxX: Math.max(b.minX, b.maxX),
		maxY: Math.max(b.minY, b.maxY),
	};
}

function textBox(x, y, text, alignMode = 3, fontSize = 8) {
	const s = String(text || '');
	const w = Math.max(fontSize * 1.5, s.length * fontSize * 0.58);
	const h = fontSize * 1.15;
	const mode = Number(alignMode);
	if (mode === 1) return { minX: x, maxX: x + w, minY: y - h, maxY: y + fontSize * 0.28 };
	if (mode === 2) return { minX: x - w / 2, maxX: x + w / 2, minY: y - h, maxY: y };
	if (mode === 3) return { minX: x - w, maxX: x, minY: y - h, maxY: y + fontSize * 0.28 };
	if (mode === 6) return { minX: x, maxX: x + w, minY: y - fontSize * 0.28, maxY: y + h - fontSize * 0.28 };
	if (mode === 7) return { minX: x, maxX: x + w, minY: y - fontSize * 0.28, maxY: y + h - fontSize * 0.28 };
	if (mode === 8) return { minX: x - w, maxX: x, minY: y - fontSize * 0.28, maxY: y + h - fontSize * 0.28 };
	if (mode === 9) return { minX: x - w, maxX: x, minY: y - fontSize * 0.28, maxY: y + h - fontSize * 0.28 };
	return { minX: x, maxX: x + w, minY: y - fontSize * 0.28, maxY: y + h - fontSize * 0.28 };
}

function overlap(a, b, pad = 0) {
	return a.minX < b.maxX + pad && b.minX < a.maxX + pad &&
		a.minY < b.maxY + pad && b.minY < a.maxY + pad;
}

function rectGap(a, b) {
	const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
	const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
	return Math.hypot(dx, dy);
}

function area(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function intersectionArea(a, b) {
	const w = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
	const h = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
	return w * h;
}

function meaningfulOverlap(a, b) {
	if (!overlap(a, b, TEXT_PAD)) return false;
	const ratio = intersectionArea(a, b) / Math.max(1, Math.min(area(a), area(b)));
	return ratio > 0.08 || rectGap(a, b) < TEXT_PAD;
}

function visibleTexts(m) {
	const out = [];
	const netLabelTexts = new Set((m.netlabels || [])
		.filter(f => f.source === 'text-net-label')
		.map(f => `${f.net}|${Number(f.x).toFixed(2)}|${Number(f.y).toFixed(2)}`));
	for (const t of m.texts || []) {
		const text = String(t.content || '').trim();
		if (!text) continue;
		if (netLabelTexts.has(`${text}|${Number(t.x).toFixed(2)}|${Number(t.y).toFixed(2)}`)) continue;
		const box = normalizeBox(t.bbox) || textBox(Number(t.x || 0), Number(t.y || 0), text, t.alignMode ?? 2, t.fontSize ?? 10);
		out.push({ role: 'document-text', text, owner: t.role || text.slice(0, 40), module: t.module || '', box });
	}
	for (const p of m.parts || []) {
		for (const attr of p.attrs || []) {
			if (attr.valueVisible !== true || String(attr.value || '').trim() === '') continue;
			const key = String(attr.key || '');
			if (key !== 'Designator') continue;
			if (!finite(attr.x) || !finite(attr.y)) continue;
			out.push({
				role: 'part-designator',
				text: String(attr.value || p.designator || ''),
				owner: p.designator,
				selfPart: p.designator,
				box: textBox(attr.x, attr.y, attr.value || p.designator, attr.alignMode ?? 3, 8),
			});
		}
	}
	for (const w of m.rawWires || []) {
		for (const attr of w.attrs || []) {
			if (!['Name', 'NET'].includes(String(attr.key || ''))) continue;
			if (attr.valueVisible === false || String(attr.value || '').trim() === '') continue;
			if (!finite(attr.x) || !finite(attr.y)) continue;
			out.push({
				role: 'wire-name',
				text: String(attr.value || w.net || ''),
				owner: String(w.net || attr.value || ''),
				box: textBox(attr.x, attr.y, attr.value || w.net, attr.alignMode ?? 6, 8),
			});
		}
	}
	return out.filter(t => t.box);
}

function segments(m) {
	return (m.rawSegments || m.segments || []).map(s => ({
		net: s.net || '',
		x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2,
	}));
}

function hard(F, rule, msg, where = {}) {
	F.push({ rule, severity: 'hard', category: 'visible-text', msg, where });
}

export function c21VisibleTextClearance(m) {
	const F = [];
	const texts = visibleTexts(m);
	const parts = (m.parts || []).filter(p => p.bbox).map(p => ({ designator: p.designator, box: normalizeBox(p.bbox) })).filter(p => p.box);
	const flags = [...(m.netflags || []), ...(m.netports || []), ...(m.netlabels || [])]
		.filter(f => f.bbox).map(f => ({ net: f.net || '', kind: f.kind || f.type || '', box: normalizeBox(f.bbox) })).filter(f => f.box);
	const rects = (m.rectangles || [])
		.map(r => ({ role: r.role || '', module: r.module || '', box: normalizeBox(r.bbox || r) }))
		.filter(r => r.box && /module-(frame|title-marker)/.test(r.role));
	const S = segments(m);

	for (let i = 0; i < texts.length; i++) {
		for (let j = i + 1; j < texts.length; j++) {
			const a = texts[i], b = texts[j];
			if (!meaningfulOverlap(a.box, b.box)) continue;
			hard(F, 'C21.1-visible-text-overlap', `visible text overlaps: ${a.text} -> ${b.text}`, {
				a: { role: a.role, text: a.text, owner: a.owner, box: a.box },
				b: { role: b.role, text: b.text, owner: b.owner, box: b.box },
			});
		}
	}

	for (const t of texts) {
		for (const p of parts) {
			if (t.selfPart === p.designator) continue;
			if (!meaningfulOverlap(t.box, p.box)) continue;
			hard(F, 'C21.2-visible-text-over-part', `visible text [${t.text}] overlaps ${p.designator}`, {
				text: { role: t.role, text: t.text, owner: t.owner, box: t.box },
				part: p.designator,
			});
		}
		for (const f of flags) {
			if (!meaningfulOverlap(t.box, f.box)) continue;
			hard(F, 'C21.3-visible-text-over-flag', `visible text [${t.text}] overlaps ${f.net || f.kind} flag`, {
				text: { role: t.role, text: t.text, owner: t.owner, box: t.box },
				flag: { net: f.net, kind: f.kind, box: f.box },
			});
		}
		for (const s of S) {
			if (!segIntersectsRect(s, { minX: t.box.minX + 1, minY: t.box.minY + 1, maxX: t.box.maxX - 1, maxY: t.box.maxY - 1 })) continue;
			hard(F, 'C21.4-visible-text-over-wire', `visible text [${t.text}] overlaps a wire`, {
				text: { role: t.role, text: t.text, owner: t.owner, box: t.box },
				wire: { net: s.net, seg: [s.x1, s.y1, s.x2, s.y2] },
			});
		}
		for (const r of rects) {
			if (t.module && r.module && t.module === r.module) continue;
			if (!meaningfulOverlap(t.box, r.box)) continue;
			hard(F, 'C21.5-visible-text-over-document-rect', `visible text [${t.text}] overlaps document rectangle ${r.role}`, {
				text: { role: t.role, text: t.text, owner: t.owner, box: t.box },
				rect: { role: r.role, module: r.module, box: r.box },
			});
		}
	}

	return F;
}
