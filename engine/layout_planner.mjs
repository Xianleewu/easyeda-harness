import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { assembleFromSnap, loadPartLib } from './assemble.mjs';
import { validateTemplate } from './validate.mjs';
import { auditCommercialArchitecture } from './commercial_architecture.mjs';
import { autoDesignReview } from './design_score.mjs';
import { auditPageComposition } from './page_composition.mjs';
import { auditSystemIntent } from './system_intent_gate.mjs';
import { renderSheetOutput } from './sheet_renderer.mjs';
import { auditSheetOutput } from './sheet_output_gate.mjs';
import { computeStructureMetricsFromSnapshot } from './structure_metrics.mjs';
import { MODULES } from '../harness/module_registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const PART_LIB = process.env.EASYEDA_PART_LIB || DIR + 'snap2.json';
const OUT_MODEL = process.env.EASYEDA_LAYOUT_PLANNER_MODEL || DIR + 'layout_planner_model.json';
const OUT_REPORT = process.env.EASYEDA_LAYOUT_PLANNER_REPORT || DIR + 'layout_planner_report.json';
const STRUCTURE_REPORT = process.env.EASYEDA_LAYOUT_PLANNER_STRUCTURE || DIR + 'layout_planner_structure.json';
const SHEET_IMAGE = process.env.EASYEDA_LAYOUT_PLANNER_SHEET_IMAGE || DIR + 'layout_planner_sheet.png';
const DEFAULT_MAX_CANDIDATES = 1200;

const BASE = {
	usb:   { x: 640,  y: 1000 },
	ldo:   { x: 440,  y: 820 },
	btn1:  { x: 760,  y: 520 },
	btn2:  { x: 1000, y: 520 },
	mcu:   { x: 920,  y: 820 },
	pmos:  { x: 1340, y: 780 },
	relay1:{ x: 1720, y: 740 },
	relay2:{ x: 1720, y: 495 },
};

const LIVE_IMAGE_BOUNDS = {
	maxSheetWidth: 1550,
	maxSheetHeight: 930,
	maxContentRight: 1710,
	maxContentTop: 1210,
	minContentLeft: 150,
	minContentBottom: 360,
};

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function runStructure(model, path = STRUCTURE_REPORT) {
	const report = computeStructureMetricsFromSnapshot(model);
	if (path) writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
	return { status: report.pass ? 0 : 1, report, stdout: '', stderr: '' };
}

function cloneAnchors(a) {
	return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v }]));
}

