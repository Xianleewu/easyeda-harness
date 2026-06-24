// 忠实渲染 twin 几何(真 bbox+脚+可见标注框+线)。
// 取代 sheet_renderer 当质量预览(符号美术不画,几何占位忠实)。
// 复用 sheet_renderer 已导出的 transformFor + @resvg/resvg-js(sheet_renderer 内部同一库)。
// 零特定电路。ESM。
import { transformFor } from './sheet_renderer.mjs';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

/**
 * renderTwin(twinGeom, outPng, opts) → { outPng }
 *
 * twinGeom: { components, wires, netflags?, texts?, rectangles? }
 *   component: { designator, bbox:{minX,minY,maxX,maxY},
 *                pins:[{x,y}], attrs:[{key,value,valueVisible,keyVisible,bbox}] }
 *   wire: { net, line:[x0,y0,x1,y1,...] }
 *
 * opts: { width?:number, height?:number }
 */
export function renderTwin(twinGeom, outPng, opts = {}) {
	const width = opts.width ?? 1980;
	const height = opts.height ?? 1220;
	const margin = 40;

	/* --- compute bounding box over all geometry --- */
	const boxes = [];
	for (const c of twinGeom.components || []) {
		if (c.bbox) {
			boxes.push(c.bbox);
		}
		for (const a of (c.attrs || [])) {
			if (a.bbox && (a.valueVisible || a.keyVisible)) {
				boxes.push(a.bbox);
			}
		}
	}
	for (const w of twinGeom.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 1 < l.length; i += 2) {
			boxes.push({ minX: l[i], minY: l[i + 1], maxX: l[i], maxY: l[i + 1] });
		}
	}

	const sheet = boxes.length
		? {
			minX: Math.min(...boxes.map(b => b.minX)),
			minY: Math.min(...boxes.map(b => b.minY)),
			maxX: Math.max(...boxes.map(b => b.maxX)),
			maxY: Math.max(...boxes.map(b => b.maxY)),
		}
		: { minX: 0, minY: 0, maxX: 100, maxY: 100 };

	const t = transformFor(sheet, width, height, margin);

	const svg = [];
	svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`);
	svg.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);

	/* --- wires (polylines, drawn first so components overlay) --- */
	for (const w of twinGeom.wires || []) {
		const l = w.line || [];
		let d = '';
		for (let i = 0; i + 1 < l.length; i += 2) {
			d += `${i === 0 ? 'M' : 'L'}${t.x(l[i]).toFixed(1)} ${t.y(l[i + 1]).toFixed(1)} `;
		}
		if (d) {
			svg.push(`<path d="${d.trimEnd()}" fill="none" stroke="#093" stroke-width="0.6"/>`);
		}
	}

	/* --- component bboxes (red outline) --- */
	for (const c of twinGeom.components || []) {
		if (!c.bbox) {
			continue;
		}
		const p = t.box(c.bbox);
		svg.push(
			`<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}"` +
			` width="${p.width.toFixed(1)}" height="${p.height.toFixed(1)}"` +
			` fill="none" stroke="#c33" stroke-width="0.8"/>`
		);
	}

	/* --- pins (blue dots) --- */
	for (const c of twinGeom.components || []) {
		for (const p of (c.pins || [])) {
			svg.push(
				`<circle cx="${t.x(p.x).toFixed(1)}" cy="${t.y(p.y).toFixed(1)}"` +
				` r="1.5" fill="#06c"/>`
			);
		}
	}

	/* --- visible attr bboxes (grey dashed) --- */
	for (const c of twinGeom.components || []) {
		for (const a of (c.attrs || [])) {
			if (!a.bbox || (!a.valueVisible && !a.keyVisible)) {
				continue;
			}
			const p = t.box(a.bbox);
			svg.push(
				`<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}"` +
				` width="${p.width.toFixed(1)}" height="${p.height.toFixed(1)}"` +
				` fill="none" stroke="#999" stroke-dasharray="2"/>`
			);
		}
	}

	svg.push('</svg>');

	const png = new Resvg(svg.join('\n'), { background: 'white' }).render().asPng();
	writeFileSync(outPng, png);
	return { outPng };
}
