import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const DEFAULT_CONFIG = {
	minWidth: 1200,
	minHeight: 700,
	minFileBytes: 20000,
	minInkRatio: 0.002,
	maxInkRatio: 0.35,
	minContentWidthRatio: 0.35,
	minContentHeightRatio: 0.25,
	minSchematicInkRatio: 0.004,
	minSchematicContentWidthRatio: 0.78,
	minSchematicContentHeightRatio: 0.8,
	minSchematicMarginPx: 24,
	minSchematicMarginRatio: 0.02,
	minUniqueColors: 8,
	whiteThreshold: 245,
	blackThreshold: 12,
};

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

function bytesPerPixel(colorType, bitDepth) {
	if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
	if (colorType === 6) return 4;
	if (colorType === 2) return 3;
	throw new Error(`unsupported PNG color type: ${colorType}`);
}

function parsePng(path) {
	const buf = readFileSync(path);
	if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
		throw new Error('not a PNG file');
	}

	let pos = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	const idats = [];
	while (pos + 12 <= buf.length) {
		const len = buf.readUInt32BE(pos); pos += 4;
		const type = buf.subarray(pos, pos + 4).toString('ascii'); pos += 4;
		const data = buf.subarray(pos, pos + len); pos += len;
		pos += 4;
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
		} else if (type === 'IDAT') {
			idats.push(data);
		} else if (type === 'IEND') {
			break;
		}
	}
	if (!width || !height || !idats.length) throw new Error('PNG missing IHDR or IDAT');
	return { buf, width, height, bitDepth, colorType, compressed: Buffer.concat(idats) };
}

function unfilterPng(raw, width, height, bpp) {
	const rowBytes = width * bpp;
	const pixels = Buffer.alloc(rowBytes * height);
	let inPos = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[inPos++];
		const rowStart = y * rowBytes;
		const prevStart = (y - 1) * rowBytes;
		for (let x = 0; x < rowBytes; x++) {
			const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
			const up = y > 0 ? pixels[prevStart + x] : 0;
			const upLeft = y > 0 && x >= bpp ? pixels[prevStart + x - bpp] : 0;
			const v = raw[inPos++];
			let out;
			if (filter === 0) out = v;
			else if (filter === 1) out = v + left;
			else if (filter === 2) out = v + up;
			else if (filter === 3) out = v + Math.floor((left + up) / 2);
			else if (filter === 4) out = v + paeth(left, up, upLeft);
			else throw new Error(`unsupported PNG filter: ${filter}`);
			pixels[rowStart + x] = out & 255;
		}
	}
	return pixels;
}

export function readPngPixels(path) {
	const png = parsePng(path);
	const bpp = bytesPerPixel(png.colorType, png.bitDepth);
	const raw = zlib.inflateSync(png.compressed);
	const expectedBytes = (png.width * bpp + 1) * png.height;
	if (raw.length < expectedBytes) throw new Error(`PNG data too short: ${raw.length} < ${expectedBytes}`);
	return {
		width: png.width,
		height: png.height,
		bpp,
		pixels: unfilterPng(raw, png.width, png.height, bpp),
		fileBytes: png.buf.length,
	};
}