function familyAnchors() {
	const candidates = [];
	const seen = new Set();
	const add = (a) => {
		const key = JSON.stringify(a);
		if (!seen.has(key)) {
			seen.add(key);
			candidates.push(a);
		}
	};
	add(cloneAnchors(BASE));
	add({
		usb: { x: 640, y: 1020 },
		ldo: { x: 440, y: 830 },
		btn1: { x: 720, y: 500 },
		btn2: { x: 1020, y: 500 },
		mcu: { x: 900, y: 800 },
		pmos: { x: 1370, y: 860 },
		relay1: { x: 1710, y: 740 },
		relay2: { x: 1710, y: 495 },
	});
	const inputRows = [
		{ usbY: 960, ldoY: 780 },
		{ usbY: 980, ldoY: 800 },
		{ usbY: 1000, ldoY: 820 },
		{ usbY: 1020, ldoY: 840 },
		{ usbY: 1040, ldoY: 860 },
	];
	const outputRows = [
		{ pmosY: 760, relay1Y: 720 },
		{ pmosY: 780, relay1Y: 730 },
		{ pmosY: 780, relay1Y: 720 },
		{ pmosY: 780, relay1Y: 740 },
		{ pmosY: 800, relay1Y: 740 },
		{ pmosY: 820, relay1Y: 740 },
		{ pmosY: 780, relay1Y: 760 },
	];
	const xProfiles = [
		{ usbX: 620, ldoX: 420, mcuX: 860, pmosX: 1260, relayX: 1620 },
		{ usbX: 620, ldoX: 420, mcuX: 860, pmosX: 1260, relayX: 1560 },
		{ usbX: 620, ldoX: 420, mcuX: 860, pmosX: 1250, relayX: 1590 },
		{ usbX: 620, ldoX: 420, mcuX: 860, pmosX: 1260, relayX: 1600 },
		{ usbX: 620, ldoX: 420, mcuX: 880, pmosX: 1280, relayX: 1580 },
		{ usbX: 620, ldoX: 430, mcuX: 880, pmosX: 1300, relayX: 1600 },
		{ usbX: 640, ldoX: 440, mcuX: 900, pmosX: 1300, relayX: 1600 },
		{ usbX: 640, ldoX: 440, mcuX: 920, pmosX: 1320, relayX: 1620 },
		{ usbX: 640, ldoX: 440, mcuX: 920, pmosX: 1340, relayX: 1680 },
		{ usbX: 640, ldoX: 440, mcuX: 900, pmosX: 1340, relayX: 1680 },
		{ usbX: 640, ldoX: 440, mcuX: 900, pmosX: 1370, relayX: 1710 },
		{ usbX: 620, ldoX: 440, mcuX: 920, pmosX: 1340, relayX: 1680 },
		{ usbX: 620, ldoX: 440, mcuX: 900, pmosX: 1340, relayX: 1680 },
		{ usbX: 640, ldoX: 460, mcuX: 920, pmosX: 1340, relayX: 1700 },
		{ usbX: 640, ldoX: 440, mcuX: 940, pmosX: 1360, relayX: 1700 },
	];
	for (const xs of xProfiles) {
		for (const input of inputRows) {
			for (const output of outputRows) {
				const a = cloneAnchors(BASE);
				a.usb = { x: xs.usbX, y: input.usbY };
				a.ldo = { x: xs.ldoX, y: input.ldoY };
				const mcuY = input.usbY <= 960 ? 790 : (input.usbY <= 980 ? 800 : 820);
				const btnY = input.usbY <= 980 ? 500 : 520;
				a.mcu = { x: xs.mcuX, y: mcuY };
				a.btn1 = { x: xs.mcuX - 210, y: btnY };
				a.btn2 = { x: xs.mcuX + 110, y: btnY };
				a.pmos = { x: xs.pmosX, y: output.pmosY };
				a.relay1 = { x: xs.relayX, y: output.relay1Y };
				a.relay2 = { x: xs.relayX, y: output.relay1Y - 245 };
				add(a);
			}
		}
	}
	return candidates;
}

function geometryBoundsFromPage(pageComposition) {
	const content = pageComposition?.metrics?.contentBox || null;
	if (!content) return null;
	const sheet = {
		minX: Math.floor((content.minX - 90) / 10) * 10,
		minY: Math.floor((content.minY - 110) / 10) * 10,
		maxX: Math.ceil((content.maxX + 90) / 10) * 10,
		maxY: Math.ceil((content.maxY + 130) / 10) * 10,
	};
	return {
		content,
		sheet,
		sheetWidth: sheet.maxX - sheet.minX,
		sheetHeight: sheet.maxY - sheet.minY,
	};
}

