import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeCode, saveJsonResult } from './bridge_client.mjs';
import { inspectPng, readPngPixels } from './image_gate.mjs';
import { inferModuleRegions } from './sheet_renderer.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const SNAP = process.env.EASYEDA_LIVE_SNAP || DIR + 'live.json';
const OUT = process.env.EASYEDA_LIVE_SHOTS_OUT || DIR + 'live_region_shots/';
const REPORT = process.env.EASYEDA_LIVE_SHOTS_REPORT || DIR + 'live_shots_report.json';
const WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';
const MODE = process.env.EASYEDA_LIVE_SHOTS_MODE || 'auto';

mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT)) {
	if (/\.(png|js|json)$/i.test(name)) unlinkSync(join(OUT, name));
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
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
	return null;
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

function wireBox(w) {
	const xs = [];
	const ys = [];
	const line = w.line || [];
	for (let i = 0; i + 1 < line.length; i += 2) {
		if (finite(line[i]) && finite(line[i + 1])) {
			xs.push(line[i]);
			ys.push(line[i + 1]);
		}
	}
	return xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } : null;
}

function expand(box, pad) {
	return { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
}

function paddedAspectBox(box, pad = 80, aspect = 2030 / 980) {
	let b = expand(box, pad);
	const cx = (b.minX + b.maxX) / 2;
	const cy = (b.minY + b.maxY) / 2;
	let width = Math.max(100, b.maxX - b.minX);
	let height = Math.max(80, b.maxY - b.minY);
	if (width / height > aspect) height = width / aspect;
	else width = height * aspect;
	b = { minX: cx - width / 2, minY: cy - height / 2, maxX: cx + width / 2, maxY: cy + height / 2 };
	return b;
}

function scriptForRegion(box) {
	const b = paddedAspectBox(box);
	return `const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(() => null);
const tabId = doc && doc.tabId ? doc.tabId : undefined;
const ok = await eda.dmt_EditorControl.zoomToRegion(${b.minX}, ${b.maxX}, ${b.maxY}, ${b.minY}, tabId);
if (!ok) return { error: 'zoomToRegion failed' };
await new Promise(r => setTimeout(r, 900));
const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(tabId);
if (!blob) return { error: 'no blob returned' };
const buf = await blob.arrayBuffer();
const bytes = new Uint8Array(buf);
let bin = '';
const chunk = 0x8000;
for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
return { type: blob.type, size: bytes.length, b64: btoa(bin) };`;
}

function componentMap(snap) {
	return new Map((snap.components || []).map(c => [c.designator, c]));
}

function moduleBoxWithWires(snap, region, pad = 42) {
	const byRef = componentMap(snap);
	const refs = new Set((region.refs || []).filter(Boolean));
	const boxes = [];
	for (const ref of refs) boxes.push(normalizeBox(byRef.get(ref)?.bbox));
	const partUnion = union(boxes);
	if (!partUnion) return region.box;
	const candidate = expand(partUnion, pad);
	for (const w of snap.wires || []) {
		const wb = wireBox(w);
		if (!wb) continue;
		const overlaps = wb.minX <= candidate.maxX && wb.maxX >= candidate.minX && wb.minY <= candidate.maxY && wb.maxY >= candidate.minY;
		if (overlaps) boxes.push(wb);
	}
	return expand(union(boxes) || partUnion, pad);
}

function titleBox(snap) {
	const texts = (snap.texts || []).filter(t => /Schematic1|AIHWDEBUGER|创建日期|更新日期|原理图|Board1/i.test(String(t.content || '')));
	const textUnion = union(texts.map(t => normalizeBox(t.bbox)));
	if (textUnion) return expand(textUnion, 80);
	const all = union([
		...(snap.texts || []).map(t => normalizeBox(t.bbox)),
		...(snap.rectangles || []).map(r => normalizeBox(r.bbox)),
	]);
	if (!all) return null;
	return { minX: all.maxX - 650, minY: all.minY - 40, maxX: all.maxX + 80, maxY: all.minY + 180 };
}

function regionSpecs(snap) {
	const modules = inferModuleRegions(snap, 34);
	const refsByModule = new Map();
	for (const mod of [
		['usb', ['J1', 'R9', 'R10', 'R11', 'R12']],
		['ldo', ['U2', 'C1', 'C2', 'C4', 'R10']],
		['btn1', ['SW1', 'R18', 'C3']],
		['btn2', ['SW2', 'R17']],
		['mcu', ['U1']],
		['pmos', ['Q1', 'Q2', 'D1', 'R1', 'R2', 'R3', 'R4', 'CN2']],
		['relay1', ['Q3', 'D2', 'R13', 'R15', 'CN3']],
		['relay2', ['Q4', 'D3', 'R14', 'R16', 'CN4']],
	]) refsByModule.set(mod[0], mod[1]);
	const regions = modules.map(r => ({ ...r, refs: refsByModule.get(r.name) || [], box: moduleBoxWithWires(snap, { ...r, refs: refsByModule.get(r.name) || [] }) }));
	const byName = new Map(regions.map(r => [r.name, r]));
	const allElectrical = union([
		...(snap.components || []).map(c => normalizeBox(c.bbox)),
		...(snap.netflags || []).map(f => normalizeBox(f.bbox)),
		...(snap.wires || []).map(wireBox),
	]);
	const title = titleBox(snap);
	const out = [
		{ name: '00_global', box: expand(allElectrical, 130), kind: 'global' },
		{ name: '01_usb', box: byName.get('usb')?.box, kind: 'module' },
		{ name: '02_ldo', box: byName.get('ldo')?.box, kind: 'module' },
		{ name: '03_reset', box: byName.get('btn1')?.box, kind: 'module' },
		{ name: '04_boot', box: byName.get('btn2')?.box, kind: 'module' },
		{ name: '05_mcu_left', box: splitBox(byName.get('mcu')?.box, 'left'), kind: 'module' },
		{ name: '06_mcu_right', box: splitBox(byName.get('mcu')?.box, 'right'), kind: 'module' },
		{ name: '07_pmos', box: byName.get('pmos')?.box, kind: 'module' },
		{ name: '08_relay1', box: byName.get('relay1')?.box, kind: 'module' },
		{ name: '09_relay2', box: byName.get('relay2')?.box, kind: 'module' },
		{ name: '10_title_template', box: title, kind: 'title' },
	];
	return out.filter(r => r.box);
}

function splitBox(box, side) {
	if (!box) return null;
	const mid = (box.minX + box.maxX) / 2;
	const overlap = Math.max(30, (box.maxX - box.minX) * 0.1);
	return side === 'left'
		? { ...box, maxX: mid + overlap }
		: { ...box, minX: mid - overlap };
}

function configFor(region) {
	const cropMode = region.captureMode === 'cropped-from-easyeda-global-canvas';
	return {
		minWidth: cropMode ? 240 : 800,
		minHeight: cropMode ? 160 : 450,
		minFileBytes: region.kind === 'title' ? 6000 : 9000,
		minInkRatio: 0.001,
		minContentWidthRatio: region.kind === 'global' ? 0.2 : 0.08,
		minContentHeightRatio: region.kind === 'global' ? 0.18 : 0.08,
		minSchematicInkRatio: 0.0005,
		minSchematicContentWidthRatio: region.kind === 'global' ? 0.18 : 0.04,
		minSchematicContentHeightRatio: region.kind === 'global' ? 0.15 : 0.04,
		minSchematicMarginPx: 0,
		minSchematicMarginRatio: 0,
		minUniqueColors: 3,
	};
}

function hashFile(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function modelToPixelTransform(sheetBox, width, height) {
	const sx = width / Math.max(1, sheetBox.maxX - sheetBox.minX);
	const sy = height / Math.max(1, sheetBox.maxY - sheetBox.minY);
	return {
		x: v => (v - sheetBox.minX) * sx,
		y: v => height - ((v - sheetBox.minY) * sy),
	};
}

function fullCanvasBox(snap) {
	const b = union([
		...(snap.components || []).map(c => normalizeBox(c.bbox)),
		...(snap.netflags || []).map(f => normalizeBox(f.bbox)),
		...(snap.wires || []).map(wireBox),
		...(snap.texts || []).map(t => normalizeBox(t.bbox)),
		...(snap.rectangles || []).map(r => normalizeBox(r.bbox)),
	]);
	return expand(b, 130);
}

function schematicBBoxFromImage(path) {
	const metrics = inspectPng(path, {
		minWidth: 1,
		minHeight: 1,
		minFileBytes: 1,
		minInkRatio: 0,
		minContentWidthRatio: 0,
		minContentHeightRatio: 0,
		minSchematicInkRatio: 0,
		minSchematicContentWidthRatio: 0,
		minSchematicContentHeightRatio: 0,
		minSchematicMarginPx: 0,
		minSchematicMarginRatio: 0,
		minUniqueColors: 1,
	}).metrics;
	return metrics.schematicBBox;
}

function pngChunk(type, data) {
	const zlibCrc32 = crc32(Buffer.concat([Buffer.from(type), data]));
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 4, 'ascii');
	data.copy(out, 8);
	out.writeUInt32BE(zlibCrc32, 8 + data.length);
	return out;
}

function crc32(buf) {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return (~c) >>> 0;
}

async function zlibDeflate(raw) {
	const zlib = await import('node:zlib');
	return zlib.deflateSync(raw);
}

async function writePng(path, width, height, rgba) {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width * 4 + 1);
		raw[row] = 0;
		rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', await zlibDeflate(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
	writeFileSync(path, png);
}

