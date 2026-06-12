import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel, round2 } from '../harness/model.mjs';
import { auditCommercialArchitecture } from './commercial_architecture.mjs';
import { auditPageComposition } from './page_composition.mjs';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function clampScore(v) {
	return Math.max(0, Math.min(100, Math.round(v)));
}

function dim(id, score, comment, details = {}) {
	const s = clampScore(score);
	return { id, pass: s >= 85, score: s, comment, details };
}

function boxCenter(box) {
	return box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : null;
}

function boxArea(box) {
	return box ? (box.maxX - box.minX) * (box.maxY - box.minY) : 0;
}

function n(v, fallback = 0) {
	return Number.isFinite(v) ? v : fallback;
}

function union(boxes) {
	const hit = boxes.filter(Boolean);
	if (!hit.length) return null;
	return {
		minX: Math.min(...hit.map(b => b.minX)),
		maxX: Math.max(...hit.map(b => b.maxX)),
		minY: Math.min(...hit.map(b => b.minY)),
		maxY: Math.max(...hit.map(b => b.maxY)),
	};
}

function byModule(architecture) {
	return new Map((architecture?.metrics?.moduleBoxes || []).map(m => [m.name, m]));
}

function hasFinding(architecture, rule) {
	return Boolean(architecture?.findings?.some(f => f.rule === rule));
}

function visibleRequiredCount(architecture) {
	const f = architecture?.findings?.find(x => x.rule === 'A4-visible-interface-required');
	return f?.where?.interfaces?.length || 0;
}

function contractRequiredCount(architecture) {
	const f = architecture?.findings?.find(x => x.rule === 'A1-label-only-interfaces');
	return f?.where?.labelOnlyInterfaces?.length || 0;
}