function scoreCandidate({ template, structure, architecture, pageComposition, systemIntent, sheetOutput, design, internalPacking }) {
	const templateHard = template.bySev?.hard || 0;
	const structureHard = structure?.severity?.hard || 0;
	const archHard = architecture?.severity?.hard || 0;
	const pageHard = pageComposition?.severity?.hard || 0;
	const intentHard = systemIntent?.severity?.hard || 0;
	const sheetHard = sheetOutput?.severity?.hard || 0;
	const hard = templateHard * 50 + structureHard * 35 + archHard * 25 + intentHard * 25 + sheetHard * 20;
	const archStats = architecture?.stats || {};
	const minGap = structure?.minModuleGap ?? 0;
	const moduleWireIntrusions = structure?.stats?.moduleWireIntrusions ?? 0;
	const layout = structure?.stats?.layoutDiscipline || {};
	const page = pageComposition?.stats || {};
	const outputStack = page.outputStack || {};
	const supportRow = page.supportRow || {};
	const moduleRegionGap = sheetOutput?.render?.evidence?.moduleRegionMinGap ?? 0;
	const moduleRegions = sheetOutput?.render?.evidence?.moduleRegions ?? 0;
	const footprint = sheetOutput?.render?.evidence?.footprint || {};
	const tileRhythm = sheetOutput?.render?.tileRhythm || {};
	const geometryBounds = geometryBoundsFromPage(pageComposition);
	const fixedImagePenalty = geometryBounds ? (
		Math.max(0, geometryBounds.sheetWidth - LIVE_IMAGE_BOUNDS.maxSheetWidth) * 3 +
		Math.max(0, geometryBounds.sheetHeight - LIVE_IMAGE_BOUNDS.maxSheetHeight) * 3 +
		Math.max(0, geometryBounds.content.maxX - LIVE_IMAGE_BOUNDS.maxContentRight) * 8 +
		Math.max(0, geometryBounds.content.maxY - LIVE_IMAGE_BOUNDS.maxContentTop) * 8 +
		Math.max(0, LIVE_IMAGE_BOUNDS.minContentLeft - geometryBounds.content.minX) * 4 +
		Math.max(0, LIVE_IMAGE_BOUNDS.minContentBottom - geometryBounds.content.minY) * 4
	) : 900;
	const labelOnly = archStats.labelOnlyInterfaces ?? 99;
	const a2 = architecture?.findings?.some(f => f.rule === 'A2-input-power-islands') ? 1 : 0;
	const a3 = architecture?.findings?.some(f => f.rule === 'A3-output-band-sprawl') ? 1 : 0;
	const sparsePenalty =
		Math.max(0, 0.9 - (footprint.electricalWidthRatio ?? 0)) * 900 +
		Math.max(0, 0.86 - (footprint.electricalHeightRatio ?? 0)) * 900 +
		Math.max(0, 0.72 - (footprint.moduleHeightRatio ?? 0)) * 500 +
		Math.max(0, 0.28 - (footprint.modulePackingRatio ?? 0)) * 700;
	const internalPackingPenalty = Math.max(0, 0.085 - (internalPacking?.minOutputRatio ?? 0)) * 5000;
	const layoutPenalty =
		Math.max(0, (layout.inputColumnSkew ?? 0) - (layout.maxInputColumnSkew ?? 140)) * 3 +
		Math.max(0, (layout.minOutputSubcolumnGap ?? 250) - (layout.outputSubcolumnGap ?? 999)) * 4 +
		Math.max(0, (layout.outputSubcolumnGap ?? 0) - (layout.maxOutputSubcolumnGap ?? 460)) * 4 +
		Math.max(0, (layout.buttonRowDelta ?? 0) - (layout.maxButtonRowDelta ?? 35)) * 5 +
		Math.max(0, (layout.relaySizeDelta?.width ?? 0) - (layout.maxRepeatedSizeDelta ?? 10)) * 8 +
		Math.max(0, (layout.relaySizeDelta?.height ?? 0) - (layout.maxRepeatedSizeDelta ?? 10)) * 8 +
		Math.max(0, (outputStack.xDelta ?? 0)) * 3 +
		Math.max(0, (outputStack.sizeDelta?.width ?? 0) - 2) * 5 +
		Math.max(0, (outputStack.sizeDelta?.height ?? 0) - 2) * 5 +
		Math.max(0, (outputStack.minGap ?? 90) - (outputStack.gap ?? 999)) * 4 +
		Math.max(0, (supportRow.yDelta ?? 0)) * 3 +
		Math.max(0, (supportRow.minRowGap ?? 90) - (supportRow.rowGap ?? 999)) * 3 +
		Math.max(0, (supportRow.minBelowMcu ?? 80) - (supportRow.belowMcu ?? 999)) * 3 +
		Math.max(0, ((supportRow.minRowGap ?? 90) + 10) - (supportRow.rowGap ?? 999)) * 2 +
		Math.max(0, (supportRow.rowCenterSkew ?? 0) - 10) * 2;
	const tilePenalty =
		Math.max(0, (tileRhythm.maxEmptyRun ?? 0)) * 400 +
		Math.max(0, 0.58 - (tileRhythm.activeTileRatio ?? 0.58)) * 1200;
	const passBonus = (template.pass ? 1200 : 0) + (structure?.pass ? 1200 : 0) + (architecture?.pass ? 1800 : 0) + (pageComposition?.pass ? 1600 : 0) + (systemIntent?.pass ? 1600 : 0) + (sheetOutput?.pass ? 1400 : 0);
	return Math.round(passBonus + (design?.score || 0) * 10 - (hard + pageHard * 35) * 120 - moduleWireIntrusions * 450 - labelOnly * 30 - a2 * 500 - a3 * 500 - sparsePenalty - internalPackingPenalty - layoutPenalty - tilePenalty - fixedImagePenalty + Math.min(160, minGap) + Math.min(120, moduleRegionGap * 2) + moduleRegions * 20);
}

