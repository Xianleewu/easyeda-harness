import { MODULES } from './module_registry.mjs';
import { rectsGap, segIntersectsRect, shrinkRect } from './model.mjs';

const MODULE_TITLES = {
	usb: 'USB-C INPUT',
	ldo: '5V TO 3V3 POWER',
	btn1: 'RESET SUPPORT',
	btn2: 'BOOT SUPPORT',
	mcu: 'ESP32-C3 MCU',
	pmos: 'HIGH-SIDE POWER SWITCH',
	relay1: 'RELAY OUTPUT 1',
	relay2: 'RELAY OUTPUT 2',
};

const FORBIDDEN_DOCUMENT_TEXT_PATTERNS = [
	/\bAPI\b/i,
	/\bRun API Gateway\b/i,
	/\bWebSocket\b/i,
	/\bbridge\b/i,
	/\bPowerShell\b/i,
	/\b(script|scripts)\b/i,
	/\b(run|apply)[-_./\\\w]*\.ps1\b/i,
	/\b(apply_full|apply_gated|harness_loop|snapshot2|drc_pull)\b/i,
	/\bbackup\b/i,
	/\bpermission(s)?\b/i,
	/\b权限\b/u,
	/\b备份\b/u,
	/\b脚本\b/u,
	/\b接口操作\b/u,
	/\bAPI操作\b/iu,
];

function forbiddenDocumentTextReason(content) {
	const text = String(content || '');
	for (const pattern of FORBIDDEN_DOCUMENT_TEXT_PATTERNS) {
		if (pattern.test(text)) return String(pattern);
	}
	return null;
}

function explanatoryTextReason(text, opts = {}) {
	const content = String(text?.content || '').trim();
	if (!content) return null;
	const maxChars = opts.maxDocumentTextChars ?? 72;
	const maxWords = opts.maxDocumentTextWords ?? 10;
	const lines = content.split(/\r?\n/).filter(Boolean).length;
	const words = content.split(/\s+/).filter(Boolean).length;
	const hasSentenceList = /[.;]\s+\S/.test(content) || /[:：]\s+\S/.test(content);
	if (lines > 1) return 'multi-line text object';
	if (content.length > maxChars) return `length ${content.length} > ${maxChars}`;
	if (words > maxWords && hasSentenceList) return `prose words ${words} > ${maxWords}`;
	return null;
}