export function inspectPng(path, config = DEFAULT_CONFIG) {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const decoded = readPngPixels(path);
	const png = { width: decoded.width, height: decoded.height, buf: { length: decoded.fileBytes }, compressed: { length: 0 }, bitDepth: 8, colorType: decoded.bpp === 4 ? 6 : 2 };
	const bpp = decoded.bpp;
	const pixels = decoded.pixels;

	let ink = 0;
	let black = 0;
	let minX = png.width;
	let minY = png.height;
	let maxX = -1;
	let maxY = -1;
	let schematicInk = 0;
	let schematicMinX = png.width;
	let schematicMinY = png.height;
	let schematicMaxX = -1;
	let schematicMaxY = -1;
	const colors = new Set();
	const sampleStep = Math.max(1, Math.floor((png.width * png.height) / 50000));
	let sampleIndex = 0;

	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const i = (y * png.width + x) * bpp;
			const r = pixels[i];
			const g = pixels[i + 1];
			const b = pixels[i + 2];
			const a = bpp === 4 ? pixels[i + 3] : 255;
			if (a < 16) continue;
			const isWhite = r >= cfg.whiteThreshold && g >= cfg.whiteThreshold && b >= cfg.whiteThreshold;
			const isBlack = r <= cfg.blackThreshold && g <= cfg.blackThreshold && b <= cfg.blackThreshold;
			const maxRgb = Math.max(r, g, b);
			const minRgb = Math.min(r, g, b);
			const luma = (r + g + b) / 3;
			const isSchematicInk = (maxRgb - minRgb > 45 && luma < 248) || luma < 180;
			if (!isWhite) {
				ink++;
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
			if (isSchematicInk) {
				schematicInk++;
				schematicMinX = Math.min(schematicMinX, x);
				schematicMinY = Math.min(schematicMinY, y);
				schematicMaxX = Math.max(schematicMaxX, x);
				schematicMaxY = Math.max(schematicMaxY, y);
			}
			if (isBlack) black++;
			if (sampleIndex % sampleStep === 0) {
				colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 4}`);
			}
			sampleIndex++;
		}
	}

	const total = png.width * png.height;
	const inkRatio = ink / total;
	const blackRatio = black / total;
	const contentWidth = maxX >= minX ? maxX - minX + 1 : 0;
	const contentHeight = maxY >= minY ? maxY - minY + 1 : 0;
	const schematicWidth = schematicMaxX >= schematicMinX ? schematicMaxX - schematicMinX + 1 : 0;
	const schematicHeight = schematicMaxY >= schematicMinY ? schematicMaxY - schematicMinY + 1 : 0;
	const schematicBBox = schematicWidth ? {
		minX: schematicMinX,
		minY: schematicMinY,
		maxX: schematicMaxX,
		maxY: schematicMaxY,
		width: schematicWidth,
		height: schematicHeight,
	} : null;
	const metrics = {
		fileBytes: decoded.fileBytes,
		width: png.width,
		height: png.height,
		bitDepth: png.bitDepth,
		colorType: png.colorType,
		idatBytes: 0,
		inkPixels: ink,
		inkRatio: Number(inkRatio.toFixed(6)),
		schematicInkPixels: schematicInk,
		schematicInkRatio: Number((schematicInk / total).toFixed(6)),
		blackRatio: Number(blackRatio.toFixed(6)),
		uniqueColorBuckets: colors.size,
		contentBBox: contentWidth ? { minX, minY, maxX, maxY, width: contentWidth, height: contentHeight } : null,
		contentWidthRatio: Number((contentWidth / png.width).toFixed(6)),
		contentHeightRatio: Number((contentHeight / png.height).toFixed(6)),
		schematicBBox,
		schematicContentWidthRatio: Number((schematicWidth / png.width).toFixed(6)),
		schematicContentHeightRatio: Number((schematicHeight / png.height).toFixed(6)),
	};
	if (schematicBBox) {
		const margins = {
			left: schematicBBox.minX,
			top: schematicBBox.minY,
			right: png.width - 1 - schematicBBox.maxX,
			bottom: png.height - 1 - schematicBBox.maxY,
		};
		metrics.schematicMarginsPx = margins;
		metrics.schematicMinMarginPx = Math.min(margins.left, margins.top, margins.right, margins.bottom);
		metrics.schematicMinMarginRatio = Number((metrics.schematicMinMarginPx / Math.min(png.width, png.height)).toFixed(6));
	}
	const findings = [];
	function hard(rule, msg, where = {}) {
		findings.push({ rule, severity: 'hard', category: 'image', msg, where });
	}
	if (metrics.width < cfg.minWidth || metrics.height < cfg.minHeight) {
		hard('I1-image-dimensions', 'screenshot dimensions are too small for commercial review', { width: metrics.width, height: metrics.height });
	}
	if (metrics.fileBytes < cfg.minFileBytes) {
		hard('I2-image-file-size', 'screenshot file is too small to prove rendered schematic content', { fileBytes: metrics.fileBytes });
	}
	if (metrics.inkRatio < cfg.minInkRatio) {
		hard('I3-image-blank', 'screenshot is nearly blank or all white', { inkRatio: metrics.inkRatio });
	}
	if (metrics.inkRatio > cfg.maxInkRatio || metrics.blackRatio > cfg.maxInkRatio) {
		hard('I4-image-occluded', 'screenshot is likely occluded, all black, or not a clean schematic canvas', { inkRatio: metrics.inkRatio, blackRatio: metrics.blackRatio });
	}
	if (metrics.contentWidthRatio < cfg.minContentWidthRatio || metrics.contentHeightRatio < cfg.minContentHeightRatio) {
		hard('I5-image-content-crop', 'screenshot content footprint is too small or cropped for review', {
			contentWidthRatio: metrics.contentWidthRatio,
			contentHeightRatio: metrics.contentHeightRatio,
			contentBBox: metrics.contentBBox,
		});
	}
	if (metrics.schematicInkRatio < cfg.minSchematicInkRatio) {
		hard('I7-image-schematic-ink', 'screenshot has too little schematic-colored content after filtering the grid', { schematicInkRatio: metrics.schematicInkRatio });
	}
	if (metrics.schematicContentWidthRatio < cfg.minSchematicContentWidthRatio || metrics.schematicContentHeightRatio < cfg.minSchematicContentHeightRatio) {
		hard('I8-image-schematic-footprint', 'schematic-colored content footprint is too small after filtering the grid', {
			schematicContentWidthRatio: metrics.schematicContentWidthRatio,
			schematicContentHeightRatio: metrics.schematicContentHeightRatio,
			schematicBBox: metrics.schematicBBox,
		});
	}
	if (metrics.schematicBBox) {
		const m = cfg.minSchematicMarginPx;
		const touches = metrics.schematicBBox.minX < m || metrics.schematicBBox.minY < m ||
			metrics.schematicBBox.maxX > metrics.width - 1 - m || metrics.schematicBBox.maxY > metrics.height - 1 - m;
		if (touches) {
			hard('I9-image-schematic-edge-touch', 'schematic-colored content touches the screenshot edge after grid filtering', { minMarginPx: m, schematicBBox: metrics.schematicBBox });
		}
		if ((metrics.schematicMinMarginRatio ?? 0) < cfg.minSchematicMarginRatio) {
			hard('I10-image-schematic-edge-pressure', 'schematic-colored content has too little screenshot edge margin after grid filtering', {
				minMarginRatio: cfg.minSchematicMarginRatio,
				schematicMinMarginRatio: metrics.schematicMinMarginRatio,
				schematicMarginsPx: metrics.schematicMarginsPx,
				schematicBBox: metrics.schematicBBox,
			});
		}
	}
	if (metrics.uniqueColorBuckets < cfg.minUniqueColors) {
		hard('I6-image-low-variance', 'screenshot has too little pixel variance to prove rendered EasyEDA content', { uniqueColorBuckets: metrics.uniqueColorBuckets });
	}
	return {
		path,
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		metrics,
		findings,
	};
}

const invokedPath = process.argv[1] || '';
if (invokedPath && (import.meta.url === `file:///${invokedPath.replaceAll('\\', '/')}` || import.meta.url === `file://${invokedPath}`)) {
	const imagePath = process.argv[2];
	const outPath = process.argv[3];
	if (!imagePath) {
		console.error('usage: node engine/image_gate.mjs <png> [report.json]');
		process.exit(2);
	}
	try {
		const report = inspectPng(imagePath);
		if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
		console.log(`image gate ${report.pass ? 'OK' : 'FAIL'} ${imagePath}`);
		console.log(`pixels=${report.metrics.width}x${report.metrics.height} inkRatio=${report.metrics.inkRatio} content=${report.metrics.contentWidthRatio}x${report.metrics.contentHeightRatio}`);
		process.exit(report.pass ? 0 : 1);
	} catch (e) {
		const report = {
			path: imagePath,
			pass: false,
			severity: { hard: 1, soft: 0, info: 0 },
			metrics: null,
			findings: [{ rule: 'I0-image-parse', severity: 'hard', category: 'image', msg: e.message, where: { path: imagePath } }],
		};
		if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
		console.error(`image gate FAIL ${e.message}`);
		process.exit(1);
	}
}