export function autoDesignReview(snap, opts = {}) {
	const model = buildModel(snap);
	const architecture = opts.architecture || auditCommercialArchitecture(snap);
	const structure = opts.structure || null;
	const pageComposition = opts.pageComposition || auditPageComposition(snap);
	const imageMetrics = opts.viewportFit?.metrics?.referenceFootprint || opts.image?.metrics || opts.imageReport?.metrics || null;
	const modules = byModule(architecture);
	const usb = modules.get('usb');
	const ldo = modules.get('ldo');
	const mcu = modules.get('mcu');
	const pmos = modules.get('pmos');
	const relay1 = modules.get('relay1');
	const relay2 = modules.get('relay2');
	const btn1 = modules.get('btn1');
	const btn2 = modules.get('btn2');

	const usbC = boxCenter(usb?.box);
	const ldoC = boxCenter(ldo?.box);
	const mcuC = boxCenter(mcu?.box);
	const pmosC = boxCenter(pmos?.box);
	const relayC = relay1 && relay2 ? {
		x: (boxCenter(relay1.box).x + boxCenter(relay2.box).x) / 2,
		y: (boxCenter(relay1.box).y + boxCenter(relay2.box).y) / 2,
	} : null;
	const inputSpread = usbC && ldoC ? Math.abs(usbC.y - ldoC.y) : 999;
	const outputBox = union([pmos?.box, relay1?.box, relay2?.box]);
	const outputHeight = outputBox ? outputBox.maxY - outputBox.minY : 999;
	const outputArea = boxArea(outputBox);
	const minGap = structure?.minModuleGap ?? Math.min(...(architecture?.stats?.moduleGaps || [{ gap: 0 }]).map(g => g.gap));
	const labelOnly = architecture?.stats?.labelOnlyInterfaces ?? 99;
	const groupedContracts = architecture?.stats?.groupedContracts ?? 0;
	const pairedGroupedContracts = architecture?.stats?.pairedGroupedContracts ?? 0;
	const visibleRequired = visibleRequiredCount(architecture);
	const contractRequired = contractRequiredCount(architecture);
	const structureHard = structure?.severity?.hard ?? 0;
	const templateHard = opts.template?.bySev?.hard ?? 0;
	const referenceMinWidthRatio = opts.referenceMinWidthRatio ?? 0.78;
	const referenceMinHeightRatio = opts.referenceMinHeightRatio ?? 0.85;
	const sheetOutput = opts.sheetOutput || null;
	const referenceBaseline = opts.referenceBaseline || null;
	const outputStack = pageComposition?.stats?.outputStack || {};
	const supportRow = pageComposition?.stats?.supportRow || {};
	const moduleGrid = sheetOutput?.render?.moduleGridRhythm || sheetOutput?.moduleGridRhythm || null;
	const tileRhythm = sheetOutput?.render?.tileRhythm || sheetOutput?.tileRhythm || null;
	const visualRhythm = sheetOutput?.render?.visualRhythm || sheetOutput?.visualRhythm || null;
	const baselineSheet = referenceBaseline?.sheet || null;
	const baselineThresholds = referenceBaseline?.thresholds || null;
	const sheetEvidence = sheetOutput?.render?.evidence || sheetOutput?.evidence || {};
	const footprint = baselineSheet?.footprint || sheetEvidence.footprint || null;
	const densityTileRhythm = baselineSheet?.tileRhythm || tileRhythm || null;

	const flowOrderPenalty =
		(usbC && mcuC && usbC.x >= mcuC.x ? 25 : 0) +
		(ldoC && mcuC && ldoC.x >= mcuC.x ? 20 : 0) +
		(mcuC && pmosC && pmosC.x <= mcuC.x ? 25 : 0) +
		(mcuC && relayC && relayC.x <= mcuC.x ? 25 : 0);
	const systemReadingFlow = dim(
		'system-reading-flow',
		100 - flowOrderPenalty - Math.max(0, inputSpread - 240) * 0.25 - (hasFinding(architecture, 'A3-output-band-sprawl') ? 12 : 0),
		'Input/power, MCU/control, and output/load should read as a left-to-right engineering story.',
		{ inputSpread: round2(inputSpread), flowOrderPenalty, outputHeight: round2(outputHeight), outputArea: round2(outputArea) },
	);

	const functionalBlockCohesion = dim(
		'functional-block-cohesion',
		100 - templateHard * 35 - structureHard * 25 - Math.max(0, 90 - minGap) * 0.7 - (hasFinding(architecture, 'A2-input-power-islands') ? 12 : 0),
		'Each functional cell should stay locally closed without interlocking neighboring module boxes.',
		{ templateHard, structureHard, minGap: round2(minGap), inputPowerSplit: hasFinding(architecture, 'A2-input-power-islands') },
	);

	const interfaceLanguage = dim(
		'interface-language',
		100 - visibleRequired * 35 - contractRequired * 18 - Math.max(0, labelOnly - groupedContracts - pairedGroupedContracts * 2 - 2) * 4,
		'Cross-block interfaces need visible continuity or an intentional grouped interface contract, not scattered label-only islands.',
		{ labelOnly, groupedContracts, pairedGroupedContracts, visibleRequired, contractRequired },
	);

	const repeatedChannelGrammar = dim(
		'repeated-channel-grammar',
		100
			- (structure?.findings || []).filter(f => /^S7|C12/.test(f.rule || '')).length * 30
			- (hasFinding(architecture, 'A3-output-band-sprawl') ? 10 : 0)
			- Math.max(0, (outputStack.xDelta ?? 0) - 5) * 0.8
			- Math.max(0, (outputStack.minGap ?? 90) - (outputStack.gap ?? 999)) * 1.2
			- Math.max(0, (supportRow.yDelta ?? 0) - 5) * 0.8
			- Math.max(0, (supportRow.minRowGap ?? 90) - (supportRow.rowGap ?? 999)) * 1.2,
		'Repeated relay/button channels should share geometry and sit inside a coherent output or support band.',
		{ outputHeight: round2(outputHeight), outputArea: round2(outputArea), outputBandSprawl: hasFinding(architecture, 'A3-output-band-sprawl'), outputStack, supportRow },
	);

	const moduleGridRhythm = dim(
		'module-grid-rhythm',
		moduleGrid
			? 100
				- (moduleGrid.ordered === false ? 35 : 0)
				- Math.max(0, (moduleGrid.inputColumnSkew ?? 0) - 80) * 0.6
				- Math.max(0, 80 - (moduleGrid.mcuToPmosGap ?? 999)) * 0.8
				- Math.max(0, (moduleGrid.outputStackXDelta ?? 0) - 10) * 1.2
				- Math.max(0, (moduleGrid.supportRowYDelta ?? 0) - 20) * 1.2
			: 100 - Math.max(0, (outputStack.xDelta ?? 0) - 5) * 1.2 - Math.max(0, (supportRow.yDelta ?? 0) - 5) * 1.2,
		'Module regions should render as reference-like columns, repeated output stack, and aligned support row.',
		moduleGrid ? { moduleGridRhythm: moduleGrid } : { source: 'page-composition', outputStack, supportRow },
	);

	const contentBox = union((architecture?.metrics?.moduleBoxes || []).map(m => m.box));
	const contentArea = boxArea(contentBox);
	const referenceDensity = {
		schematicInkRatio: baselineSheet?.schematicInkRatio ?? sheetOutput?.image?.metrics?.schematicInkRatio ?? null,
		inkRatio: baselineSheet?.inkRatio ?? sheetOutput?.image?.metrics?.inkRatio ?? null,
		activeTileRatio: densityTileRhythm?.activeTileRatio ?? null,
		maxEmptyRun: densityTileRhythm?.maxEmptyRun ?? null,
		modulePackingRatio: footprint?.modulePackingRatio ?? null,
		moduleUnionAreaRatio: footprint?.moduleUnionAreaRatio ?? null,
		electricalWidthRatio: footprint?.electricalWidthRatio ?? null,
		electricalHeightRatio: footprint?.electricalHeightRatio ?? null,
	};
	const densityThresholds = {
		minSchematicInkRatio: baselineThresholds?.minSchematicInkRatio ?? 0.028,
		minInkRatio: baselineThresholds?.minInkRatio ?? 0.032,
		minTileActiveRatio: baselineThresholds?.minTileActiveRatio ?? 0.5,
		maxTileEmptyRun: baselineThresholds?.maxTileEmptyRun ?? 1,
		minModulePackingRatio: 0.28,
		minElectricalWidthRatio: 0.9,
		minElectricalHeightRatio: 0.85,
	};
	const outputStackAligned = (
		n(outputStack.xDelta, 999) <= 10
		&& n(outputStack.gap, 0) >= n(outputStack.minGap, 90)
		&& n(outputStack.sizeDelta?.width, 999) <= 10
		&& n(outputStack.sizeDelta?.height, 999) <= 10
	);
	const visualDensityPenalties = {
		coordinateSprawl: baselineSheet && footprint
			? Math.max(0, contentArea - 1250000) / 50000
			: Math.max(0, contentArea - 900000) / 18000,
		moduleGap: Math.max(0, 90 - minGap) * 0.8,
		outputSpread: outputStackAligned ? 0 : (outputArea > 340000 ? (outputArea - 340000) / 5000 : 0),
		localInk: visualRhythm ? Math.max(0, 0.055 - n(visualRhythm.minInkRatio)) * 220 : 0,
		tileCoverage: densityTileRhythm ? Math.max(0, densityThresholds.minTileActiveRatio - n(densityTileRhythm.activeTileRatio)) * 150 : 0,
		emptyTileBand: densityTileRhythm ? Math.max(0, n(densityTileRhythm.maxEmptyRun) - densityThresholds.maxTileEmptyRun) * 18 : 0,
		schematicInk: referenceDensity.schematicInkRatio === null ? 0 : Math.max(0, densityThresholds.minSchematicInkRatio - n(referenceDensity.schematicInkRatio)) * 1400,
		sheetInk: referenceDensity.inkRatio === null ? 0 : Math.max(0, densityThresholds.minInkRatio - n(referenceDensity.inkRatio)) * 900,
		modulePacking: referenceDensity.modulePackingRatio === null ? 0 : Math.max(0, densityThresholds.minModulePackingRatio - n(referenceDensity.modulePackingRatio)) * 160,
		electricalFootprint: footprint
			? Math.max(0, densityThresholds.minElectricalWidthRatio - n(footprint.electricalWidthRatio)) * 80
				+ Math.max(0, densityThresholds.minElectricalHeightRatio - n(footprint.electricalHeightRatio)) * 80
			: 0,
	};
	const visualDensityPenalty = Object.values(visualDensityPenalties).reduce((sum, v) => sum + v, 0);
	const visualDensity = dim(
		'visual-density',
		100 - visualDensityPenalty,
		'Whitespace should create hierarchy: enough separation for review, but no detached islands or oversized output spread.',
		{
			contentArea: round2(contentArea),
			minGap: round2(minGap),
			outputArea: round2(outputArea),
			pageComposition: pageComposition?.stats || null,
			visualRhythm,
			tileRhythm,
			referenceDensity,
			densityThresholds,
			penalties: Object.fromEntries(Object.entries(visualDensityPenalties).map(([k, v]) => [k, round2(v)])),
		},
	);

	const referenceFootprint = dim(
		'reference-footprint',
		imageMetrics
			? 100
				- Math.max(0, referenceMinWidthRatio - (imageMetrics.schematicContentWidthRatio || 0)) * 360
				- Math.max(0, referenceMinHeightRatio - (imageMetrics.schematicContentHeightRatio || 0)) * 160
			: 100,
		'Rendered schematic footprint should occupy the page like the reference PDFs, not float in excessive whitespace.',
		imageMetrics
			? {
				schematicContentWidthRatio: imageMetrics.schematicContentWidthRatio,
				schematicContentHeightRatio: imageMetrics.schematicContentHeightRatio,
				requiredWidthRatio: referenceMinWidthRatio,
				requiredHeightRatio: referenceMinHeightRatio,
			}
			: { evidence: 'offline review has no live screenshot; live commercial gate supplies pixel evidence' },
	);

	const referenceVisualBaseline = dim(
		'reference-visual-baseline',
		baselineSheet && baselineThresholds
			? 100
				- Math.max(0, (baselineThresholds.minSchematicInkRatio ?? 0) - (baselineSheet.schematicInkRatio ?? 0)) * 1200
				- Math.max(0, (baselineThresholds.minInkRatio ?? 0) - (baselineSheet.inkRatio ?? 0)) * 900
				- Math.max(0, (baselineThresholds.minTileActiveRatio ?? 0) - (baselineSheet.tileRhythm?.activeTileRatio ?? 0)) * 140
				- Math.max(0, (baselineSheet.tileRhythm?.maxEmptyRun ?? 0) - (baselineThresholds.maxTileEmptyRun ?? 999)) * 20
			: 100,
		'Rendered sheet should stay inside the approved reference PDF and screenshot baseline family.',
		baselineSheet && baselineThresholds
			? { sheet: baselineSheet, thresholds: baselineThresholds }
			: { evidence: 'reference baseline supplied by commercial gate when available' },
	);

	const dimensions = [systemReadingFlow, functionalBlockCohesion, interfaceLanguage, repeatedChannelGrammar, moduleGridRhythm, visualDensity, referenceFootprint, referenceVisualBaseline];
	const score = clampScore(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
	const pass = score >= 85 && dimensions.every(d => d.pass);
	return {
		generatedAt: new Date().toISOString(),
		reviewer: 'auto-design-score',
		pass,
		score,
		summary: pass
			? 'Automatic design score meets the commercial review threshold.'
			: 'Automatic design score still sees a schematic that is electrically valid but not reference-PDF readable.',
		stats: {
			parts: model.parts.length,
			wires: model.rawWires.length,
			labelOnlyInterfaces: labelOnly,
			inputSpread: round2(inputSpread),
			outputHeight: round2(outputHeight),
			outputArea: round2(outputArea),
			minGap: round2(minGap),
			schematicContentWidthRatio: imageMetrics?.schematicContentWidthRatio ?? null,
			schematicContentHeightRatio: imageMetrics?.schematicContentHeightRatio ?? null,
		},
		dimensions,
	};
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const dir = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
	const snapPath = process.argv[2] || dir + 'full_model.json';
	const outPath = process.argv[3] || dir + 'auto_design_score.json';
	const report = autoDesignReview(readJson(snapPath));
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`auto design score -> ${outPath}`);
	console.log(`score=${report.score} pass=${report.pass}`);
	process.exit(report.pass ? 0 : 1);
}