function cropBuffer(decoded, boxPx, targetAspect = 2030 / 980) {
	const pad = 18;
	let x1 = Math.floor(Math.max(0, boxPx.minX - pad));
	let x2 = Math.ceil(Math.min(decoded.width - 1, boxPx.maxX + pad));
	let y1 = Math.floor(Math.max(0, boxPx.minY - pad));
	let y2 = Math.ceil(Math.min(decoded.height - 1, boxPx.maxY + pad));
	const cx = (x1 + x2) / 2;
	const cy = (y1 + y2) / 2;
	let w = Math.max(80, x2 - x1 + 1);
	let h = Math.max(60, y2 - y1 + 1);
	if (w / h > targetAspect) h = w / targetAspect;
	else w = h * targetAspect;
	x1 = Math.max(0, Math.floor(cx - w / 2));
	x2 = Math.min(decoded.width - 1, Math.ceil(cx + w / 2));
	y1 = Math.max(0, Math.floor(cy - h / 2));
	y2 = Math.min(decoded.height - 1, Math.ceil(cy + h / 2));
	const outW = x2 - x1 + 1;
	const outH = y2 - y1 + 1;
	const out = Buffer.alloc(outW * outH * 4);
	const bpp = decoded.bpp;
	for (let y = 0; y < outH; y++) {
		for (let x = 0; x < outW; x++) {
			const src = ((y1 + y) * decoded.width + (x1 + x)) * bpp;
			const dst = (y * outW + x) * 4;
			out[dst] = decoded.pixels[src];
			out[dst + 1] = decoded.pixels[src + 1];
			out[dst + 2] = decoded.pixels[src + 2];
			out[dst + 3] = bpp === 4 ? decoded.pixels[src + 3] : 255;
		}
	}
	return { width: outW, height: outH, pixels: out, cropBoxPx: { minX: x1, minY: y1, maxX: x2, maxY: y2 } };
}

