import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inspectPng, readPngPixels } from './image_gate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_RENDER = DIR + 'sheet_output_render.json';
const DEFAULT_IMAGE = DIR + 'sheet_output.png';
const DEFAULT_OUT = DIR + 'sheet_output_gate.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'sheet-output', msg, where });
}

function finite(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

function transformForReport(renderReport) {
	const sheetBox = renderReport?.sheetBox;
	const sheetPx = renderReport?.sheetPx;
	if (!sheetBox || !sheetPx) return null;
	const w = sheetBox.maxX - sheetBox.minX;
	const h = sheetBox.maxY - sheetBox.minY;
	if (![w, h, sheetPx.x, sheetPx.y, sheetPx.width, sheetPx.height].every(finite) || w <= 0 || h <= 0) return null;
	return {
		x: v => sheetPx.x + (v - sheetBox.minX) * sheetPx.width / w,
		y: v => sheetPx.y + (sheetBox.maxY - v) * sheetPx.height / h,
	};
}

function pixelInk(decoded, x, y) {
	const i = (y * decoded.width + x) * decoded.bpp;
	const r = decoded.pixels[i];
	const g = decoded.pixels[i + 1];
	const b = decoded.pixels[i + 2];
	const a = decoded.bpp === 4 ? decoded.pixels[i + 3] : 255;
	if (a < 16) return false;
	return !(r >= 245 && g >= 245 && b >= 245);
}

export function measureModuleVisualRhythm(renderReport, imagePath) {
	const tr = transformForReport(renderReport);
	if (!tr || !Array.isArray(renderReport?.moduleRegions)) return null;
	const decoded = readPngPixels(imagePath);
	const modules = [];
	for (const region of renderReport.moduleRegions) {
		const b = region.box;
		if (!b) continue;
		const minX = Math.max(0, Math.floor(tr.x(b.minX)));
		const maxX = Math.min(decoded.width - 1, Math.ceil(tr.x(b.maxX)));
		const minY = Math.max(0, Math.floor(tr.y(b.maxY)));
		const maxY = Math.min(decoded.height - 1, Math.ceil(tr.y(b.minY)));
		if (maxX <= minX || maxY <= minY) continue;
		let ink = 0;
		let total = 0;
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				total++;
				if (pixelInk(decoded, x, y)) ink++;
			}
		}
		modules.push({
			name: region.name,
			parts: region.parts,
			pxBox: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
			inkPixels: ink,
			totalPixels: total,
			inkRatio: Number((ink / Math.max(1, total)).toFixed(6)),
		});
	}
	const byName = Object.fromEntries(modules.map(m => [m.name, m]));
	const relayInkDelta = byName.relay1 && byName.relay2 ? Number(Math.abs(byName.relay1.inkRatio - byName.relay2.inkRatio).toFixed(6)) : null;
	return {
		modules,
		minInkRatio: modules.length ? Number(Math.min(...modules.map(m => m.inkRatio)).toFixed(6)) : null,
		maxInkRatio: modules.length ? Number(Math.max(...modules.map(m => m.inkRatio)).toFixed(6)) : null,
		relayInkDelta,
	};
}