function quickFootprint(pageComposition) {
	const content = pageComposition.metrics?.contentBox;
	if (!content) return null;
	const width = Math.max(1, content.maxX - content.minX);
	const height = Math.max(1, content.maxY - content.minY);
	const usable = {
		minX: content.minX - Math.max(70, width * 0.06),
		maxX: content.maxX + Math.max(70, width * 0.06),
		minY: content.minY - Math.max(70, height * 0.08),
		maxY: content.maxY + Math.max(90, height * 0.1),
	};
	const usableW = Math.max(1, usable.maxX - usable.minX);
	const usableH = Math.max(1, usable.maxY - usable.minY);
	const moduleBoxes = pageComposition.metrics?.moduleBoxes || [];
	const moduleArea = moduleBoxes.reduce((sum, m) => sum + Math.max(0, m.box.maxX - m.box.minX) * Math.max(0, m.box.maxY - m.box.minY), 0);
	return {
		usable,
		electricalBox: content,
		moduleUnion: content,
		electricalWidthRatio: Number((width / usableW).toFixed(6)),
		electricalHeightRatio: Number((height / usableH).toFixed(6)),
		moduleWidthRatio: Number((width / usableW).toFixed(6)),
		moduleHeightRatio: Number((height / usableH).toFixed(6)),
		moduleAreaRatio: Number((moduleArea / Math.max(1, usableW * usableH)).toFixed(6)),
		moduleUnionAreaRatio: Number((width * height / Math.max(1, usableW * usableH)).toFixed(6)),
		modulePackingRatio: Number((moduleArea / Math.max(1, width * height)).toFixed(6)),
		source: 'quick-page-composition',
	};
}