function finite(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

function round(v) {
	return Math.round(v * 100) / 100;
}

function expand(b, m) {
	return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
}

function union(boxes) {
	const hit = boxes.filter(Boolean);
	if (!hit.length) return null;
	return {
		minX: Math.min(...hit.map(b => b.minX)),
		minY: Math.min(...hit.map(b => b.minY)),
		maxX: Math.max(...hit.map(b => b.maxX)),
		maxY: Math.max(...hit.map(b => b.maxY)),
	};
}

function normalizeBox(r) {
	if (!r) return null;
	if ([r.minX, r.minY, r.maxX, r.maxY].every(finite)) return {
		minX: Math.min(r.minX, r.maxX),
		minY: Math.min(r.minY, r.maxY),
		maxX: Math.max(r.minX, r.maxX),
		maxY: Math.max(r.minY, r.maxY),
	};
	if ([r.x, r.y, r.width, r.height].every(finite)) return {
		minX: Math.min(r.x, r.x + r.width),
		minY: Math.min(r.y, r.y + r.height),
		maxX: Math.max(r.x, r.x + r.width),
		maxY: Math.max(r.y, r.y + r.height),
	};
	if ([r.topLeftX, r.topLeftY, r.width, r.height].every(finite)) return {
		minX: Math.min(r.topLeftX, r.topLeftX + r.width),
		minY: Math.min(r.topLeftY, r.topLeftY - r.height, r.topLeftY + r.height),
		maxX: Math.max(r.topLeftX, r.topLeftX + r.width),
		maxY: Math.max(r.topLeftY, r.topLeftY - r.height, r.topLeftY + r.height),
	};
	return null;
}

function textBBox(text) {
	if (text?.bbox) return text.bbox;
	const content = String(text?.content || '');
	const x = Number(text?.x || 0);
	const y = Number(text?.y || 0);
	const fontSize = Number(text?.fontSize || 14);
	const width = Math.max(30, content.length * fontSize * 0.56);
	const height = Math.max(10, fontSize);
	if (text?.anchor === 'left') return { minX: x, minY: y - height, maxX: x + width, maxY: y };
	if (text?.anchor === 'right') return { minX: x - width, minY: y - height, maxX: x, maxY: y };
	if (Number(text?.alignMode) === 2) return { minX: x - width / 2, minY: y - height, maxX: x + width / 2, maxY: y };
	return { minX: x, minY: y - height, maxX: x + width, maxY: y };
}

function rectContains(a, b, slack = 0) {
	return a.minX <= b.minX + slack && a.minY <= b.minY + slack &&
		a.maxX >= b.maxX - slack && a.maxY >= b.maxY - slack;
}

function rectOverlap(a, b) {
	return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function rectTouchOrOverlap(a, b, slack = 0) {
	return !(a.maxX < b.minX - slack || a.minX > b.maxX + slack || a.maxY < b.minY - slack || a.minY > b.maxY + slack);
}

function rectArea(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function rectIntersectionArea(a, b) {
	const w = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
	const h = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
	return w * h;
}

function rectOverlapRatio(a, b) {
	const denom = Math.max(1, Math.min(rectArea(a), rectArea(b)));
	return rectIntersectionArea(a, b) / denom;
}

function rectWidth(b) {
	return Math.max(0, b.maxX - b.minX);
}

function rectHeight(b) {
	return Math.max(0, b.maxY - b.minY);
}

function markerNearTitle(marker, title) {
	if (!marker || !title) return false;
	const mb = marker.bbox || marker;
	const tb = title.bbox || title;
	const mcx = (mb.minX + mb.maxX) / 2;
	const tcx = (tb.minX + tb.maxX) / 2;
	const titleWidth = Math.max(1, tb.maxX - tb.minX);
	const markerWidth = mb.maxX - mb.minX;
	const yGap = tb.minY - mb.maxY;
	return Math.abs(mcx - tcx) <= 4 &&
		markerWidth >= titleWidth * 0.65 &&
		markerWidth <= titleWidth * 1.2 &&
		yGap >= 1 &&
		yGap <= 14;
}

function sameBox(a, b, tol = 2) {
	return !!a && !!b &&
		Math.abs(a.minX - b.minX) <= tol &&
		Math.abs(a.minY - b.minY) <= tol &&
		Math.abs(a.maxX - b.maxX) <= tol &&
		Math.abs(a.maxY - b.maxY) <= tol;
}

function moduleBoxes(model, margin = 0) {
	const byRef = new Map((model.components || model.parts || []).map(p => [p.designator, p]));
	return MODULES.map(mod => {
		const parts = mod.refs.map(ref => byRef.get(ref)).filter(Boolean);
		const box = union(parts.map(p => p.bbox || p.bodyBBox));
		return box ? { ...mod, box: expand(box, margin), parts } : null;
	}).filter(Boolean);
}

function wireSegments(model) {
	if (Array.isArray(model.segments)) return model.segments;
	const out = [];
	for (const w of model.wires || model.rawWires || []) {
		const line = w.line || [];
		for (let i = 0; i + 3 < line.length; i += 2) {
			const [x1, y1, x2, y2] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
			if (![x1, y1, x2, y2].every(finite) || (x1 === x2 && y1 === y2)) continue;
			out.push({ x1, y1, x2, y2, net: w.net || '', wireId: w.id });
		}
	}
	return out;
}

function modelGeometryBox(model) {
	const boxes = [];
	for (const c of model.components || model.parts || []) if (c.bbox) boxes.push(c.bbox);
	for (const f of model.netflags || []) if (f.bbox) boxes.push(f.bbox);
	for (const w of model.wires || model.rawWires || []) {
		const line = w.line || [];
		const xs = [];
		const ys = [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			if (finite(line[i]) && finite(line[i + 1])) {
				xs.push(line[i]);
				ys.push(line[i + 1]);
			}
		}
		if (xs.length) boxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
	}
	return union(boxes);
}

function between(v, a, b, slack = 0) {
	return v >= Math.min(a, b) - slack && v <= Math.max(a, b) + slack;
}

function spanOverlap(a0, a1, b0, b1, slack = 0) {
	return Math.min(a1, b1) >= Math.max(a0, b0) - slack;
}

function rectEdges(r) {
	return [
		{ side: 'bottom', x1: r.minX, y1: r.minY, x2: r.maxX, y2: r.minY },
		{ side: 'right', x1: r.maxX, y1: r.minY, x2: r.maxX, y2: r.maxY },
		{ side: 'top', x1: r.maxX, y1: r.maxY, x2: r.minX, y2: r.maxY },
		{ side: 'left', x1: r.minX, y1: r.maxY, x2: r.minX, y2: r.minY },
	];
}

function edgeWireHit(edge, s, slack = 0.75) {
	const edgeVertical = Math.abs(edge.x1 - edge.x2) <= slack;
	const edgeHorizontal = Math.abs(edge.y1 - edge.y2) <= slack;
	const segVertical = Math.abs(s.x1 - s.x2) <= slack;
	const segHorizontal = Math.abs(s.y1 - s.y2) <= slack;
	if (edgeVertical && segHorizontal) {
		return between(edge.x1, s.x1, s.x2, slack) && between(s.y1, edge.y1, edge.y2, slack);
	}
	if (edgeHorizontal && segVertical) {
		return between(edge.y1, s.y1, s.y2, slack) && between(s.x1, edge.x1, edge.x2, slack);
	}
	if (edgeVertical && segVertical && Math.abs(edge.x1 - s.x1) <= slack) {
		return spanOverlap(edge.y1, edge.y2, s.y1, s.y2, slack);
	}
	if (edgeHorizontal && segHorizontal && Math.abs(edge.y1 - s.y1) <= slack) {
		return spanOverlap(edge.x1, edge.x2, s.x1, s.x2, slack);
	}
	return false;
}

function frameWireHits(frame, segments, slack = 0.75) {
	const hits = [];
	for (const edge of rectEdges(frame)) {
		for (const s of segments) {
			if (edgeWireHit(edge, s, slack)) hits.push({ edge, segment: s });
		}
	}
	return hits;
}

function frameWireViolations(frame, segments, slack = 0.75) {
	return frameWireHits(frame, segments, slack).filter(hit => {
		const e = hit.edge;
		const s = hit.segment;
		const edgeVertical = Math.abs(e.x1 - e.x2) <= slack;
		const segVertical = Math.abs(s.x1 - s.x2) <= slack;
		if (edgeVertical === segVertical) return true;
		return false;
	});
}

function edgeIntersectsBox(edge, box, slack = 0.75, opts = {}) {
	if (!box) return false;
	const boundarySlack = opts.allowBoundaryTouch ? Math.max(slack, opts.boundarySlack ?? 0.75) : slack;
	const exMin = Math.min(edge.x1, edge.x2);
	const exMax = Math.max(edge.x1, edge.x2);
	const eyMin = Math.min(edge.y1, edge.y2);
	const eyMax = Math.max(edge.y1, edge.y2);
	if (Math.abs(edge.x1 - edge.x2) <= slack) {
		const onBoundary = Math.abs(edge.x1 - box.minX) <= boundarySlack || Math.abs(edge.x1 - box.maxX) <= boundarySlack;
		if (opts.allowBoundaryTouch && onBoundary) return false;
		return edge.x1 >= box.minX - slack && edge.x1 <= box.maxX + slack &&
			spanOverlap(eyMin, eyMax, box.minY, box.maxY, slack);
	}
	if (Math.abs(edge.y1 - edge.y2) <= slack) {
		const onBoundary = Math.abs(edge.y1 - box.minY) <= boundarySlack || Math.abs(edge.y1 - box.maxY) <= boundarySlack;
		if (opts.allowBoundaryTouch && onBoundary) return false;
		return edge.y1 >= box.minY - slack && edge.y1 <= box.maxY + slack &&
			spanOverlap(exMin, exMax, box.minX, box.maxX, slack);
	}
	return false;
}

function frameBoxHits(frame, boxes, slack = 0.75, opts = {}) {
	const hits = [];
	const allowedRefs = new Set(opts.allowedRefs || []);
	for (const edge of rectEdges(frame)) {
		for (const item of boxes) {
			if (allowedRefs.has(item.ref)) continue;
			if (edgeIntersectsBox(edge, item.box, slack, opts)) hits.push({ edge, item });
		}
	}
	return hits;
}

function expandFramePastWireEdges(frame, segments, opts = {}) {
	let out = { ...frame };
	const pad = opts.pad ?? 26;
	const maxIter = opts.maxIter ?? 12;
	for (let iter = 0; iter < maxIter; iter++) {
		const hits = frameWireHits(out, segments, 0.75);
		if (!hits.length) break;
		let changed = false;
		for (const hit of hits) {
			const s = hit.segment;
			const minX = Math.min(s.x1, s.x2);
			const maxX = Math.max(s.x1, s.x2);
			const minY = Math.min(s.y1, s.y2);
			const maxY = Math.max(s.y1, s.y2);
			if (hit.edge.side === 'left' && minX - pad < out.minX) {
				out.minX = minX - pad;
				changed = true;
			} else if (hit.edge.side === 'right' && maxX + pad > out.maxX) {
				out.maxX = maxX + pad;
				changed = true;
			} else if (hit.edge.side === 'bottom' && minY - pad < out.minY) {
				out.minY = minY - pad;
				changed = true;
			} else if (hit.edge.side === 'top' && maxY + pad > out.maxY) {
				out.maxY = maxY + pad;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return out;
}

function expandFrameUntilClear(frame, segments, opts = {}) {
	let out = { ...frame };
	const pad = opts.pad ?? 22;
	const maxIter = opts.maxIter ?? 20;
	for (let iter = 0; iter < maxIter; iter++) {
		const hits = frameWireHits(out, segments, 0.75);
		if (!hits.length) break;
		let changed = false;
		for (const hit of hits) {
			const s = hit.segment;
			const minX = Math.min(s.x1, s.x2);
			const maxX = Math.max(s.x1, s.x2);
			const minY = Math.min(s.y1, s.y2);
			const maxY = Math.max(s.y1, s.y2);
			if (hit.edge.side === 'left') {
				const next = minX - pad;
				if (next < out.minX - 0.1) { out.minX = next; changed = true; }
			} else if (hit.edge.side === 'right') {
				const next = maxX + pad;
				if (next > out.maxX + 0.1) { out.maxX = next; changed = true; }
			} else if (hit.edge.side === 'bottom') {
				const next = minY - pad;
				if (next < out.minY - 0.1) { out.minY = next; changed = true; }
			} else if (hit.edge.side === 'top') {
				const next = maxY + pad;
				if (next > out.maxY + 0.1) { out.maxY = next; changed = true; }
			}
		}
		if (!changed) {
			out.minX -= pad;
			out.maxX += pad;
			out.minY -= pad;
			out.maxY += pad;
		}
	}
	return out;
}

function clearFrameEdges(frame, segments, boxes, opts = {}) {
	let out = { ...frame };
	const pad = opts.pad ?? 22;
	const maxIter = opts.maxIter ?? 24;
	for (let iter = 0; iter < maxIter; iter++) {
		const wireHits = frameWireHits(out, segments, 0.75).map(h => ({ ...h, kind: 'wire' }));
		const boxHits = frameBoxHits(out, boxes, 0.75).map(h => ({ ...h, kind: 'box' }));
		const hits = [...wireHits, ...boxHits];
		if (!hits.length) break;
		let changed = false;
		for (const hit of hits) {
			if (hit.kind === 'wire') {
				const s = hit.segment;
				const minX = Math.min(s.x1, s.x2);
				const maxX = Math.max(s.x1, s.x2);
				const minY = Math.min(s.y1, s.y2);
				const maxY = Math.max(s.y1, s.y2);
				if (hit.edge.side === 'left') {
					const next = minX - pad;
					if (next < out.minX - 0.1) { out.minX = next; changed = true; }
				} else if (hit.edge.side === 'right') {
					const next = maxX + pad;
					if (next > out.maxX + 0.1) { out.maxX = next; changed = true; }
				} else if (hit.edge.side === 'bottom') {
					const next = minY - pad;
					if (next < out.minY - 0.1) { out.minY = next; changed = true; }
				} else if (hit.edge.side === 'top') {
					const next = maxY + pad;
					if (next > out.maxY + 0.1) { out.maxY = next; changed = true; }
				}
			} else {
				const b = hit.item.box;
				if (hit.edge.side === 'left') {
					const next = b.minX - pad;
					if (next < out.minX - 0.1) { out.minX = next; changed = true; }
				} else if (hit.edge.side === 'right') {
					const next = b.maxX + pad;
					if (next > out.maxX + 0.1) { out.maxX = next; changed = true; }
				} else if (hit.edge.side === 'bottom') {
					const next = b.minY - pad;
					if (next < out.minY - 0.1) { out.minY = next; changed = true; }
				} else if (hit.edge.side === 'top') {
					const next = b.maxY + pad;
					if (next > out.maxY + 0.1) { out.maxY = next; changed = true; }
				}
			}
		}
		if (!changed) {
			out.minX -= pad;
			out.maxX += pad;
			out.minY -= pad;
			out.maxY += pad;
		}
	}
	return out;
}

function nudgeFramePastBoxes(frame, boxes, contain, opts = {}) {
	let out = { ...frame };
	const clear = opts.clear ?? 8;
	const minMargin = opts.minMargin ?? 6;
	const maxIter = opts.maxIter ?? 12;
	for (let iter = 0; iter < maxIter; iter++) {
		const hits = frameBoxHits(out, boxes, 0.75);
		if (!hits.length) break;
		let changed = false;
		for (const hit of hits) {
			const b = hit.item.box;
			if (hit.edge.side === 'left') {
				const inward = b.maxX + clear;
				const outward = b.minX - clear;
				const next = inward <= contain.minX - minMargin ? inward : outward;
				if (Math.abs(out.minX - next) > 0.1) { out.minX = next; changed = true; }
			} else if (hit.edge.side === 'right') {
				const inward = b.minX - clear;
				const outward = b.maxX + clear;
				const next = inward >= contain.maxX + minMargin ? inward : outward;
				if (Math.abs(out.maxX - next) > 0.1) { out.maxX = next; changed = true; }
			} else if (hit.edge.side === 'bottom') {
				const inward = b.maxY + clear;
				const outward = b.minY - clear;
				const next = inward <= contain.minY - minMargin ? inward : outward;
				if (Math.abs(out.minY - next) > 0.1) { out.minY = next; changed = true; }
			} else if (hit.edge.side === 'top') {
				const inward = b.minY - clear;
				const outward = b.maxY + clear;
				const next = inward >= contain.maxY + minMargin ? inward : outward;
				if (Math.abs(out.maxY - next) > 0.1) { out.maxY = next; changed = true; }
			}
		}
		if (!changed) break;
	}
	return out;
}

function clearOfElectrical(box, model, segments, pad = 3) {
	const bb = expand(box, pad);
	if (bb.maxX <= bb.minX || bb.maxY <= bb.minY) return false;
	for (const c of model.components || model.parts || []) {
		const cb = c.bodyBBox || c.bbox;
		if (cb && rectTouchOrOverlap(bb, cb, 0)) return false;
	}
	for (const f of model.netflags || []) {
		const fb = normalizeBox(f.bbox);
		if (fb && rectTouchOrOverlap(bb, fb, 0)) return false;
	}
	return !segments.some(s => segIntersectsRect(s, bb));
}

function clearTitlePlacement(title, model, segments) {
	return clearOfElectrical(title.bbox, model, segments, 14) &&
		clearOfElectrical(markerBoxForTitle(title), model, segments, 8);
}

function clearOfOtherModuleFrames(title, frames) {
	const titleBoxes = [title.bbox, markerBoxForTitle(title)].filter(Boolean);
	return !frames.some(frame => {
		if (frame.module === title.module) return false;
		return titleBoxes.some(box => rectTouchOrOverlap(expand(box, 2), frame.box, 0));
	});
}

function chooseModuleTitle(mod, frame, model, segments, frames = []) {
	const content = MODULE_TITLES[mod.name] || mod.name.toUpperCase();
	const fontSize = 16;
	const estimatedWidth = Math.max(30, content.length * fontSize * 0.56);
	const xs = [
		frame.minX + 14 + estimatedWidth / 2,
		(frame.minX + frame.maxX) / 2,
		frame.maxX - 14 - estimatedWidth / 2,
		mod.box.maxX - 20,
		mod.box.minX + 20,
	];
	const ys = [
		frame.maxY - 14,
		frame.minY + 18,
		mod.box.maxY + 28,
		mod.box.minY - 14,
	];
	for (const y of ys) {
		for (const x of xs) {
			const candidate = docText(content, x, y, { role: 'module-title', module: mod.name, fontSize, bold: true, color: '#444444' });
			const marker = markerBoxForTitle(candidate);
			if (rectContains(frame, marker, -2) &&
				clearTitlePlacement(candidate, model, segments) &&
				clearOfOtherModuleFrames(candidate, frames)) return candidate;
		}
	}
	const searchYs = [
		mod.box.maxY + 72,
		mod.box.minY - 34,
		(mod.box.minY + mod.box.maxY) / 2,
		mod.box.maxY + 96,
		mod.box.minY - 58,
	];
	const searchXs = [
		mod.box.minX + estimatedWidth / 2 + 18,
		(mod.box.minX + mod.box.maxX) / 2,
		mod.box.maxX - estimatedWidth / 2 - 18,
		mod.box.minX - estimatedWidth / 2 - 18,
		mod.box.maxX + estimatedWidth / 2 + 18,
	];
	for (const y of searchYs) {
		for (const x of searchXs) {
			const candidate = docText(content, x, y, { role: 'module-title', module: mod.name, fontSize, bold: true, color: '#444444' });
			if (clearTitlePlacement(candidate, model, segments) &&
				clearOfOtherModuleFrames(candidate, frames)) return candidate;
		}
	}
	return docText(content, (frame.minX + frame.maxX) / 2, frame.maxY - 14, {
		role: 'module-title',
		module: mod.name,
		fontSize,
		bold: true,
		color: '#444444',
	});
}

function docText(content, x, y, opts = {}) {
	const text = {
		kind: 'doc-text',
		role: opts.role || 'note',
		module: opts.module || null,
		content,
		x,
		y,
		rotation: 0,
		textColor: opts.color || '#333333',
		fontName: 'Arial',
		fontSize: opts.fontSize || 14,
		bold: !!opts.bold,
		anchor: opts.anchor || 'center',
		alignMode: opts.alignMode || 2,
	};
	text.bbox = textBBox(text);
	return text;
}

function docRect(role, box, opts = {}) {
	return {
		kind: 'doc-rect',
		role,
		module: opts.module || null,
		minX: round(box.minX),
		minY: round(box.minY),
		maxX: round(box.maxX),
		maxY: round(box.maxY),
		color: opts.color || '#6f6f6f',
		fillColor: opts.fillColor ?? null,
		lineWidth: opts.lineWidth || 1,
		lineType: opts.lineType ?? 0,
		fillStyle: opts.fillStyle ?? 'None',
		bbox: {
			minX: round(box.minX),
			minY: round(box.minY),
			maxX: round(box.maxX),
			maxY: round(box.maxY),
		},
	};
}

function markerBoxForTitle(title) {
	return {
		minX: title.bbox.minX,
		minY: title.bbox.minY - 7,
		maxX: title.bbox.maxX,
		maxY: title.bbox.minY - 3,
	};
}

function compactModuleFrame(mod) {
	const profile = {
		usb: { left: 34, right: 46, bottom: 0, top: 60 },
		ldo: { left: 58, right: 24, bottom: 22, top: 18 },
		btn1: { left: 44, right: 70, bottom: 22, top: 66 },
		btn2: { left: 44, right: 78, bottom: 22, top: 66 },
		mcu: { left: 24, right: 24, bottom: 22, top: 42 },
		pmos: { left: 58, right: 24, bottom: 62, top: 72 },
		relay1: { left: 34, right: 18, bottom: 18, top: 28 },
		relay2: { left: 34, right: 18, bottom: 18, top: 28 },
	}[mod.name] ?? { left: 24, right: 24, bottom: 22, top: 38 };
	return {
		minX: mod.box.minX - profile.left,
		minY: mod.box.minY - profile.bottom,
		maxX: mod.box.maxX + profile.right,
		maxY: mod.box.maxY + profile.top,
	};
}

export function buildDocumentLayer(model) {
	const modules = moduleBoxes(model, 0);
	const segments = wireSegments(model);
	const electricalBoxes = [
		...(model.netflags || []).map(f => ({ kind: 'netflag', ref: f.net || '', box: normalizeBox(f.bbox) })),
		...(model.components || model.parts || []).map(c => ({ kind: 'part', ref: c.designator || '', box: c.bodyBBox || c.bbox })),
	].filter(x => x.box);
	const geom = modelGeometryBox(model) || { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
	const sheet = {
		minX: Math.floor((geom.minX - 90) / 10) * 10,
		minY: Math.floor((geom.minY - 110) / 10) * 10,
		maxX: Math.ceil((geom.maxX + 90) / 10) * 10,
		maxY: Math.ceil((geom.maxY + 130) / 10) * 10,
	};
	const rectangles = [];
	const texts = [];
	const moduleFrames = modules.map(mod => ({ module: mod.name, box: compactModuleFrame(mod) }));
	for (const mod of modules) {
		const frame = moduleFrames.find(f => f.module === mod.name).box;
		if (model.writeModuleFrames !== false) {
			rectangles.push(docRect('module-frame', frame, { module: mod.name, color: '#9a9a9a', lineType: 1 }));
		}
		const title = chooseModuleTitle(mod, frame, model, segments, moduleFrames);
		rectangles.push(docRect('module-title-marker', markerBoxForTitle(title), {
			module: mod.name,
			color: '#333333',
			fillColor: '#eeeeee',
			lineWidth: 1.6,
			fillStyle: 'Solid',
		}));
		texts.push(title);
	}
	return { sheetBBox: sheet, rectangles, texts };
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'document-style', msg, where });
}

export function auditDocumentStyle(model, opts = {}) {
	const findings = [];
	const modules = moduleBoxes(model, 0);
	const geometry = modelGeometryBox(model);
	const segments = wireSegments(model);
	const texts = (model.texts || []).map(t => ({ ...t, bbox: textBBox(t), content: String(t.content || '') }));
	const rectangles = (model.rectangles || []).map(r => ({ ...r, bbox: normalizeBox(r.bbox || r) })).filter(r => r.bbox);
	const titleTexts = texts.filter(t => /AIHWDEBUGER|DETAIL SCHEMATIC|CONTROL & POWER/i.test(t.content));
	const moduleTitleTexts = texts.filter(t => t.role === 'module-title' || Object.values(MODULE_TITLES).some(title => t.content.toUpperCase().includes(title)));
	const explicitSheetBox = normalizeBox(model.sheetBBox) || rectangles.find(r => r.role === 'sheet-frame')?.bbox;
	const inferredSheet = explicitSheetBox || (geometry
		? rectangles
			.filter(r => rectContains(r.bbox, expand(geometry, 35)))
			.sort((a, b) => rectArea(b.bbox) - rectArea(a.bbox))[0]?.bbox
		: rectangles.sort((a, b) => rectArea(b.bbox) - rectArea(a.bbox))[0]?.bbox);
	const sheetBox = inferredSheet;
	const titleBlockTextBoxes = texts
		.filter(t => /P1 DETAIL SCHEMATIC|DRC: 0 ERR/i.test(t.content))
		.map(t => t.bbox);
	const titleBlockRects = rectangles.filter(r =>
		r.role === 'title-block' ||
		titleBlockTextBoxes.some(tb => rectContains(r.bbox, tb, 3)));
	const isTitleBlockRect = r => titleBlockRects.some(tb => sameBox(tb.bbox, r.bbox));
	const isSheetRect = r => r.role === 'sheet-frame' || sameBox(r.bbox, sheetBox);
	const isSmallModuleMarkerRect = r => {
		const b = r.bbox;
		const h = rectHeight(b);
		const w = rectWidth(b);
		if (r.role === 'module-title-marker') return true;
		const dark = ['#222222', '#333333', '#444444', '#555555'].includes(String(r.color || r.fillColor || '').toLowerCase());
		const filled = Boolean(r.fillColor && String(r.fillColor).toLowerCase() !== 'none');
		return h <= 14 && w >= 28 && w <= 240 && (filled || dark || Number(r.lineWidth ?? 0) >= 1.5);
	};
	const inferFrameModule = r => {
		if (r.module) return r.module;
		let best = null;
		for (const mod of modules) {
			const containsBody = rectContains(r.bbox, mod.box, mod.name === 'usb' ? 8 : 4);
			const containsLoose = rectContains(r.bbox, expand(mod.box, -6), 4);
			const overlap = rectOverlapRatio(r.bbox, mod.box);
			const score = (containsBody ? 100 : 0) + (containsLoose ? 40 : 0) + overlap;
			if (containsBody || containsLoose || overlap >= 0.55) {
				if (!best || score > best.score) best = { name: mod.name, score };
			}
		}
		return best?.name || null;
	};
	const frameLikeStyle = r => {
		const b = r.bbox;
		const largeEnough = rectWidth(b) >= 70 && rectHeight(b) >= 55 && rectArea(b) >= 5000;
		const gray = String(r.color || '').toLowerCase() === '#9a9a9a';
		return largeEnough && (r.lineType === 1 || gray || Number(r.lineWidth ?? 1) >= 0.8);
	};
	const isModuleFrameCandidate = r => {
		if (isSheetRect(r) || isTitleBlockRect(r)) return false;
		if (isSmallModuleMarkerRect(r)) return false;
		if (r.role === 'module-frame') return true;
		return frameLikeStyle(r) && Boolean(inferFrameModule(r));
	};
	const moduleFrameRects = rectangles
		.filter(isModuleFrameCandidate)
		.map(r => ({ ...r, role: 'module-frame', module: inferFrameModule(r) || r.module || null }));
	const titleModule = new Map();
	for (const mod of modules) {
		const title = MODULE_TITLES[mod.name] || mod.name.toUpperCase();
		const t = moduleTitleTexts.find(x => x.module === mod.name || x.content.toUpperCase().includes(title));
		if (t) titleModule.set(mod.name, t);
	}
	const isModuleMarkerCandidate = r => {
		if (isSheetRect(r) || isTitleBlockRect(r) || isModuleFrameCandidate(r)) return false;
		if (r.role === 'module-title-marker') return true;
		if (!isSmallModuleMarkerRect(r)) return false;
		return [...titleModule.values()].some(t => rectContains(r.bbox, t.bbox, 3) || markerNearTitle(r, t));
	};
	const inferMarkerModule = r => {
		if (r.module) return r.module;
		for (const [name, title] of titleModule.entries()) {
			if (rectContains(r.bbox, title.bbox, 3) || markerNearTitle(r, title)) return name;
		}
		return null;
	};
	const moduleMarkerRects = rectangles
		.filter(isModuleMarkerCandidate)
		.map(r => ({ ...r, role: 'module-title-marker', module: inferMarkerModule(r) || r.module || null }));
	const electricalBoxes = [
		...(model.netflags || []).map(f => ({ kind: 'netflag', ref: f.net || '', box: normalizeBox(f.bbox) })),
		...(model.components || model.parts || []).map(c => ({ kind: 'part', ref: c.designator || '', box: c.bodyBBox || c.bbox })),
	].filter(x => x.box);
	const documentTexts = texts.filter(t => t.role || /AIHWDEBUGER|SCHEMATIC|USB\/power|DRC:|INPUT|POWER|SUPPORT|MCU|SWITCH|RELAY OUTPUT/i.test(t.content));

	if (sheetBox && geometry && !rectContains(sheetBox, expand(geometry, 35))) {
		hard(findings, 'C20.2-sheet-frame-coverage', 'sheet frame must contain the complete electrical drawing with review margin', {
			sheetBox,
			geometry,
		});
	}
	if (titleBlockRects.length > 0) hard(findings, 'C20.4-title-block-duplicated', 'use EasyEDA native sheet template variables; do not draw a duplicate in-canvas title block');

	for (const t of texts) {
		const reason = forbiddenDocumentTextReason(t.content);
		if (reason) hard(findings, 'C20.15-document-text-process-leak', 'schematic body text must contain engineering handoff content, not API, permission, backup, or script process notes', {
			text: t.content,
			pattern: reason,
		});
		const proseReason = explanatoryTextReason(t, opts);
		if (proseReason) hard(findings, 'C20.16-document-text-prose-block', 'schematic body text must stay short and scan-readable; do not use large explanatory prose instead of module relationships', {
			text: t.content,
			reason: proseReason,
			maxChars: opts.maxDocumentTextChars ?? 72,
			maxWords: opts.maxDocumentTextWords ?? 10,
		});
	}

	for (const mod of modules) {
		const title = MODULE_TITLES[mod.name] || mod.name.toUpperCase();
		const hasTitle = moduleTitleTexts.some(t => t.module === mod.name || t.content.toUpperCase().includes(title));
		if (!hasTitle) hard(findings, 'C20.5-module-title-missing', `${mod.name} module needs a visible functional title`, { module: mod.name, expected: title });
		const titleText = titleModule.get(mod.name);
		if (titleText) {
			const titleHeight = titleText.bbox.maxY - titleText.bbox.minY;
			if (titleHeight < (opts.minModuleTitleHeight ?? 14)) hard(findings, 'C20.12-module-title-too-small', `${mod.name} module title is too small for reference-PDF readability`, {
				module: mod.name,
				height: titleHeight,
				min: opts.minModuleTitleHeight ?? 14,
			});
		}
		if (opts.requireModuleFrames !== false) {
			const frame = moduleFrameRects.find(r => r.module === mod.name && rectContains(r.bbox, expand(mod.box, opts.frameContainMargin ?? 4), mod.name === 'usb' ? 8 : 2)) ||
				moduleFrameRects.find(r => !r.module && rectContains(r.bbox, expand(mod.box, opts.frameContainMargin ?? 4), 2));
			const marker = titleText && (moduleMarkerRects.find(r => r.module === mod.name && (rectContains(r.bbox, titleText.bbox, 3) || markerNearTitle(r, titleText))) ||
				moduleMarkerRects.find(r => !r.module && (rectContains(r.bbox, titleText.bbox, 3) || markerNearTitle(r, titleText))));
			if (!frame) hard(findings, 'C20.6-module-frame-missing', `${mod.name} module needs a real local reference-style boundary frame`, {
				module: mod.name,
				moduleBox: mod.box,
			});
			if (!marker) hard(findings, 'C20.14-module-title-marker-missing', `${mod.name} module title needs a visible title marker separate from the boundary frame`, {
				module: mod.name,
				moduleBox: mod.box,
			});
			if (marker) {
				const filledMarker = Boolean(marker.fillColor && marker.fillColor !== 'none');
				if (!filledMarker && Number(marker.lineWidth ?? 0) < (opts.minModuleMarkerLineWidth ?? 1.5)) hard(findings, 'C20.13-module-marker-too-light', `${mod.name} module marker line is too light for review readability`, {
					module: mod.name,
					lineWidth: marker.lineWidth ?? 0,
					min: opts.minModuleMarkerLineWidth ?? 1.5,
				});
			}
		}
	}

	const frames = moduleFrameRects.map(r => r.bbox);
	for (let i = 0; i < frames.length; i++) {
		for (let j = i + 1; j < frames.length; j++) {
			const gap = rectsGap(frames[i], frames[j]);
			if (gap < (opts.minFrameGap ?? 6)) hard(findings, 'C20.7-module-frame-collision', 'module document frames must not collide or create interlocking visual regions', {
				a: moduleFrameRects[i].module,
				b: moduleFrameRects[j].module,
				gap,
			});
		}
	}

	for (const t of documentTexts) {
		const bb = shrinkRect(t.bbox, 1);
		if (bb.maxX <= bb.minX || bb.maxY <= bb.minY) continue;
		for (const c of model.components || model.parts || []) {
			const cb = c.bodyBBox || c.bbox;
			if (cb && rectOverlap(bb, cb)) hard(findings, 'C20.8-document-text-over-part', 'document text must not overlap component bodies', {
				text: t.content,
				part: c.designator,
			});
		}
		for (const s of segments) {
			if (segIntersectsRect(s, bb)) hard(findings, 'C20.9-document-text-over-wire', 'document text must not overlap electrical wires', {
				text: t.content,
				seg: [s.x1, s.y1, s.x2, s.y2],
				net: s.net || '',
			});
		}
	}

	for (const r of moduleFrameRects) {
		const hits = frameWireViolations(r.bbox, segments, 0.75);
		if (hits.length) hard(findings, 'C20.10-module-frame-over-wire', 'module document frame border must not touch or cross electrical wires', {
			module: r.module || null,
			hits: hits.slice(0, 8).map(h => ({
				edge: h.edge.side,
				seg: [h.segment.x1, h.segment.y1, h.segment.x2, h.segment.y2],
				net: h.segment.net || '',
			})),
			count: hits.length,
		});
		const boxHits = frameBoxHits(r.bbox, electricalBoxes, 0.75, {
			allowBoundaryTouch: true,
			boundarySlack: 8,
			allowedRefs: ['RESET_EN', 'EXT_PWR_EN', 'RELAY1_EN', 'RELAY2_EN'],
		});
		if (boxHits.length) hard(findings, 'C20.11-module-frame-over-symbol', 'module document frame border must not touch component or netflag geometry', {
			module: r.module || null,
			hits: boxHits.slice(0, 8).map(h => ({
				edge: h.edge.side,
				kind: h.item.kind,
				ref: h.item.ref,
				box: h.item.box,
			})),
			count: boxHits.length,
		});
	}

	for (const r of moduleMarkerRects) {
		const hits = frameWireHits(r.bbox, segments, 0.75);
		if (hits.length) hard(findings, 'C20.10-module-frame-over-wire', 'module document frame border must not touch or cross electrical wires', {
			module: r.module || null,
			hits: hits.slice(0, 8).map(h => ({
				edge: h.edge.side,
				seg: [h.segment.x1, h.segment.y1, h.segment.x2, h.segment.y2],
				net: h.segment.net || '',
			})),
			count: hits.length,
		});
		const boxHits = frameBoxHits(r.bbox, electricalBoxes, 0.75);
		if (boxHits.length) hard(findings, 'C20.11-module-frame-over-symbol', 'module document frame border must not touch component or netflag geometry', {
			module: r.module || null,
			hits: boxHits.slice(0, 8).map(h => ({
				edge: h.edge.side,
				kind: h.item.kind,
				ref: h.item.ref,
				box: h.item.box,
			})),
			count: boxHits.length,
		});
	}

	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: {
			texts: texts.length,
			rectangles: rectangles.length,
			documentTexts: documentTexts.length,
			moduleTitles: moduleTitleTexts.length,
			moduleFrames: moduleFrameRects.length,
			moduleMarkers: moduleMarkerRects.length,
			modules: modules.length,
		},
		findings,
	};
}

export { MODULE_TITLES };