export function measureSheetTileRhythm(renderReport, imagePath, opts = {}) {
	if (!renderReport?.sheetPx) return null;
	const decoded = readPngPixels(imagePath);
	const cols = opts.cols ?? 12;
	const rows = opts.rows ?? 8;
	const tr = transformForReport(renderReport);
	if (!tr) return null;
	const usable = renderReport.evidence?.footprint?.usable || null;
	const sheet = renderReport.sheetPx;
	let x0;
	let y0;
	let x1;
	let y1;
	if (usable) {
		x0 = Math.max(0, Math.floor(tr.x(usable.minX)));
		x1 = Math.min(decoded.width - 1, Math.ceil(tr.x(usable.maxX)));
		y0 = Math.max(0, Math.floor(tr.y(usable.maxY)));
		y1 = Math.min(decoded.height - 1, Math.ceil(tr.y(usable.minY)));
	} else {
		if (![sheet.x, sheet.y, sheet.width, sheet.height].every(finite) || sheet.width <= 0 || sheet.height <= 0) return null;
		x0 = Math.max(0, Math.floor(sheet.x));
		y0 = Math.max(0, Math.floor(sheet.y));
		x1 = Math.min(decoded.width - 1, Math.ceil(sheet.x + sheet.width));
		y1 = Math.min(decoded.height - 1, Math.ceil(sheet.y + sheet.height));
	}
	const tiles = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const minX = Math.floor(x0 + (x1 - x0 + 1) * col / cols);
			const maxX = Math.floor(x0 + (x1 - x0 + 1) * (col + 1) / cols) - 1;
			const minY = Math.floor(y0 + (y1 - y0 + 1) * row / rows);
			const maxY = Math.floor(y0 + (y1 - y0 + 1) * (row + 1) / rows) - 1;
			let ink = 0;
			let total = 0;
			for (let y = minY; y <= maxY; y++) {
				for (let x = minX; x <= maxX; x++) {
					total++;
					if (pixelInk(decoded, x, y)) ink++;
				}
			}
			tiles.push({
				row,
				col,
				inkRatio: Number((ink / Math.max(1, total)).toFixed(6)),
				inkPixels: ink,
				totalPixels: total,
			});
		}
	}
	const activeThreshold = opts.activeThreshold ?? 0.008;
	const activeTiles = tiles.filter(t => t.inkRatio >= activeThreshold);
	const rowActiveCounts = Array.from({ length: rows }, (_, row) => activeTiles.filter(t => t.row === row).length);
	const colActiveCounts = Array.from({ length: cols }, (_, col) => activeTiles.filter(t => t.col === col).length);
	let maxEmptyRun = 0;
	for (const counts of [rowActiveCounts, colActiveCounts]) {
		let run = 0;
		for (const count of counts) {
			if (count === 0) {
				run++;
				maxEmptyRun = Math.max(maxEmptyRun, run);
			} else {
				run = 0;
			}
		}
	}
	const activeTileRatio = Number((activeTiles.length / Math.max(1, tiles.length)).toFixed(6));
	return {
		cols,
		rows,
		activeThreshold,
		activeTiles: activeTiles.length,
		totalTiles: tiles.length,
		activeTileRatio,
		rowActiveCounts,
		colActiveCounts,
		maxEmptyRun,
		tileInkRatio: {
			min: Number(Math.min(...tiles.map(t => t.inkRatio)).toFixed(6)),
			max: Number(Math.max(...tiles.map(t => t.inkRatio)).toFixed(6)),
			median: Number([...tiles].sort((a, b) => a.inkRatio - b.inkRatio)[Math.floor(tiles.length / 2)].inkRatio.toFixed(6)),
		},
		region: usable ? 'usable-circuit-area' : 'sheet-frame',
	};
}

function centerOfBox(b) {
	return {
		x: Number(((b.minX + b.maxX) / 2).toFixed(3)),
		y: Number(((b.minY + b.maxY) / 2).toFixed(3)),
	};
}

function boxWidth(b) {
	return Number((b.maxX - b.minX).toFixed(3));
}

function boxHeight(b) {
	return Number((b.maxY - b.minY).toFixed(3));
}

function gapX(a, b) {
	return Number(Math.max(0, b.minX - a.maxX, a.minX - b.maxX).toFixed(3));
}

function gapY(a, b) {
	return Number(Math.max(0, b.minY - a.maxY, a.minY - b.maxY).toFixed(3));
}

