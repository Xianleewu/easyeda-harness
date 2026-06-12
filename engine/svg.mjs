// 离线 SVG 渲染器：把模型画成可视图，用于离线推演验证
const PIN_DIR = { 0: [1, 0], 90: [0, -1], 180: [-1, 0], 270: [0, 1] };

function netColor(net) {
	if (!net) return '#1a9a4b';
	if (net === 'GND') return '#7a7a7a';
	let h = 0; for (const ch of net) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	const hue = h % 360; return `hsl(${hue} 70% 38%)`;
}

export function dedupeSegs(line) {
	const segs = [];
	for (let i = 0; i + 3 < line.length; i += 2) {
		const a = [line[i], line[i + 1]], b = [line[i + 2], line[i + 3]];
		if (a[0] === b[0] && a[1] === b[1]) continue; // 零长
		segs.push([a, b]);
	}
	return segs;
}

export function renderSVG(model, opts = {}) {
	const margin = 40, target = opts.width || 1800;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
	for (const c of model.components) if (c.bbox) { acc(c.bbox.minX, c.bbox.minY); acc(c.bbox.maxX, c.bbox.maxY); }
	for (const n of model.netflags) acc(n.x, n.y);
	for (const r of model.rectangles || []) if (r.bbox) { acc(r.bbox.minX, r.bbox.minY); acc(r.bbox.maxX, r.bbox.maxY); }
	for (const t of model.texts || []) if (t.bbox) { acc(t.bbox.minX, t.bbox.minY); acc(t.bbox.maxX, t.bbox.maxY); }
	for (const w of model.wires) for (const [a, b] of dedupeSegs(w.line)) { acc(a[0], a[1]); acc(b[0], b[1]); }
	const w = maxX - minX || 1, h = maxY - minY || 1;
	const scale = (target - 2 * margin) / w;
	const W = target, H = h * scale + 2 * margin;
	const tx = x => (x - minX) * scale + margin;
	const ty = y => (maxY - y) * scale + margin; // EDA 为 y 朝上，翻转以匹配实图
	const out = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">`);
	out.push(`<rect width="100%" height="100%" fill="#fbfbf7"/>`);
	// 网格
	out.push(`<g stroke="#e8e8e0" stroke-width="0.5">`);
	for (let gx = Math.ceil(minX / 50) * 50; gx <= maxX; gx += 50) out.push(`<line x1="${tx(gx).toFixed(1)}" y1="0" x2="${tx(gx).toFixed(1)}" y2="${H.toFixed(0)}"/>`);
	for (let gy = Math.ceil(minY / 50) * 50; gy <= maxY; gy += 50) out.push(`<line x1="0" y1="${ty(gy).toFixed(1)}" x2="${W.toFixed(0)}" y2="${ty(gy).toFixed(1)}"/>`);
	out.push(`</g>`);
	// 导线
	for (const wire of model.wires) {
		const col = netColor(wire.net);
		for (const [a, b] of dedupeSegs(wire.line))
			out.push(`<line x1="${tx(a[0]).toFixed(1)}" y1="${ty(a[1]).toFixed(1)}" x2="${tx(b[0]).toFixed(1)}" y2="${ty(b[1]).toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`);
	}
	// 器件 bbox + 引脚
	for (const c of model.components) {
		if (c.bbox) {
			const x = tx(c.bbox.minX), y = ty(c.bbox.maxY), bw = (c.bbox.maxX - c.bbox.minX) * scale, bh = (c.bbox.maxY - c.bbox.minY) * scale;
			out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="#fff3e0" fill-opacity="0.5" stroke="#c8762a" stroke-width="1"/>`);
			out.push(`<text x="${(x + 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" font-size="11" fill="#b35400" font-family="monospace">${c.designator || ''} ${c.value || ''}</text>`);
		}
		for (const p of c.pins || []) {
			const d = PIN_DIR[((p.rot % 360) + 360) % 360] || [0, 0];
			const px = tx(p.x), py = ty(p.y);
			const ix = tx(p.x - d[0] * (p.len || 10)), iy = ty(p.y - d[1] * (p.len || 10));
			out.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="#888" stroke-width="0.8"/>`);
			out.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2" fill="#d00"/>`);
		}
	}
	// netflag
	for (const n of model.netflags) {
		const col = n.net === 'GND' ? '#555' : '#1565c0';
		if (n.bbox) {
			const x = tx(n.bbox.minX), y = ty(n.bbox.maxY), bw = (n.bbox.maxX - n.bbox.minX) * scale, bh = (n.bbox.maxY - n.bbox.minY) * scale;
			out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="none" stroke="#1565c0" stroke-width="0.6" stroke-dasharray="2 2"/>`);
		}
		out.push(`<circle cx="${tx(n.x).toFixed(1)}" cy="${ty(n.y).toFixed(1)}" r="2.5" fill="${col}"/>`);
		out.push(`<text x="${(tx(n.x) + 4).toFixed(1)}" y="${(ty(n.y) - 3).toFixed(1)}" font-size="10" fill="${col}" font-family="monospace">${n.net} (r${n.rotation})</text>`);
	}
	out.push(`</svg>`);
	return out.join('\n');
}