function boxArea(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function moduleInternalPacking(model) {
	const byRef = new Map((model.components || []).map(c => [c.designator, c]));
	const modules = [];
	for (const mod of MODULES) {
		const boxes = mod.refs.map(ref => byRef.get(ref)?.bbox).filter(Boolean);
		if (!boxes.length) continue;
		const outer = {
			minX: Math.min(...boxes.map(b => b.minX)),
			maxX: Math.max(...boxes.map(b => b.maxX)),
			minY: Math.min(...boxes.map(b => b.minY)),
			maxY: Math.max(...boxes.map(b => b.maxY)),
		};
		const outerArea = boxArea(outer);
		const partArea = boxes.reduce((sum, b) => sum + boxArea(b), 0);
		modules.push({
			name: mod.name,
			outerArea: Number(outerArea.toFixed(3)),
			partArea: Number(partArea.toFixed(3)),
			ratio: outerArea > 0 ? Number((partArea / outerArea).toFixed(6)) : 0,
		});
	}
	const minRatio = modules.length ? Number(Math.min(...modules.map(m => m.ratio)).toFixed(6)) : null;
	const outputModules = modules.filter(m => ['pmos', 'relay1', 'relay2'].includes(m.name));
	const minOutputRatio = outputModules.length ? Number(Math.min(...outputModules.map(m => m.ratio)).toFixed(6)) : null;
	return { modules, minRatio, minOutputRatio };
}

export function evaluateLayout(model, snap, opts = {}) {
	const template = validateTemplate(model, snap);
	const failedSheetOutput = {
		pass: false,
		severity: { hard: 1, soft: 0, info: 0 },
		render: { evidence: {} },
		findings: [{ rule: 'SKIP-prerequisite-hard-fail', severity: 'hard', msg: 'Skipped because prerequisite hard gate failed' }],
	};
	const failedDesign = { pass: false, score: 0, stats: {}, dimensions: [] };
	const emptyArchitecture = { pass: false, severity: { hard: 1, soft: 0, info: 0 }, stats: {}, findings: [] };
	const emptyPageComposition = { pass: false, severity: { hard: 1, soft: 0, info: 0 }, stats: {}, metrics: {}, findings: [] };
	const emptySystemIntent = { pass: false, severity: { hard: 1, soft: 0, info: 0 }, stats: {}, findings: [] };
	if (opts.earlyExitHard === true && (template.bySev?.hard || 0) > 0) {
		const structure = { pass: false, severity: { hard: 1, soft: 0, info: 0 }, stats: {}, findings: [] };
		const internalPacking = moduleInternalPacking(model);
		return {
			score: -1_000_000 - (template.bySev.hard * 10_000),
			pass: false,
			template,
			structure,
			architecture: emptyArchitecture,
			pageComposition: emptyPageComposition,
			systemIntent: emptySystemIntent,
			sheetOutput: failedSheetOutput,
			design: failedDesign,
			internalPacking,
		};
	}
	const structureResult = runStructure(model, opts.structureReport || STRUCTURE_REPORT);
	const structure = structureResult.report || { pass: false, severity: { hard: 1, soft: 0, info: 0 } };
	if (opts.earlyExitHard === true && (structure.severity?.hard || 0) > 0) {
		const internalPacking = moduleInternalPacking(model);
		return {
			score: -900_000 - ((structure.severity.hard || 1) * 10_000),
			pass: false,
			template,
			structure,
			architecture: emptyArchitecture,
			pageComposition: emptyPageComposition,
			systemIntent: emptySystemIntent,
			sheetOutput: failedSheetOutput,
			design: failedDesign,
			internalPacking,
		};
	}
	const architecture = auditCommercialArchitecture(model);
	if (opts.earlyExitHard === true && (architecture.severity?.hard || 0) > 0) {
		const internalPacking = moduleInternalPacking(model);
		return {
			score: -800_000 - ((architecture.severity.hard || 1) * 10_000),
			pass: false,
			template,
			structure,
			architecture,
			pageComposition: emptyPageComposition,
			systemIntent: emptySystemIntent,
			sheetOutput: failedSheetOutput,
			design: failedDesign,
			internalPacking,
		};
	}
	const pageComposition = auditPageComposition(model);
	const systemIntent = auditSystemIntent(model);
	let sheetOutput;
	if (opts.quickSheet === true) {
		sheetOutput = {
			pass: true,
			severity: { hard: 0, soft: 0, info: 0 },
			render: {
				evidence: {
					moduleRegions: pageComposition.stats?.modules ?? 0,
					moduleRegionMinGap: pageComposition.stats?.minGap ?? 0,
					moduleRegionNames: (pageComposition.metrics?.moduleBoxes || []).map(m => m.name),
					footprint: quickFootprint(pageComposition),
				},
			},
			findings: [],
		};
	} else {
		const sheetRender = renderSheetOutput(model, opts.sheetImage || SHEET_IMAGE).report;
		sheetOutput = auditSheetOutput(sheetRender, opts.sheetImage || SHEET_IMAGE, {
			minFileBytes: 1,
		});
	}
	const design = autoDesignReview(model, { template, structure, architecture, pageComposition });
	const internalPacking = moduleInternalPacking(model);
	const score = scoreCandidate({ template, structure, architecture, pageComposition, systemIntent, sheetOutput, design, internalPacking });
	return {
		score,
		pass: template.pass && structure.pass && architecture.pass && pageComposition.pass && systemIntent.pass && sheetOutput.pass && design.pass,
		template,
		structure,
		architecture,
		pageComposition,
		systemIntent,
		sheetOutput,
		design,
		internalPacking,
	};
}

function summarizeEvaluation(evaluation) {
	return {
		score: evaluation.score,
		pass: evaluation.pass,
		template: {
			pass: evaluation.template.pass,
			severity: evaluation.template.bySev,
			byRule: Object.fromEntries(evaluation.template.findings.map(f => [f.rule, (evaluation.template.findings.filter(x => x.rule === f.rule).length)])),
		},
		structure: {
			pass: evaluation.structure.pass,
			severity: evaluation.structure.severity,
			minModuleGap: evaluation.structure.minModuleGap,
			moduleWireIntrusions: evaluation.structure.stats?.moduleWireIntrusions ?? 0,
			findings: (evaluation.structure.findings || []).map(f => ({ rule: f.rule, msg: f.msg })),
		},
		architecture: { pass: evaluation.architecture.pass, severity: evaluation.architecture.severity, stats: evaluation.architecture.stats, findings: evaluation.architecture.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		pageComposition: { pass: evaluation.pageComposition.pass, severity: evaluation.pageComposition.severity, stats: evaluation.pageComposition.stats, findings: evaluation.pageComposition.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		fixedImageBounds: geometryBoundsFromPage(evaluation.pageComposition),
		systemIntent: { pass: evaluation.systemIntent.pass, severity: evaluation.systemIntent.severity, stats: evaluation.systemIntent.stats, findings: evaluation.systemIntent.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		sheetOutput: {
			pass: evaluation.sheetOutput.pass,
			severity: evaluation.sheetOutput.severity,
			evidence: evaluation.sheetOutput.render?.evidence,
			findings: evaluation.sheetOutput.findings.map(f => ({ rule: f.rule, msg: f.msg, where: f.where })),
		},
		design: { pass: evaluation.design.pass, score: evaluation.design.score, stats: evaluation.design.stats, dimensions: evaluation.design.dimensions.map(d => ({ id: d.id, pass: d.pass, score: d.score })) },
		internalPacking: evaluation.internalPacking,
	};
}

function chunkEven(items, n) {
	const chunks = Array.from({ length: Math.max(1, n) }, () => []);
	for (let i = 0; i < items.length; i++) chunks[i % chunks.length].push(items[i]);
	return chunks.filter(c => c.length);
}

function runWorker(partLib, anchorsList) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./layout_worker.mjs', import.meta.url), {
			workerData: { partLib, anchorsList },
		});
		worker.once('message', resolve);
		worker.once('error', reject);
		worker.once('exit', code => {
			if (code !== 0) reject(new Error(`layout worker exited with code ${code}`));
		});
	});
}