export function measureModuleGridRhythm(renderReport) {
	if (!Array.isArray(renderReport?.moduleRegions)) return null;
	const byName = Object.fromEntries(renderReport.moduleRegions.filter(r => r?.name && r?.box).map(r => [r.name, {
		name: r.name,
		box: r.box,
		center: centerOfBox(r.box),
		width: boxWidth(r.box),
		height: boxHeight(r.box),
		parts: r.parts ?? null,
	}]));
	const required = ['usb', 'ldo', 'mcu', 'pmos', 'relay1', 'relay2', 'btn1', 'btn2'];
	const missing = required.filter(name => !byName[name]);
	if (missing.length) return { missing };
	const inputColumnSkew = Number(Math.abs(byName.usb.center.x - byName.ldo.center.x).toFixed(3));
	const inputToMcuGap = Number(Math.min(gapX(byName.usb.box, byName.mcu.box), gapX(byName.ldo.box, byName.mcu.box)).toFixed(3));
	const mcuToPmosGap = gapX(byName.mcu.box, byName.pmos.box);
	const pmosToRelayGap = Number(Math.min(gapX(byName.pmos.box, byName.relay1.box), gapX(byName.pmos.box, byName.relay2.box)).toFixed(3));
	const outputStackXDelta = Number(Math.abs(byName.relay1.center.x - byName.relay2.center.x).toFixed(3));
	const outputStackWidthDelta = Number(Math.abs(byName.relay1.width - byName.relay2.width).toFixed(3));
	const outputStackHeightDelta = Number(Math.abs(byName.relay1.height - byName.relay2.height).toFixed(3));
	const outputStackGap = gapY(byName.relay1.box, byName.relay2.box);
	const supportRowYDelta = Number(Math.abs(byName.btn1.center.y - byName.btn2.center.y).toFixed(3));
	const supportRowGap = gapX(byName.btn1.box, byName.btn2.box);
	const supportBelowMcu = Number((byName.mcu.center.y - Math.max(byName.btn1.center.y, byName.btn2.center.y)).toFixed(3));
	const mainCenters = [
		{ name: 'input', x: Number(((byName.usb.center.x + byName.ldo.center.x) / 2).toFixed(3)) },
		{ name: 'mcu', x: byName.mcu.center.x },
		{ name: 'pmos', x: byName.pmos.center.x },
		{ name: 'relay', x: Number(((byName.relay1.center.x + byName.relay2.center.x) / 2).toFixed(3)) },
	];
	const ordered = mainCenters.every((c, i) => i === 0 || c.x > mainCenters[i - 1].x);
	return {
		modules: byName,
		mainCenters,
		ordered,
		inputColumnSkew,
		inputToMcuGap,
		mcuToPmosGap,
		pmosToRelayGap,
		outputStackXDelta,
		outputStackWidthDelta,
		outputStackHeightDelta,
		outputStackGap,
		supportRowYDelta,
		supportRowGap,
		supportBelowMcu,
	};
}