async function captureCanvasRegion(region, pngFile) {
	const jsFile = join(OUT, `${region.name}.js`);
	writeFileSync(jsFile, scriptForRegion(region.box), 'utf8');
	const { result } = await executeCode(readFileSync(jsFile, 'utf8'), { windowId: WINDOW_ID, timeoutMs: 120000 });
	if (!result?.b64) throw new Error(`NO_IMAGE_B64 for ${region.name}: ${JSON.stringify(result)}`);
	writeFileSync(pngFile, Buffer.from(result.b64, 'base64'));
	return { captureMode: 'zoomed-easyeda-canvas', jsFile };
}

async function cropFromGlobalCanvas(snap, regions, findings) {
	const globalPng = join(OUT, '00_global.png');
	await captureCanvasRegion({ name: '00_global', box: fullCanvasBox(snap) }, globalPng);
	const decoded = readPngPixels(globalPng);
	const tr = modelToPixelTransform(fullCanvasBox(snap), decoded.width, decoded.height);
	const visible = schematicBBoxFromImage(globalPng);
	if (!visible) {
		findings.push({ rule: 'LS4-live-global-visible-bbox', severity: 'hard', category: 'live-image', msg: 'global EasyEDA screenshot has no detectable schematic content', where: { path: globalPng } });
		return;
	}
	for (const region of regions.filter(r => r.name !== '00_global')) {
		const pngFile = join(OUT, `${region.name}.png`);
		const boxPx = {
			minX: Math.min(tr.x(region.box.minX), tr.x(region.box.maxX)),
			maxX: Math.max(tr.x(region.box.minX), tr.x(region.box.maxX)),
			minY: Math.min(tr.y(region.box.minY), tr.y(region.box.maxY)),
			maxY: Math.max(tr.y(region.box.minY), tr.y(region.box.maxY)),
		};
		const outside = boxPx.maxX < visible.minX || boxPx.minX > visible.maxX || boxPx.maxY < visible.minY || boxPx.minY > visible.maxY;
		if (outside) {
			findings.push({
				rule: 'LS5-live-region-outside-current-canvas',
				severity: 'hard',
				category: 'live-image',
				msg: 'requested live region is outside the current EasyEDA canvas capture; zoomToRegion did not provide a usable regional screenshot',
				where: { region: region.name, regionBoxPx: boxPx, visibleSchematicBBox: visible },
			});
			continue;
		}
		const crop = cropBuffer(decoded, boxPx);
		await writePng(pngFile, crop.width, crop.height, crop.pixels);
		region.cropBoxPx = crop.cropBoxPx;
		region.captureMode = 'cropped-from-easyeda-global-canvas';
	}
}

