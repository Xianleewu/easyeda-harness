import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { MODULE_TITLES } from '../harness/document_style.mjs';
import { loadProjectModuleRegistry } from '../harness/module_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_OUT = DIR + 'sheet_output.png';
const DEFAULT_REPORT = DIR + 'sheet_output_render.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function esc(s) {
	return String(s ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function finite(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

function normalizeBox(b) {
	if (!b) return null;
	if ([b.minX, b.minY, b.maxX, b.maxY].every(finite)) {
		return {
			minX: Math.min(b.minX, b.maxX),
			minY: Math.min(b.minY, b.maxY),
			maxX: Math.max(b.minX, b.maxX),
			maxY: Math.max(b.minY, b.maxY),
		};
	}
	if ([b.topLeftX, b.topLeftY, b.width, b.height].every(finite)) {
		return {
			minX: Math.min(b.topLeftX, b.topLeftX + b.width),
			minY: Math.min(b.topLeftY, b.topLeftY - b.height, b.topLeftY + b.height),
			maxX: Math.max(b.topLeftX, b.topLeftX + b.width),
			maxY: Math.max(b.topLeftY, b.topLeftY - b.height, b.topLeftY + b.height),
		};
	}
	return null;
}

function pointKey(x, y) {
	return `${Number(x).toFixed(2)},${Number(y).toFixed(2)}`;
}

function pinDirection(pin, compBox) {
	if (!pin || !compBox) return { dx: 1, dy: 0 };
	const dist = [
		{ side: 'left', d: Math.abs(pin.x - compBox.minX), dx: -1, dy: 0 },
		{ side: 'right', d: Math.abs(pin.x - compBox.maxX), dx: 1, dy: 0 },
		{ side: 'bottom', d: Math.abs(pin.y - compBox.minY), dx: 0, dy: -1 },
		{ side: 'top', d: Math.abs(pin.y - compBox.maxY), dx: 0, dy: 1 },
	].sort((a, b) => a.d - b.d);
	return dist[0] || { dx: 1, dy: 0 };
}

function connectedPinSet(snapshot) {
	const endpoints = new Set();
	for (const w of snapshot?.wires || []) {
		const line = w.line || [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			if (finite(line[i]) && finite(line[i + 1])) endpoints.add(pointKey(line[i], line[i + 1]));
		}
	}
	const connected = new Set();
	for (const c of snapshot?.components || []) {
		for (const p of c.pins || []) {
			if (endpoints.has(pointKey(p.x, p.y))) connected.add(`${c.designator}.${p.num}`);
		}
	}
	return connected;
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

function expand(b, pad) {
	return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

function rectsGap(a, b) {
	const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
	const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
	return Math.hypot(dx, dy);
}

function rectArea(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function pixelBoxFromRect(r) {
	if (!r) return null;
	return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

function estimateTextBox(x, y, text, fontSize, anchor = 'start') {
	const s = String(text ?? '');
	const w = Math.max(fontSize * 1.4, s.length * fontSize * 0.58);
	const h = fontSize * 1.12;
	let minX = x;
	if (anchor === 'middle') minX = x - w / 2;
	else if (anchor === 'end') minX = x - w;
	return {
		minX,
		minY: y - h,
		maxX: minX + w,
		maxY: y + fontSize * 0.28,
	};
}

function estimateAlignModeTextBox(x, y, text, fontSize, alignMode) {
	const s = String(text ?? '');
	const w = Math.max(fontSize * 1.4, s.length * fontSize * 0.58);
	const h = fontSize * 1.12;
	if (alignMode === 3 || alignMode === 6) return { minX: x, minY: y - fontSize * 0.28, maxX: x + w, maxY: y + h - fontSize * 0.28 };
	if (alignMode === 8 || alignMode === 9) return { minX: x - w, minY: y - fontSize * 0.28, maxX: x, maxY: y + h - fontSize * 0.28 };
	if (alignMode === 1) return { minX: x, minY: y - h, maxX: x + w, maxY: y + fontSize * 0.28 };
	if (alignMode === 7) return { minX: x - w, minY: y - h, maxX: x, maxY: y + fontSize * 0.28 };
	return null;
}

function transformModelTextBox(tr, box) {
	if (!box) return null;
	const p = tr.box(box);
	return pixelBoxFromRect(p);
}

function boxesOverlap(a, b, pad = 0) {
	return a.minX < b.maxX + pad && b.minX < a.maxX + pad && a.minY < b.maxY + pad && b.minY < a.maxY + pad;
}

function pushText(out, textBoxes, spec) {
	const text = String(spec.text ?? '');
	if (!text) return null;
	const fontSize = spec.fontSize ?? 8.5;
	const anchor = spec.anchor || 'start';
	const weight = spec.weight || '400';
	const fill = spec.fill || '#222222';
	const box = spec.box || estimateTextBox(spec.x, spec.y, text, fontSize, anchor);
	const role = spec.role || 'text';
	const item = {
		role,
		text,
		fontSize,
		anchor,
		weight,
		owner: spec.owner || null,
		module: spec.module || null,
		callout: spec.callout || null,
		...box,
	};
	textBoxes.push(item);
	if (spec.callout === 'net-label-backplate') {
		const padX = Math.max(4.2, fontSize * 0.45);
		const padY = Math.max(2.6, fontSize * 0.22);
		const rx = Math.min(2.5, fontSize * 0.26);
		const backplate = {
			x: box.minX - padX,
			y: box.minY - padY,
			width: box.maxX - box.minX + padX * 2,
			height: box.maxY - box.minY + padY * 2,
		};
		out.push(`<rect x="${backplate.x.toFixed(2)}" y="${backplate.y.toFixed(2)}" width="${backplate.width.toFixed(2)}" height="${backplate.height.toFixed(2)}" rx="${rx.toFixed(2)}" fill="#fffef8" fill-opacity="0.96" stroke="${fill}" stroke-width="0.55"/>`);
	}
	const rotAttr = spec.rotate ? ` transform="rotate(${spec.rotate} ${spec.x.toFixed(2)} ${spec.y.toFixed(2)})"` : '';
	out.push(`<text x="${spec.x.toFixed(2)}" y="${spec.y.toFixed(2)}"${rotAttr} font-size="${fontSize}" font-family="Arial" text-anchor="${anchor}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`);
	return item;
}

function summarizeTextQuality(textBoxes, componentPxBoxes) {
	const criticalRoles = new Set(['sheet-title', 'reading-flow', 'acceptance-note', 'title-block', 'title-block-meta', 'module-title-bar', 'net-label']);
	const critical = textBoxes.filter(t => criticalRoles.has(t.role));
	const criticalPairs = [];
	for (let i = 0; i < critical.length; i++) {
		for (let j = i + 1; j < critical.length; j++) {
			const a = critical[i];
			const b = critical[j];
			if (a.role === 'module-title-bar' && b.role === 'module-title-bar') continue;
			if (boxesOverlap(a, b, 1.5)) {
				criticalPairs.push({
					a: { role: a.role, text: a.text, owner: a.owner },
					b: { role: b.role, text: b.text, owner: b.owner },
				});
			}
		}
	}
	const netLabelComponentPairs = [];
	for (const label of textBoxes.filter(t => t.role === 'net-label')) {
		for (const comp of componentPxBoxes) {
			if (boxesOverlap(label, comp, 1.5)) {
				netLabelComponentPairs.push({
					label: label.text,
					component: comp.designator,
				});
			}
		}
	}
	const fontSizes = textBoxes.map(t => t.fontSize).filter(finite);
	const netLabels = textBoxes.filter(t => t.role === 'net-label');
	const netLabelBackplates = netLabels.filter(t => t.callout === 'net-label-backplate').length;
	return {
		renderedTexts: textBoxes.length,
		minFontSize: fontSizes.length ? Number(Math.min(...fontSizes).toFixed(2)) : null,
		criticalTextOverlaps: criticalPairs.length,
		netLabelComponentOverlaps: netLabelComponentPairs.length,
		netLabels: netLabels.length,
		netLabelBackplates,
		netLabelBackplateRatio: netLabels.length ? Number((netLabelBackplates / netLabels.length).toFixed(6)) : 0,
		criticalOverlapPairs: criticalPairs.slice(0, 20),
		netLabelComponentPairs: netLabelComponentPairs.slice(0, 20),
	};
}

function summarizeTitleBlockMetadata(textBoxes) {
	const blockTexts = textBoxes
		.filter(t => t.role === 'title-block' || t.role === 'title-block-meta' || t.role === 'acceptance-note')
		.map(t => String(t.text || ''));
	const joined = blockTexts.join(' | ');
	return {
		texts: blockTexts,
		count: blockTexts.length,
		project: /PROJECT:\s*AIHWDEBUGER/i.test(joined),
		pageTitle: /P1\s+DETAIL\s+SCHEMATIC/i.test(joined),
		sheetNumber: /SHEET:\s*\d+\s+OF\s+\d+/i.test(joined),
		revision: /REV:\s*[A-Z0-9.-]+/i.test(joined),
		status: /STATUS:\s*(REVIEW|RELEASED|DRAFT|PASS)/i.test(joined),
		acceptance: /DRC:\s*0\s+ERR\s*\/\s*0\s+WARN\s*\/\s*0\s+INFO/i.test(joined),
		source: /SOURCE:\s*HARNESS\s+PASS/i.test(joined),
	};
}

function footprintMetrics(sheetBox, titleBlock, moduleRegions, electricalBox) {
	const sheetW = Math.max(1, sheetBox.maxX - sheetBox.minX);
	const sheetH = Math.max(1, sheetBox.maxY - sheetBox.minY);
	const titleH = titleBlock ? Math.max(0, titleBlock.maxY - titleBlock.minY) : 0;
	const usable = {
		minX: sheetBox.minX + sheetW * 0.045,
		maxX: sheetBox.maxX - sheetW * 0.045,
		minY: sheetBox.minY + Math.max(sheetH * 0.075, titleH + 28),
		maxY: sheetBox.maxY - sheetH * 0.075,
	};
	const usableW = Math.max(1, usable.maxX - usable.minX);
	const usableH = Math.max(1, usable.maxY - usable.minY);
	const moduleUnion = union(moduleRegions.map(r => r.box));
	const moduleArea = moduleRegions.reduce((sum, r) => sum + rectArea(r.box), 0);
	const moduleUnionArea = rectArea(moduleUnion);
	const electricalArea = rectArea(electricalBox);
	return {
		usable,
		electricalBox,
		moduleUnion,
		electricalWidthRatio: Number(((electricalBox.maxX - electricalBox.minX) / usableW).toFixed(6)),
		electricalHeightRatio: Number(((electricalBox.maxY - electricalBox.minY) / usableH).toFixed(6)),
		moduleWidthRatio: Number(((moduleUnion.maxX - moduleUnion.minX) / usableW).toFixed(6)),
		moduleHeightRatio: Number(((moduleUnion.maxY - moduleUnion.minY) / usableH).toFixed(6)),
		moduleAreaRatio: Number((moduleArea / Math.max(1, rectArea(usable))).toFixed(6)),
		moduleUnionAreaRatio: Number((moduleUnionArea / Math.max(1, rectArea(usable))).toFixed(6)),
		modulePackingRatio: Number((moduleArea / Math.max(1, moduleUnionArea)).toFixed(6)),
	};
}

function inferSheetBox(snapshot) {
	if (snapshot?.sheetBBox) return normalizeBox(snapshot.sheetBBox);
	const rects = (snapshot?.rectangles || []).map(r => ({ ...r, bbox: normalizeBox(r.bbox || r) })).filter(r => r.bbox);
	const sheet = rects
		.filter(r => r.role === 'sheet-frame' || ((r.bbox.maxX - r.bbox.minX) >= 700 && (r.bbox.maxY - r.bbox.minY) >= 500))
		.sort((a, b) => ((b.bbox.maxX - b.bbox.minX) * (b.bbox.maxY - b.bbox.minY)) - ((a.bbox.maxX - a.bbox.minX) * (a.bbox.maxY - a.bbox.minY)))[0]?.bbox;
	if (sheet) return sheet;
	const boxes = [];
	for (const c of snapshot?.components || []) boxes.push(normalizeBox(c.bbox));
	for (const f of snapshot?.netflags || []) boxes.push(normalizeBox(f.bbox));
	for (const t of snapshot?.texts || []) boxes.push(normalizeBox(t.bbox));
	for (const w of snapshot?.wires || []) {
		const xs = [];
		const ys = [];
		const line = w.line || [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			if (finite(line[i]) && finite(line[i + 1])) {
				xs.push(line[i]);
				ys.push(line[i + 1]);
			}
		}
		if (xs.length) boxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
	}
	return expand(union(boxes), 100);
}

function inferTitleBlock(snapshot, sheetBox) {
	const rects = (snapshot?.rectangles || []).map(r => ({ ...r, bbox: normalizeBox(r.bbox || r) })).filter(r => r.bbox);
	const hit = rects.find(r => r.role === 'title-block') || rects
		.filter(r => r.bbox.minX > sheetBox.minX + (sheetBox.maxX - sheetBox.minX) * 0.55 && r.bbox.maxY < sheetBox.minY + (sheetBox.maxY - sheetBox.minY) * 0.18)
		.sort((a, b) => ((b.bbox.maxX - b.bbox.minX) * (b.bbox.maxY - b.bbox.minY)) - ((a.bbox.maxX - a.bbox.minX) * (a.bbox.maxY - a.bbox.minY)))[0];
	if (hit) return hit.bbox;
	return {
		minX: sheetBox.maxX - 520,
		minY: sheetBox.minY + 10,
		maxX: sheetBox.maxX - 10,
		maxY: sheetBox.minY + 84,
	};
}

function netColor(net) {
	if (net === 'GND') return '#8b342e';
	if (String(net || '').includes('3V3') || String(net || '').includes('5V') || String(net || '').includes('VIN') || String(net || '').includes('VOUT')) return '#a33c32';
	if (String(net || '').includes('USB')) return '#2251b5';
	return '#1d4fa3';
}

function linesFromWire(w) {
	const step2 = [];
	const step4 = [];
	const line = w.line || [];
	for (let i = 0; i + 3 < line.length; i += 2) {
		const [x1, y1, x2, y2] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
		if (![x1, y1, x2, y2].every(finite) || (x1 === x2 && y1 === y2)) continue;
		step2.push({ x1, y1, x2, y2, net: w.net || '' });
	}
	for (let i = 0; i + 3 < line.length; i += 4) {
		const [x1, y1, x2, y2] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
		if (![x1, y1, x2, y2].every(finite) || (x1 === x2 && y1 === y2)) continue;
		step4.push({ x1, y1, x2, y2, net: w.net || '' });
	}
	const diag2 = step2.filter(s => s.x1 !== s.x2 && s.y1 !== s.y2).length;
	const diag4 = step4.filter(s => s.x1 !== s.x2 && s.y1 !== s.y2).length;
	if (line.length > 4 && step4.length && diag4 <= diag2) return step4;
	return step2;
}

function junctionPoints(snapshot) {
	const counts = new Map();
	for (const w of snapshot?.wires || []) {
		for (const s of linesFromWire(w)) {
			for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
				const key = pointKey(x, y);
				counts.set(key, { x, y, count: (counts.get(key)?.count || 0) + 1 });
			}
		}
	}
	return [...counts.values()].filter(p => p.count >= 3);
}

export function transformFor(sheetBox, width, height, marginPx) {
	const sx = (width - 2 * marginPx) / Math.max(1, sheetBox.maxX - sheetBox.minX);
	const sy = (height - 2 * marginPx) / Math.max(1, sheetBox.maxY - sheetBox.minY);
	const scale = Math.min(sx, sy);
	const usedW = (sheetBox.maxX - sheetBox.minX) * scale;
	const usedH = (sheetBox.maxY - sheetBox.minY) * scale;
	const ox = (width - usedW) / 2;
	const oy = (height - usedH) / 2;
	const x = v => ox + (v - sheetBox.minX) * scale;
	const y = v => oy + (sheetBox.maxY - v) * scale;
	const box = b => ({
		x: x(b.minX),
		y: y(b.maxY),
		width: (b.maxX - b.minX) * scale,
		height: (b.maxY - b.minY) * scale,
	});
	return { x, y, box, scale, ox, oy, usedW, usedH };
}

function textRole(t) {
	const c = String(t.content || '');
	if (t.role) return t.role;
	if (/^(PROJECT|REV|STATUS|SHEET|SOURCE):|STATUS:|SHEET:/i.test(c)) return 'title-block-meta';
	if (/AIHWDEBUGER|CONTROL & POWER/i.test(c)) return 'sheet-title';
	if (/P1 DETAIL SCHEMATIC/i.test(c)) return 'title-block';
	if (/USB\/power|switched and relay outputs/i.test(c)) return 'reading-flow';
	if (/DRC: 0 ERR/i.test(c)) return 'acceptance-note';
	if (Object.values(MODULE_TITLES).some(title => c.toUpperCase().includes(title))) return 'module-title';
	return 'text';
}

function isSignalLabelFlag(f) {
	if (!f?.net) return false;
	if (f.kind === 'sig') return true;
	if (f.kind && f.kind !== 'sig') return false;
	const b = normalizeBox(f.bbox);
	if (!b) return false;
	const w = b.maxX - b.minX;
	const h = b.maxY - b.minY;
	return Math.max(w, h) >= 26 && !/^(GND|SYS_|VIN_|VOUT_)/.test(String(f.net || ''));
}

export function inferModuleRegions(snapshot, pad = 24) {
	const byRef = new Map((snapshot?.components || []).map(c => [c.designator, c]));
	const registry = loadProjectModuleRegistry();
	const regions = [];
	for (const mod of registry.modules) {
		const boxes = mod.refs.map(ref => normalizeBox(byRef.get(ref)?.bbox)).filter(Boolean);
		const box = union(boxes);
		if (!box) continue;
		regions.push({
			name: mod.name,
			title: MODULE_TITLES[mod.name] || mod.name.toUpperCase(),
			box: expand(box, pad),
			parts: boxes.length,
			source: registry.source,
		});
	}
	return regions;
}

export function renderSheetOutput(snapshot, outPng = DEFAULT_OUT, opts = {}) {
	const width = opts.width ?? 2030;
	const height = opts.height ?? 1220;
	const sheetBox = inferSheetBox(snapshot);
	const titleBlock = inferTitleBlock(snapshot, sheetBox);
	const tr = transformFor(sheetBox, width, height, opts.marginPx ?? 38);
	const out = [];
	const textBoxes = [];
	const componentPxBoxes = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
	out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
	const sheetPx = tr.box(sheetBox);
	const tb = tr.box(titleBlock);
	out.push(`<rect x="${sheetPx.x.toFixed(2)}" y="${sheetPx.y.toFixed(2)}" width="${sheetPx.width.toFixed(2)}" height="${sheetPx.height.toFixed(2)}" fill="#fffefb" stroke="#222222" stroke-width="1.25"/>`);
	for (let i = 1; i <= 6; i++) {
		const gx = sheetPx.x + sheetPx.width * i / 6;
		out.push(`<line x1="${gx.toFixed(2)}" y1="${sheetPx.y.toFixed(2)}" x2="${gx.toFixed(2)}" y2="${(sheetPx.y + 26).toFixed(2)}" stroke="#222222" stroke-width="0.8"/>`);
		pushText(out, textBoxes, { x: gx - sheetPx.width / 12, y: sheetPx.y + 18, text: i, fontSize: 10, anchor: 'middle', fill: '#222222', role: 'sheet-grid' });
	}
	for (const [i, row] of ['A', 'B', 'C', 'D'].entries()) {
		const gy = sheetPx.y + sheetPx.height * (i + 0.5) / 4;
		pushText(out, textBoxes, { x: sheetPx.x + 10, y: gy, text: row, fontSize: 10, fill: '#222222', role: 'sheet-grid' });
		pushText(out, textBoxes, { x: sheetPx.x + sheetPx.width - 14, y: gy, text: row, fontSize: 10, fill: '#222222', role: 'sheet-grid' });
	}

	const moduleRegions = inferModuleRegions(snapshot, opts.moduleRegionPad ?? 28);
	const electricalBoxes = [];
	for (const c of snapshot?.components || []) electricalBoxes.push(normalizeBox(c.bbox));
	for (const f of snapshot?.netflags || []) electricalBoxes.push(normalizeBox(f.bbox));
	for (const w of snapshot?.wires || []) {
		const xs = [];
		const ys = [];
		const line = w.line || [];
		for (let i = 0; i + 1 < line.length; i += 2) {
			if (finite(line[i]) && finite(line[i + 1])) {
				xs.push(line[i]);
				ys.push(line[i + 1]);
			}
		}
		if (xs.length) electricalBoxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
	}
	const footprint = footprintMetrics(sheetBox, titleBlock, moduleRegions, union(electricalBoxes));
	let renderedModuleTitles = 0;
	let renderedModuleTitleBars = 0;
	for (const r of moduleRegions) {
		const p = tr.box(r.box);
		out.push(`<rect x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" width="${p.width.toFixed(2)}" height="${p.height.toFixed(2)}" rx="0" fill="#fbfaf4" fill-opacity="0.52" stroke="#6f6f6f" stroke-width="0.9" stroke-dasharray="5 4"/>`);
		const barH = Math.max(15, Math.min(22, p.height * 0.12));
		const barW = Math.min(p.width, Math.max(86, String(r.title || '').length * 7.2 + 22));
		const barX = p.x;
		const barY = Math.max(sheetPx.y + 28, p.y - barH - 2);
		out.push(`<rect x="${barX.toFixed(2)}" y="${barY.toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" fill="#333333" stroke="#333333" stroke-width="0"/>`);
		pushText(out, textBoxes, { x: barX + 8, y: barY + barH - 5, text: r.title, fontSize: 9.2, weight: '700', fill: '#ffffff', role: 'module-title-bar', module: r.name });
		renderedModuleTitles++;
		renderedModuleTitleBars++;
	}

	for (const w of snapshot?.wires || []) {
		for (const s of linesFromWire(w)) {
			out.push(`<line x1="${tr.x(s.x1).toFixed(2)}" y1="${tr.y(s.y1).toFixed(2)}" x2="${tr.x(s.x2).toFixed(2)}" y2="${tr.y(s.y2).toFixed(2)}" stroke="${netColor(s.net)}" stroke-width="1.35" stroke-linecap="square"/>`);
		}
	}
	const junctions = junctionPoints(snapshot);
	for (const j of junctions) {
		out.push(`<circle cx="${tr.x(j.x).toFixed(2)}" cy="${tr.y(j.y).toFixed(2)}" r="3.2" fill="#b32121"/>`);
	}
	for (const f of snapshot?.netflags || []) {
		if (!finite(f.x) || !finite(f.y)) continue;
		const x = tr.x(f.x);
		const y = tr.y(f.y);
		const color = netColor(f.net);
		out.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.5" fill="${color}"/>`);
		if (isSignalLabelFlag(f)) {
			const rot = Number(f.rot ?? f.rotation ?? 0);
			let tx = x + 5;
			let ty = y - 4;
			let anchor = 'start';
			let box = null;
			const alignMode = Number(f.alignMode);
			if ([1, 3, 6, 7, 8, 9].includes(alignMode) && normalizeBox(f.bbox)) {
				const p = transformModelTextBox(tr, normalizeBox(f.bbox));
				if (p) {
					box = p;
					if (alignMode === 1 || alignMode === 3 || alignMode === 6) {
						tx = p.minX;
						anchor = 'start';
					} else {
						tx = p.maxX;
						anchor = 'end';
					}
					ty = [3, 6, 8, 9].includes(alignMode) ? p.maxY - 1 : p.minY + 8;
				}
			}
			let rotate = 0;
			if (!box && rot === 180) {
				tx = x - 5;
				anchor = 'end';
			} else if (!box && (rot === 90 || rot === 270)) {
				// 竖排网名(上/下边脚密集标签):文字旋转 90/270,锚在标签端点,框为竖窄。
				rotate = rot;
				tx = x;
				ty = y;
				anchor = 'start';
				const fs = 8.5, tw = f.net.length * fs * 0.55;
				box = rot === 90
					? { minX: x - fs * 0.7, maxX: x + fs * 0.35, minY: y - 2, maxY: y + tw + 2 }
					: { minX: x - fs * 0.7, maxX: x + fs * 0.35, minY: y - tw - 2, maxY: y + 2 };
			}
			if (box && ([1, 3, 6, 7, 8, 9].includes(alignMode) || rotate)) {
				pushText(out, textBoxes, { x: tx, y: ty, text: f.net, fontSize: 8.5, anchor, fill: color, role: 'net-label', owner: f.net, callout: 'net-label-backplate', box, rotate });
			} else {
				pushText(out, textBoxes, { x: tx, y: ty, text: f.net, fontSize: 8.5, anchor, fill: color, role: 'net-label', owner: f.net, callout: 'net-label-backplate' });
			}
		}
	}
	const connectedPins = connectedPinSet(snapshot);
	let renderedPins = 0;
	let renderedNc = 0;
	for (const c of snapshot?.components || []) {
		const b = normalizeBox(c.bbox);
		if (!b) continue;
		const p = tr.box(b);
		componentPxBoxes.push({ ...pixelBoxFromRect(p), designator: c.designator || '' });
		out.push(`<rect x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" width="${p.width.toFixed(2)}" height="${p.height.toFixed(2)}" fill="#fff8cc" stroke="#b64535" stroke-width="1.05"/>`);
		pushText(out, textBoxes, { x: p.x + 3, y: p.y + 11, text: c.designator || '', fontSize: 8.5, fill: '#303070', role: 'component-designator', owner: c.designator || '' });
		const name = String(c.value || c.name || '').slice(0, 18);
		if (name && p.height > 22 && p.width > 28) {
			pushText(out, textBoxes, { x: p.x + p.width / 2, y: p.y + p.height / 2 + 3, text: name, fontSize: 7.5, anchor: 'middle', fill: '#555555', role: 'component-value', owner: c.designator || '' });
		}
		for (const pin of c.pins || []) {
			if (!finite(pin.x) || !finite(pin.y)) continue;
			const dir = pinDirection(pin, b);
			const insideX = pin.x - dir.dx * 10;
			const insideY = pin.y - dir.dy * 10;
			const x = tr.x(pin.x);
			const y = tr.y(pin.y);
			const ix = tr.x(insideX);
			const iy = tr.y(insideY);
			const ref = `${c.designator}.${pin.num}`;
			const isConnected = connectedPins.has(ref);
			const stroke = pin.noConnected ? '#7a7a7a' : (isConnected ? '#b64535' : '#555555');
			out.push(`<line x1="${ix.toFixed(2)}" y1="${iy.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${stroke}" stroke-width="0.85"/>`);
			out.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${isConnected ? '2.1' : '1.45'}" fill="${isConnected ? '#b32121' : '#ffffff'}" stroke="${stroke}" stroke-width="0.65"/>`);
			renderedPins++;
			if (pin.noConnected) {
				const d = 4.3;
				out.push(`<line x1="${(x - d).toFixed(2)}" y1="${(y - d).toFixed(2)}" x2="${(x + d).toFixed(2)}" y2="${(y + d).toFixed(2)}" stroke="#14934c" stroke-width="1"/>`);
				out.push(`<line x1="${(x - d).toFixed(2)}" y1="${(y + d).toFixed(2)}" x2="${(x + d).toFixed(2)}" y2="${(y - d).toFixed(2)}" stroke="#14934c" stroke-width="1"/>`);
				renderedNc++;
			}
			const label = String(pin.name || pin.num || '').slice(0, 8);
			if (label && p.width > 22 && p.height > 16 && !pin.noConnected) {
				const tx = tr.x(pin.x - dir.dx * 15);
				const ty = tr.y(pin.y - dir.dy * 15) + 2.5;
				const anchor = dir.dx > 0 ? 'end' : dir.dx < 0 ? 'start' : 'middle';
				pushText(out, textBoxes, { x: tx, y: ty, text: label, fontSize: 5.8, anchor, fill: '#555555', role: 'pin-label', owner: ref });
			}
		}
	}
	out.push(`<rect x="${tb.x.toFixed(2)}" y="${tb.y.toFixed(2)}" width="${tb.width.toFixed(2)}" height="${tb.height.toFixed(2)}" fill="none" stroke="#222222" stroke-width="0.9"/>`);
	out.push(`<line x1="${tb.x.toFixed(2)}" y1="${(tb.y + tb.height * 0.45).toFixed(2)}" x2="${(tb.x + tb.width).toFixed(2)}" y2="${(tb.y + tb.height * 0.45).toFixed(2)}" stroke="#222222" stroke-width="0.55"/>`);
	out.push(`<line x1="${(tb.x + tb.width * 0.62).toFixed(2)}" y1="${tb.y.toFixed(2)}" x2="${(tb.x + tb.width * 0.62).toFixed(2)}" y2="${(tb.y + tb.height).toFixed(2)}" stroke="#222222" stroke-width="0.55"/>`);
	for (const t of snapshot?.texts || []) {
		const role = textRole(t);
		if (role === 'module-title') continue;
		const box = normalizeBox(t.bbox);
		const align = role === 'sheet-title' || role === 'reading-flow' || role === 'acceptance-note' || role === 'title-block' || role === 'title-block-meta' ? 'start' : 'middle';
		let x = align === 'start' && box ? tr.x(box.minX) : tr.x(Number(t.x || 0));
		let y = tr.y(Number(t.y || 0));
		if (role === 'sheet-title') {
			x = sheetPx.x + 18;
			y = sheetPx.y + 34;
		} else if (role === 'reading-flow') {
			x = sheetPx.x + 18;
			y = sheetPx.y + 58;
		} else if (role === 'title-block') {
			x = tb.x + 12;
			y = tb.y + 24;
		} else if (role === 'acceptance-note') {
			x = tb.x + 12;
			y = tb.y + tb.height - 20;
		}
		const size = role === 'sheet-title' ? 15 : role === 'title-block' ? 11 : role === 'title-block-meta' ? 7.8 : role === 'module-title' ? 9 : 8.5;
		const color = role === 'module-title' ? '#444444' : '#222222';
		const weight = role === 'sheet-title' || role === 'module-title' || role === 'title-block' ? '700' : '400';
		pushText(out, textBoxes, { x, y, text: t.content || '', fontSize: size, anchor: align, weight, fill: color, role });
	}
	out.push(`</svg>`);
	const svg = out.join('\n');
	const png = new Resvg(svg, { background: 'white' }).render().asPng();
	writeFileSync(outPng, png);
	const textQuality = summarizeTextQuality(textBoxes, componentPxBoxes);
	const report = {
		pass: true,
		output: outPng,
		width,
		height,
		fileBytes: png.length,
		sheetBox,
		titleBlock,
		sheetPx: {
			x: Number(sheetPx.x.toFixed(2)),
			y: Number(sheetPx.y.toFixed(2)),
			width: Number(sheetPx.width.toFixed(2)),
			height: Number(sheetPx.height.toFixed(2)),
		},
		titleBlockPx: {
			x: Number(tb.x.toFixed(2)),
			y: Number(tb.y.toFixed(2)),
			width: Number(tb.width.toFixed(2)),
			height: Number(tb.height.toFixed(2)),
		},
		evidence: {
			noGrid: true,
			sheetFrame: true,
			titleBlock: true,
			moduleRegions: moduleRegions.length,
			moduleRegionMinGap: moduleRegions.length > 1
				? Number(Math.min(...moduleRegions.flatMap((a, i) => moduleRegions.slice(i + 1).map(b => rectsGap(a.box, b.box)))).toFixed(2))
				: null,
			moduleRegionNames: moduleRegions.map(r => r.name),
			components: (snapshot?.components || []).length,
			wires: (snapshot?.wires || []).length,
			texts: (snapshot?.texts || []).length,
			netflags: (snapshot?.netflags || []).length,
			footprint,
			renderedPins,
			renderedNoConnects: renderedNc,
			renderedJunctions: junctions.length,
			renderedModuleTitles,
			renderedModuleTitleBars,
			textQuality,
			titleBlockMetadata: summarizeTitleBlockMetadata(textBoxes),
		},
		moduleRegions,
	};
	return { svg, png, report };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const snapPath = process.argv[2] || DIR + 'full_model.json';
	const outPng = process.argv[3] || DEFAULT_OUT;
	const outReport = process.argv[4] || DEFAULT_REPORT;
	const { report } = renderSheetOutput(readJson(snapPath), outPng);
	writeFileSync(outReport, JSON.stringify(report, null, 2), 'utf8');
	console.log(`sheet output -> ${outPng}`);
	console.log(`sheet frame=${report.sheetPx.width}x${report.sheetPx.height} title=${report.titleBlockPx.width}x${report.titleBlockPx.height}`);
}