export function auditSheetOutput(renderReport, imagePath = DEFAULT_IMAGE, opts = {}) {
	const cfg = {
		minWidth: opts.minWidth ?? 1800,
		minHeight: opts.minHeight ?? 1000,
		minFileBytes: opts.minFileBytes ?? 45000,
		minSheetWidthRatio: opts.minSheetWidthRatio ?? 0.88,
		minSheetHeightRatio: opts.minSheetHeightRatio ?? 0.78,
		minTitleBlockWidthRatio: opts.minTitleBlockWidthRatio ?? 0.20,
		minTitleBlockHeightRatio: opts.minTitleBlockHeightRatio ?? 0.035,
		minComponents: opts.minComponents ?? 30,
		minWires: opts.minWires ?? 50,
		minModuleRegions: opts.minModuleRegions ?? 8,
		minModuleRegionGap: opts.minModuleRegionGap ?? 20,
		minElectricalWidthRatio: opts.minElectricalWidthRatio ?? 0.9,
		minElectricalHeightRatio: opts.minElectricalHeightRatio ?? 0.86,
		minModuleWidthRatio: opts.minModuleWidthRatio ?? 0.88,
		minModuleHeightRatio: opts.minModuleHeightRatio ?? 0.72,
		minModulePackingRatio: opts.minModulePackingRatio ?? 0.28,
		minRenderedPins: opts.minRenderedPins ?? 120,
		minRenderedNoConnects: opts.minRenderedNoConnects ?? 20,
		minRenderedJunctions: opts.minRenderedJunctions ?? 20,
		minRenderedModuleTitles: opts.minRenderedModuleTitles ?? 8,
		minRenderedModuleTitleBars: opts.minRenderedModuleTitleBars ?? 8,
		minReadableTextFontSize: opts.minReadableTextFontSize ?? 5.8,
		minNetLabelBackplates: opts.minNetLabelBackplates ?? 1,
		minNetLabelBackplateRatio: opts.minNetLabelBackplateRatio ?? 1,
		minModuleInkRatio: opts.minModuleInkRatio ?? 0.055,
		maxModuleInkRatio: opts.maxModuleInkRatio ?? 0.62,
		maxRepeatedModuleInkDelta: opts.maxRepeatedModuleInkDelta ?? 0.015,
		minTileActiveRatio: opts.minTileActiveRatio ?? 0.50,
		maxTileEmptyRun: opts.maxTileEmptyRun ?? 1,
		maxInputColumnSkew: opts.maxInputColumnSkew ?? 80,
		minMainColumnGap: opts.minMainColumnGap ?? 80,
		maxOutputStackXDelta: opts.maxOutputStackXDelta ?? 10,
		maxOutputStackSizeDelta: opts.maxOutputStackSizeDelta ?? 10,
		minOutputStackGap: opts.minOutputStackGap ?? 35,
		maxSupportRowYDelta: opts.maxSupportRowYDelta ?? 20,
		minSupportRowGap: opts.minSupportRowGap ?? 35,
		minSupportBelowMcu: opts.minSupportBelowMcu ?? 70,
		minTitleBlockMetadataItems: opts.minTitleBlockMetadataItems ?? 6,
	};
	const findings = [];
	let image = null;
	let visualRhythm = null;
	let tileRhythm = null;
	let moduleGridRhythm = null;
	if (!renderReport || typeof renderReport !== 'object') {
		hard(findings, 'SO1-render-report-missing', 'sheet-output render report is missing or invalid');
	} else {
		if (renderReport.evidence?.noGrid !== true) hard(findings, 'SO2-grid-present', 'commercial sheet output must be a clean drawing view, not an EasyEDA grid-canvas screenshot');
		if (renderReport.evidence?.sheetFrame !== true) hard(findings, 'SO3-sheet-frame-missing', 'commercial sheet output must include a visible sheet frame');
		if ((renderReport.evidence?.components || 0) < cfg.minComponents) hard(findings, 'SO5-component-coverage', 'sheet output does not include enough schematic components', {
			components: renderReport.evidence?.components,
			required: cfg.minComponents,
		});
		if ((renderReport.evidence?.wires || 0) < cfg.minWires) hard(findings, 'SO6-wire-coverage', 'sheet output does not include enough schematic wires', {
			wires: renderReport.evidence?.wires,
			required: cfg.minWires,
		});
		if ((renderReport.evidence?.moduleRegions || 0) < cfg.minModuleRegions) hard(findings, 'SO10-module-region-coverage', 'sheet output must expose every functional module as a bounded review region', {
			moduleRegions: renderReport.evidence?.moduleRegions,
			required: cfg.minModuleRegions,
			moduleRegionNames: renderReport.evidence?.moduleRegionNames || [],
		});
		if ((renderReport.evidence?.moduleRegionMinGap ?? cfg.minModuleRegionGap) < cfg.minModuleRegionGap) hard(findings, 'SO11-module-region-gap', 'sheet-output module regions are too close and may read as interlocking blocks', {
			moduleRegionMinGap: renderReport.evidence?.moduleRegionMinGap,
			required: cfg.minModuleRegionGap,
		});
		if ((renderReport.evidence?.renderedPins || 0) < cfg.minRenderedPins) {
			hard(findings, 'SO16-pin-detail-coverage', 'sheet output must render symbol pins, not just component body rectangles', {
				renderedPins: renderReport.evidence?.renderedPins || 0,
				required: cfg.minRenderedPins,
			});
		}
		if ((renderReport.evidence?.renderedNoConnects || 0) < cfg.minRenderedNoConnects) {
			hard(findings, 'SO17-no-connect-detail-coverage', 'sheet output must render visible no-connect markers for reviewable unused pins', {
				renderedNoConnects: renderReport.evidence?.renderedNoConnects || 0,
				required: cfg.minRenderedNoConnects,
			});
		}
		if ((renderReport.evidence?.renderedJunctions || 0) < cfg.minRenderedJunctions) {
			hard(findings, 'SO18-junction-detail-coverage', 'sheet output must render electrical junction dots so joined wires are unambiguous', {
				renderedJunctions: renderReport.evidence?.renderedJunctions || 0,
				required: cfg.minRenderedJunctions,
			});
		}
		if ((renderReport.evidence?.renderedModuleTitles || 0) < cfg.minRenderedModuleTitles) {
			hard(findings, 'SO19-module-title-coverage', 'sheet output must render every functional module title as a review entry point', {
				renderedModuleTitles: renderReport.evidence?.renderedModuleTitles || 0,
				required: cfg.minRenderedModuleTitles,
			});
		}
		if ((renderReport.evidence?.renderedModuleTitleBars || 0) < cfg.minRenderedModuleTitleBars) {
			hard(findings, 'SO20-module-title-bar-coverage', 'sheet output must render visible module title bars, not only faint region boxes', {
				renderedModuleTitleBars: renderReport.evidence?.renderedModuleTitleBars || 0,
				required: cfg.minRenderedModuleTitleBars,
			});
		}
		const textQuality = renderReport.evidence?.textQuality;
		if (!textQuality) {
			hard(findings, 'SO21-text-quality-evidence-missing', 'sheet output must report text readability and collision evidence');
		} else {
			if ((textQuality.criticalTextOverlaps ?? 999) > 0) {
				hard(findings, 'SO22-critical-text-overlap', 'critical sheet text overlaps with another review-critical label', {
					criticalTextOverlaps: textQuality.criticalTextOverlaps,
					pairs: textQuality.criticalOverlapPairs || [],
				});
			}
			if ((textQuality.minFontSize ?? 0) < cfg.minReadableTextFontSize) {
				hard(findings, 'SO23-text-readable-size', 'sheet output contains text below the minimum readable review size', {
					minFontSize: textQuality.minFontSize,
					required: cfg.minReadableTextFontSize,
				});
			}
			if ((textQuality.netLabelComponentOverlaps ?? 999) > 0) {
				hard(findings, 'SO24-net-label-component-overlap', 'net labels must not overlap component bodies in sheet output', {
					netLabelComponentOverlaps: textQuality.netLabelComponentOverlaps,
					pairs: textQuality.netLabelComponentPairs || [],
				});
			}
			if ((textQuality.netLabelBackplates ?? 0) < cfg.minNetLabelBackplates || (textQuality.netLabelBackplateRatio ?? 0) < cfg.minNetLabelBackplateRatio) {
				hard(findings, 'SO37-net-label-callout-style', 'sheet-output net labels must render as explicit readable callouts, not bare floating text', {
					netLabels: textQuality.netLabels ?? 0,
					netLabelBackplates: textQuality.netLabelBackplates ?? 0,
					netLabelBackplateRatio: textQuality.netLabelBackplateRatio ?? 0,
					minNetLabelBackplates: cfg.minNetLabelBackplates,
					minNetLabelBackplateRatio: cfg.minNetLabelBackplateRatio,
				});
			}
		}
		const fp = renderReport.evidence?.footprint;
		if (!fp) {
			hard(findings, 'SO12-footprint-evidence-missing', 'sheet output must report circuit-body footprint metrics, not only sheet-frame pixels');
		} else {
			if (fp.electricalWidthRatio < cfg.minElectricalWidthRatio || fp.electricalHeightRatio < cfg.minElectricalHeightRatio) {
				hard(findings, 'SO13-electrical-footprint', 'electrical drawing body is too sparse inside the usable sheet area', {
					electricalWidthRatio: fp.electricalWidthRatio,
					electricalHeightRatio: fp.electricalHeightRatio,
					requiredWidthRatio: cfg.minElectricalWidthRatio,
					requiredHeightRatio: cfg.minElectricalHeightRatio,
				});
			}
			if (fp.moduleWidthRatio < cfg.minModuleWidthRatio || fp.moduleHeightRatio < cfg.minModuleHeightRatio) {
				hard(findings, 'SO14-module-footprint', 'functional module regions do not occupy a reference-readable footprint on the sheet', {
					moduleWidthRatio: fp.moduleWidthRatio,
					moduleHeightRatio: fp.moduleHeightRatio,
					requiredWidthRatio: cfg.minModuleWidthRatio,
					requiredHeightRatio: cfg.minModuleHeightRatio,
				});
			}
			if (fp.modulePackingRatio < cfg.minModulePackingRatio) {
				hard(findings, 'SO15-module-packing', 'module review regions are too scattered or oversized for a commercial schematic handoff', {
					modulePackingRatio: fp.modulePackingRatio,
					required: cfg.minModulePackingRatio,
				});
			}
		}
		const sheet = renderReport.sheetPx || {};
		const width = renderReport.width || 1;
		const height = renderReport.height || 1;
		const sheetWidthRatio = sheet.width / width;
		const sheetHeightRatio = sheet.height / height;
		if (sheetWidthRatio < cfg.minSheetWidthRatio || sheetHeightRatio < cfg.minSheetHeightRatio) {
			hard(findings, 'SO7-sheet-footprint', 'sheet frame footprint is too small for reference-PDF-like review output', {
				sheetWidthRatio: Number(sheetWidthRatio.toFixed(6)),
				sheetHeightRatio: Number(sheetHeightRatio.toFixed(6)),
				requiredWidthRatio: cfg.minSheetWidthRatio,
				requiredHeightRatio: cfg.minSheetHeightRatio,
				sheet,
			});
		}
	}
	if (!existsSync(imagePath)) {
		hard(findings, 'SO9-image-missing', 'sheet-output PNG is missing', { imagePath });
	} else {
		image = inspectPng(imagePath, {
			minWidth: cfg.minWidth,
			minHeight: cfg.minHeight,
			minFileBytes: cfg.minFileBytes,
			minSchematicContentWidthRatio: 0.7,
			minSchematicContentHeightRatio: 0.7,
			minSchematicInkRatio: 0.003,
			minSchematicMarginPx: 20,
			minSchematicMarginRatio: 0.01,
		});
		for (const f of image.findings || []) hard(findings, f.rule, f.msg, f.where);
		if (renderReport && typeof renderReport === 'object') {
			try {
				visualRhythm = measureModuleVisualRhythm(renderReport, imagePath);
				tileRhythm = measureSheetTileRhythm(renderReport, imagePath);
			} catch (e) {
				hard(findings, 'SO25-module-visual-rhythm-measurement', 'sheet-output module visual rhythm could not be measured from the PNG', { error: e.message });
			}
			if (!visualRhythm) {
				hard(findings, 'SO25-module-visual-rhythm-measurement', 'sheet-output must expose measurable per-module visual rhythm evidence');
			} else {
				const sparse = visualRhythm.modules.filter(m => m.inkRatio < cfg.minModuleInkRatio);
				const dense = visualRhythm.modules.filter(m => m.inkRatio > cfg.maxModuleInkRatio);
				if (sparse.length) {
					hard(findings, 'SO26-module-visual-sparsity', 'module regions are too visually sparse for a commercial review sheet', {
						minModuleInkRatio: cfg.minModuleInkRatio,
						modules: sparse,
					});
				}
				if (dense.length) {
					hard(findings, 'SO27-module-visual-crowding', 'module regions are too visually crowded for a commercial review sheet', {
						maxModuleInkRatio: cfg.maxModuleInkRatio,
						modules: dense,
					});
				}
				if (visualRhythm.relayInkDelta != null && visualRhythm.relayInkDelta > cfg.maxRepeatedModuleInkDelta) {
					hard(findings, 'SO28-repeated-module-visual-consistency', 'repeated relay modules must have matching visual density', {
						relayInkDelta: visualRhythm.relayInkDelta,
						maxRepeatedModuleInkDelta: cfg.maxRepeatedModuleInkDelta,
						modules: visualRhythm.modules.filter(m => m.name === 'relay1' || m.name === 'relay2'),
					});
				}
			}
			if (!tileRhythm) {
				hard(findings, 'SO29-sheet-tile-rhythm-measurement', 'sheet-output must expose measurable sheet tile rhythm evidence');
			} else {
				if (tileRhythm.activeTileRatio < cfg.minTileActiveRatio) {
					hard(findings, 'SO30-sheet-tile-coverage', 'sheet-output content occupies too few review-grid tiles compared with reference-style pages', {
						activeTileRatio: tileRhythm.activeTileRatio,
						minTileActiveRatio: cfg.minTileActiveRatio,
						rowActiveCounts: tileRhythm.rowActiveCounts,
						colActiveCounts: tileRhythm.colActiveCounts,
					});
				}
				if (tileRhythm.maxEmptyRun > cfg.maxTileEmptyRun) {
					hard(findings, 'SO31-sheet-empty-band', 'sheet-output contains a large empty row/column band unlike a reference review sheet', {
						maxEmptyRun: tileRhythm.maxEmptyRun,
						maxTileEmptyRun: cfg.maxTileEmptyRun,
						rowActiveCounts: tileRhythm.rowActiveCounts,
						colActiveCounts: tileRhythm.colActiveCounts,
					});
				}
			}
			moduleGridRhythm = measureModuleGridRhythm(renderReport);
			if (!moduleGridRhythm || (moduleGridRhythm.missing || []).length) {
				hard(findings, 'SO32-module-grid-rhythm-measurement', 'sheet-output must expose measurable module row/column rhythm evidence', {
					missing: moduleGridRhythm?.missing || [],
				});
			} else {
				const weakColumnGaps = [
					{ name: 'input-to-mcu', gap: moduleGridRhythm.inputToMcuGap },
					{ name: 'mcu-to-pmos', gap: moduleGridRhythm.mcuToPmosGap },
					{ name: 'pmos-to-relay', gap: moduleGridRhythm.pmosToRelayGap },
				].filter(g => g.gap < cfg.minMainColumnGap);
				if (!moduleGridRhythm.ordered || moduleGridRhythm.inputColumnSkew > cfg.maxInputColumnSkew || weakColumnGaps.length) {
					hard(findings, 'SO33-module-column-reading-order', 'sheet-output modules must form clear input, MCU, power, and output columns with readable channels', {
						mainCenters: moduleGridRhythm.mainCenters,
						ordered: moduleGridRhythm.ordered,
						inputColumnSkew: moduleGridRhythm.inputColumnSkew,
						maxInputColumnSkew: cfg.maxInputColumnSkew,
						minMainColumnGap: cfg.minMainColumnGap,
						weakColumnGaps,
					});
				}
				if (moduleGridRhythm.outputStackXDelta > cfg.maxOutputStackXDelta
					|| moduleGridRhythm.outputStackWidthDelta > cfg.maxOutputStackSizeDelta
					|| moduleGridRhythm.outputStackHeightDelta > cfg.maxOutputStackSizeDelta
					|| moduleGridRhythm.outputStackGap < cfg.minOutputStackGap) {
					hard(findings, 'SO34-output-stack-consistency', 'repeated relay output modules must render as a clean aligned stack', {
						outputStackXDelta: moduleGridRhythm.outputStackXDelta,
						outputStackWidthDelta: moduleGridRhythm.outputStackWidthDelta,
						outputStackHeightDelta: moduleGridRhythm.outputStackHeightDelta,
						outputStackGap: moduleGridRhythm.outputStackGap,
						maxOutputStackXDelta: cfg.maxOutputStackXDelta,
						maxOutputStackSizeDelta: cfg.maxOutputStackSizeDelta,
						minOutputStackGap: cfg.minOutputStackGap,
					});
				}
				if (moduleGridRhythm.supportRowYDelta > cfg.maxSupportRowYDelta
					|| moduleGridRhythm.supportRowGap < cfg.minSupportRowGap
					|| moduleGridRhythm.supportBelowMcu < cfg.minSupportBelowMcu) {
					hard(findings, 'SO35-support-row-rhythm', 'RESET and BOOT support modules must render as an aligned support row below the MCU', {
						supportRowYDelta: moduleGridRhythm.supportRowYDelta,
						supportRowGap: moduleGridRhythm.supportRowGap,
						supportBelowMcu: moduleGridRhythm.supportBelowMcu,
						maxSupportRowYDelta: cfg.maxSupportRowYDelta,
						minSupportRowGap: cfg.minSupportRowGap,
						minSupportBelowMcu: cfg.minSupportBelowMcu,
					});
				}
			}
		}
	}
	return {
		generatedAt: new Date().toISOString(),
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		imagePath,
		render: renderReport && {
			output: renderReport.output,
			width: renderReport.width,
			height: renderReport.height,
			fileBytes: renderReport.fileBytes,
			sheetPx: renderReport.sheetPx,
			titleBlockPx: renderReport.titleBlockPx,
			evidence: renderReport.evidence,
			moduleRegions: renderReport.moduleRegions,
			visualRhythm,
			tileRhythm,
			moduleGridRhythm,
		},
		image: image && {
			pass: image.pass,
			metrics: image.metrics,
			findings: image.findings,
		},
		findings,
	};
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const renderPath = process.argv[2] || DEFAULT_RENDER;
	const imagePath = process.argv[3] || DEFAULT_IMAGE;
	const outPath = process.argv[4] || DEFAULT_OUT;
	const report = auditSheetOutput(existsSync(renderPath) ? readJson(renderPath) : null, imagePath);
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`sheet output gate ${report.pass ? 'OK' : 'FAIL'} hard=${report.severity.hard}`);
	process.exit(report.pass ? 0 : 1);
}