async function evaluateQuickCandidates(partLib, anchorsList) {
	const workers = Math.min(
		Number(process.env.EASYEDA_LAYOUT_WORKERS || 0) || Math.max(1, Math.min(os.availableParallelism?.() || os.cpus().length || 1, 6)),
		anchorsList.length,
	);
	if (workers <= 1 || process.env.EASYEDA_LAYOUT_WORKERS === '1') {
		const { snap, byDes } = loadPartLib(partLib);
		return anchorsList.map(anchors => {
			const model = assembleFromSnap(byDes, anchors);
			const evaluation = evaluateLayout(model, snap, {
				structureReport: null,
				quickSheet: true,
				earlyExitHard: true,
			});
			return { anchors, ...summarizeEvaluation(evaluation) };
		});
	}
	const chunks = chunkEven(anchorsList, workers);
	const nested = await Promise.all(chunks.map(chunk => runWorker(partLib, chunk)));
	return nested.flat();
}

export async function planLayout(opts = {}) {
	const started = performance.now();
	const { snap, byDes } = loadPartLib(PART_LIB);
	const anchorsList = familyAnchors();
	const maxCandidates = opts.maxCandidates ?? Number(process.env.EASYEDA_LAYOUT_MAX_CANDIDATES ?? DEFAULT_MAX_CANDIDATES);
	const plannedAnchors = maxCandidates > 0 ? anchorsList.slice(0, maxCandidates) : anchorsList;
	const afterAnchors = performance.now();
	const candidates = await evaluateQuickCandidates(PART_LIB, plannedAnchors);
	const afterQuick = performance.now();
	candidates.sort((a, b) => b.score - a.score);
	const finalistCount = opts.finalists ?? Number(process.env.EASYEDA_LAYOUT_FINALISTS || 4);
	const eligible = candidates.filter(c =>
		(c.template?.severity?.hard || 0) === 0 &&
		(c.structure?.severity?.hard || 0) === 0 &&
		(c.architecture?.severity?.hard || 0) === 0 &&
		(c.pageComposition?.severity?.hard || 0) === 0 &&
		(c.systemIntent?.severity?.hard || 0) === 0 &&
		c.design?.pass === true
	);
	const finalistPool = eligible.length ? eligible : candidates;
	const finalists = finalistPool.slice(0, finalistCount).map(candidate => {
		const model = assembleFromSnap(byDes, candidate.anchors);
		const finalEvaluation = evaluateLayout(model, snap, {
			sheetImage: opts.sheetImage || SHEET_IMAGE,
			structureReport: opts.structureReport || STRUCTURE_REPORT,
			quickSheet: false,
		});
		return {
			anchors: candidate.anchors,
			quickScore: candidate.score,
			...summarizeEvaluation(finalEvaluation),
		};
	}).sort((a, b) => b.score - a.score);
	const afterFinalists = performance.now();
	const best = finalists[0];
	const bestModel = assembleFromSnap(byDes, best.anchors);
	const modelOut = opts.modelOut || OUT_MODEL;
	const reportOut = opts.reportOut || OUT_REPORT;
	writeFileSync(modelOut, JSON.stringify(bestModel, null, 2), 'utf8');
	const report = {
		generatedAt: new Date().toISOString(),
		best,
		top: finalists.slice(0, 12),
		quickTop: candidates.slice(0, 12),
		totalCandidates: candidates.length,
		availableCandidates: anchorsList.length,
		maxCandidates,
		finalists: finalists.length,
		timingMs: {
			total: Math.round(performance.now() - started),
			anchors: Math.round(afterAnchors - started),
			quick: Math.round(afterQuick - afterAnchors),
			finalists: Math.round(afterFinalists - afterQuick),
		},
		model: modelOut,
	};
	writeFileSync(reportOut, JSON.stringify(report, null, 2), 'utf8');
	return report;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const report = await planLayout();
	console.log(`layout planner -> ${OUT_REPORT}`);
	console.log(`best score=${report.best.score} pass=${report.best.pass} design=${report.best.design.score} archHard=${report.best.architecture.severity.hard} labelOnly=${report.best.architecture.stats.labelOnlyInterfaces} moduleRegions=${report.best.sheetOutput.evidence?.moduleRegions ?? '?'}`);
	process.exit(report.best.pass ? 0 : 1);
}