async function ensureLiveSnap() {
	if (existsSync(SNAP)) return readJson(SNAP);
	return saveJsonResult({ jsFile: DIR + 'snapshot2.js', outFile: SNAP, windowId: WINDOW_ID, timeoutMs: 120000 });
}

const snap = await ensureLiveSnap();
const regions = regionSpecs(snap);
const shotReports = [];
const findings = [];
if (regions.length < 10) findings.push({ rule: 'LS1-live-shot-count', severity: 'hard', category: 'live-image', msg: 'live evidence must include at least 10 EasyEDA canvas screenshots', where: { count: regions.length } });

let captureMode = 'zoomed-easyeda-canvas';
let fallbackDiagnosticOnly = false;
let zoomEvidence = null;
if (MODE === 'crop-global') {
	captureMode = 'cropped-from-easyeda-global-canvas';
	fallbackDiagnosticOnly = true;
	findings.push({
		rule: 'LS6-live-crop-diagnostic-only',
		severity: 'hard',
		category: 'live-image',
		msg: 'global-canvas crops are diagnostic only and cannot prove module identity; use real zoomed EasyEDA region screenshots for final live evidence',
		where: { mode: MODE },
	});
	await cropFromGlobalCanvas(snap, regions, findings);
} else {
	for (const region of regions) {
		const pngFile = join(OUT, `${region.name}.png`);
		console.log(`live shot ${region.name}`);
		await captureCanvasRegion(region, pngFile);
	}
	const hashes = regions.map(r => hashFile(join(OUT, `${r.name}.png`)));
	const unique = new Set(hashes).size;
	zoomEvidence = {
		requestedRegions: regions.length,
		uniqueRequestedCaptures: unique,
		hashes: regions.map((r, i) => ({ region: r.name, sha256: hashes[i] })),
	};
	if (unique < Math.min(4, regions.length)) {
		if (MODE === 'auto') {
			console.warn(`zoomed live shots are not distinct (${unique}/${hashes.length}); falling back to crops from the real EasyEDA global canvas`);
			captureMode = 'cropped-from-easyeda-global-canvas';
			fallbackDiagnosticOnly = true;
			findings.push({
				rule: 'LS6-live-crop-diagnostic-only',
				severity: 'hard',
				category: 'live-image',
				msg: 'EasyEDA returned identical screenshots for different zoom regions; fallback crops are diagnostic only and cannot be used as final module-level live evidence',
				where: { unique, count: hashes.length },
			});
			for (const name of readdirSync(OUT)) if (/\.(png|js)$/i.test(name)) unlinkSync(join(OUT, name));
			await cropFromGlobalCanvas(snap, regions, findings);
		} else {
			findings.push({ rule: 'LS3-live-shot-unique', severity: 'hard', category: 'live-image', msg: 'live region screenshots are not visually distinct; EasyEDA viewport capture likely did not change', where: { unique, count: hashes.length } });
		}
	}
}

const finalHashes = [];
for (const region of regions) {
	const pngFile = join(OUT, `${region.name}.png`);
	if (!existsSync(pngFile)) continue;
	console.log(`inspect ${region.name}`);
	if (captureMode === 'cropped-from-easyeda-global-canvas' && region.name === '00_global') region.captureMode = 'easyeda-global-canvas';
	else if (captureMode === 'zoomed-easyeda-canvas') region.captureMode = 'zoomed-easyeda-canvas';
	const image = inspectPng(pngFile, configFor(region));
	const hash = hashFile(pngFile);
	finalHashes.push(hash);
	const report = { region: region.name, kind: region.kind, path: pngFile, box: region.box, pass: image.pass, metrics: image.metrics, findings: image.findings };
	if (region.cropBoxPx) report.cropBoxPx = region.cropBoxPx;
	report.sha256 = hash;
	shotReports.push(report);
	for (const f of image.findings || []) findings.push({ ...f, rule: `LS2-${f.rule}`, where: { region: region.name, ...(f.where || {}) } });
}
const uniqueFinal = new Set(finalHashes).size;
if (uniqueFinal < Math.min(8, regions.length)) findings.push({ rule: 'LS3-live-shot-unique', severity: 'hard', category: 'live-image', msg: 'live region evidence must contain visually distinct images', where: { unique: uniqueFinal, count: finalHashes.length } });

const liveReport = {
	generatedAt: new Date().toISOString(),
	mode: 'easyeda-live-canvas-shots',
	captureMode,
	fallbackDiagnosticOnly,
	zoomEvidence,
	source: SNAP,
	outputDir: OUT,
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	screenshots: shotReports.length,
	regions: shotReports,
	findings,
};
writeFileSync(REPORT, JSON.stringify(liveReport, null, 2), 'utf8');
console.log(`live shots ${liveReport.pass ? 'PASS' : 'FAIL'} screenshots=${liveReport.screenshots} hard=${liveReport.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(liveReport.pass ? 0 : 1);
