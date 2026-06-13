import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel } from '../harness/model.mjs';
import { loadProjectModuleRegistry } from '../harness/module_registry.mjs';
import { rectsGap, round2, segIntersectsRect, shrinkRect } from '../harness/model.mjs';
import { CONFIG } from '../harness/config.mjs';
import { rawWireStats } from '../harness/raw_wire_quality.mjs';

const SNAP = process.argv[2] || 'full_model.json';
const OUT = process.argv[3] || 'structure_metrics.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function boxOf(parts, refs, margin = 0) {
	const hit = refs.map(r => parts.get(r)).filter(Boolean);
	if (!hit.length) return null;
	const boxes = hit.map(p => p.bodyBBox || p.bbox);
	return {
		minX: Math.min(...boxes.map(b => b.minX)) - margin,
		maxX: Math.max(...boxes.map(b => b.maxX)) + margin,
		minY: Math.min(...boxes.map(b => b.minY)) - margin,
		maxY: Math.max(...boxes.map(b => b.maxY)) + margin,
	};
}

function center(b) {
	return { x: round2((b.minX + b.maxX) / 2), y: round2((b.minY + b.maxY) / 2) };
}

function partCenter(p) {
	const b = p?.bodyBBox || p?.bbox;
	return b ? center(b) : null;
}

function spanOverlapRatio(a0, a1, b0, b1) {
	const overlap = Math.min(a1, b1) - Math.max(a0, b0);
	if (overlap <= 0) return 0;
	return overlap / Math.max(1, Math.min(a1 - a0, b1 - b0));
}

function axisCorridor(aBox, bBox) {
	const xGap = Math.max(bBox.minX - aBox.maxX, aBox.minX - bBox.maxX);
	const yGap = Math.max(bBox.minY - aBox.maxY, aBox.minY - bBox.maxY);
	return Math.max(xGap, yGap);
}

function rectArea(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function moduleSizeDelta(a, b) {
	return {
		width: round2(Math.abs(a.width - b.width)),
		height: round2(Math.abs(a.height - b.height)),
		area: round2(Math.abs(a.area - b.area)),
	};
}

function inRectInclusive(x, y, r) {
	return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

function segKey(s) {
	const a = `${s.x1},${s.y1}`;
	const b = `${s.x2},${s.y2}`;
	return [a, b].sort().join('|');
}

export function computeStructureMetricsFromSnapshot(snap) {
const model = buildModel(snap);
const registry = loadProjectModuleRegistry();
const activeModules = registry.modules;
const activeRepeatedGroups = registry.repeatedGroups;
const POWER_NETS = new Set(['GND', 'SYS_3V3', 'SYS_5V', 'VIN_12_19V', 'VOUT_SW']);
const rawWire = rawWireStats(model.rawWires || []);
const parts = new Map(model.parts.map(p => [p.designator, p]));
const modules = activeModules.map(mod => {
	const box = boxOf(parts, mod.refs, 12);
	const laneBox = boxOf(parts, mod.refs, CONFIG.module?.interlockMargin ?? 0);
	if (!box) return null;
	const w = box.maxX - box.minX;
	const h = box.maxY - box.minY;
	return {
		name: mod.name,
		role: mod.role,
		refs: mod.refs,
		center: center(box),
		box,
		laneBox: laneBox || box,
		width: round2(w),
		height: round2(h),
		area: round2(w * h),
		aspect: round2(Math.max(w / Math.max(1, h), h / Math.max(1, w))),
	};
}).filter(Boolean);
const modulesByName = Object.fromEntries(modules.map(m => [m.name, m]));
const centersByName = Object.fromEntries(modules.map(m => [m.name, m.center]));

const moduleAreaBudgets = modules.map(m => ({
	module: m.name,
	area: m.area,
	maxArea: CONFIG.reference?.maxModuleArea?.[m.name] ?? 115000,
	pass: m.area <= (CONFIG.reference?.maxModuleArea?.[m.name] ?? 115000),
}));
const moduleAspectBudgets = modules.map(m => ({
	module: m.name,
	aspect: m.aspect,
	maxAspect: CONFIG.reference?.maxModuleAspect?.[m.name] ?? 3.2,
	pass: m.aspect <= (CONFIG.reference?.maxModuleAspect?.[m.name] ?? 3.2),
}));
const inputColumnSkew = centersByName.usb && centersByName.ldo ? round2(Math.abs(centersByName.usb.x - centersByName.ldo.x)) : null;
const outputSubcolumnGap = centersByName.pmos && centersByName.relay1 ? round2(Math.abs(centersByName.relay1.x - centersByName.pmos.x)) : null;
const relaySizeDelta = modulesByName.relay1 && modulesByName.relay2 ? moduleSizeDelta(modulesByName.relay1, modulesByName.relay2) : null;
const buttonRowDelta = centersByName.btn1 && centersByName.btn2 ? round2(Math.abs(centersByName.btn1.y - centersByName.btn2.y)) : null;
const storyGaps = centersByName.usb && centersByName.ldo && centersByName.mcu && centersByName.pmos && centersByName.relay1 ? {
	inputToMcu: round2(centersByName.mcu.x - Math.max(centersByName.usb.x, centersByName.ldo.x)),
	mcuToPmos: round2(centersByName.pmos.x - centersByName.mcu.x),
	pmosToRelay: round2(centersByName.relay1.x - centersByName.pmos.x),
} : null;
const layoutDiscipline = {
	moduleAreaBudgets,
	moduleAspectBudgets,
	inputColumnSkew,
	maxInputColumnSkew: CONFIG.reference?.maxInputColumnSkew ?? 140,
	outputSubcolumnGap,
	minOutputSubcolumnGap: CONFIG.reference?.minOutputSubcolumnGap ?? 250,
	maxOutputSubcolumnGap: CONFIG.reference?.maxOutputSubcolumnGap ?? 460,
	relaySizeDelta,
	maxRepeatedSizeDelta: 10,
	buttonRowDelta,
	maxButtonRowDelta: 35,
	storyGaps,
};

const gaps = [];
const laneInterlocks = [];
for (let i = 0; i < modules.length; i++) {
	for (let j = i + 1; j < modules.length; j++) {
		const a = modules[i];
		const b = modules[j];
		gaps.push({ a: a.name, b: b.name, gap: rectsGap(a.box, b.box) });
		const axSep = a.laneBox.maxX <= b.laneBox.minX || b.laneBox.maxX <= a.laneBox.minX;
		const aySep = a.laneBox.maxY <= b.laneBox.minY || b.laneBox.maxY <= a.laneBox.minY;
		const xSeparation = Math.max(b.laneBox.minX - a.laneBox.maxX, a.laneBox.minX - b.laneBox.maxX);
		const ySeparation = Math.max(b.laneBox.minY - a.laneBox.maxY, a.laneBox.minY - b.laneBox.maxY);
		const xRatio = spanOverlapRatio(a.laneBox.minX, a.laneBox.maxX, b.laneBox.minX, b.laneBox.maxX);
		const yRatio = spanOverlapRatio(a.laneBox.minY, a.laneBox.maxY, b.laneBox.minY, b.laneBox.maxY);
		const maxSeparation = CONFIG.module?.interlockMaxSeparation ?? 180;
		const partialMin = CONFIG.module?.interlockPartialMin ?? 0.2;
		const partialMax = CONFIG.module?.interlockPartialMax ?? 0.75;
		if ((axSep && xSeparation <= maxSeparation && yRatio >= partialMin && yRatio <= partialMax)
			|| (aySep && ySeparation <= maxSeparation && xRatio >= partialMin && xRatio <= partialMax)) {
			laneInterlocks.push({ a: a.name, b: b.name, xOverlapRatio: round2(xRatio), yOverlapRatio: round2(yRatio), xSeparation: round2(xSeparation), ySeparation: round2(ySeparation), aBox: a.laneBox, bBox: b.laneBox });
		}
	}
}

const repeated = [];
for (const group of activeRepeatedGroups) {
	const namedModules = Object.fromEntries(modules.map(m => [m.name, m]));
	const [aModuleName, bModuleName] = group.modules || [];
	const aModule = namedModules[aModuleName];
	const bModule = namedModules[bModuleName];
	const minCorridor = group.minCorridor ?? CONFIG.reference?.minRepeatedModuleCorridor ?? 90;
	const corridor = aModule && bModule ? round2(axisCorridor(aModule.laneBox || aModule.box, bModule.laneBox || bModule.box)) : null;
	const roleDeltas = [];
	for (const [aRef, bRef] of group.roleMap || []) {
		const ac = partCenter(parts.get(aRef));
		const bc = partCenter(parts.get(bRef));
		if (!ac || !bc) continue;
		roleDeltas.push({ refs: [aRef, bRef], dx: round2(bc.x - ac.x), dy: round2(bc.y - ac.y) });
	}
	const anchorRelative = [];
	for (const role of group.anchorRoleMap || []) {
		const [aAnchorRef, bAnchorRef] = role.anchors || [];
		const [aRef, bRef] = role.refs || [];
		const aa = partCenter(parts.get(aAnchorRef));
		const ba = partCenter(parts.get(bAnchorRef));
		const ac = partCenter(parts.get(aRef));
		const bc = partCenter(parts.get(bRef));
		if (!aa || !ba || !ac || !bc) continue;
		anchorRelative.push({
			role: role.role || `${aRef}/${bRef}`,
			anchors: [aAnchorRef, bAnchorRef],
			refs: [aRef, bRef],
			a: { dx: round2(ac.x - aa.x), dy: round2(ac.y - aa.y) },
			b: { dx: round2(bc.x - ba.x), dy: round2(bc.y - ba.y) },
		});
	}
	repeated.push({ name: group.name, modules: group.modules, corridor, minCorridor, corridorPass: corridor == null ? null : corridor >= minCorridor, roleDeltas, anchorRelative });
}

const normalizedSegments = [];
for (const s of model.segments || []) {
	if (Math.abs(s.x1 - s.x2) > 1e-6 && Math.abs(s.y1 - s.y2) > 1e-6) {
		continue;
	}
	normalizedSegments.push(s);
}

const longSegments = normalizedSegments
	.filter(s => s.len >= (CONFIG.structureGate?.longSegmentMinLen ?? 180))
	.map(s => ({ net: s.net || '', len: s.len, seg: [s.x1, s.y1, s.x2, s.y2] }))
	.sort((a, b) => b.len - a.len);

const shortMax = CONFIG.structureGate?.shortSegmentMaxLen ?? 80;
const veryLongMin = CONFIG.structureGate?.veryLongSegmentMinLen ?? 250;
const shortSegments = normalizedSegments.filter(s => s.len <= shortMax);
const mcuInterfaceNets = new Set((CONFIG.mcuInterface?.leftSignals || []).map(x => x.net));
const u1 = parts.get('U1');
const u1Box = u1?.bodyBBox || u1?.bbox || null;
function isApprovedMcuInterfaceStub(s) {
	if (!u1Box || !mcuInterfaceNets.has(s.net || '')) return false;
	if (Math.abs(s.y1 - s.y2) > 1e-6) return false;
	const minX = Math.min(s.x1, s.x2);
	const maxX = Math.max(s.x1, s.x2);
	const maxLen = CONFIG.mcuInterface?.maxLabelStubLeftOfMcu ?? 160;
	const minY = u1Box.minY - (CONFIG.mcuInterface?.maxLabelLaneYMargin ?? 80);
	const maxY = u1Box.maxY + (CONFIG.mcuInterface?.maxLabelLaneYMargin ?? 80);
	return maxX <= u1Box.minX + 25
		&& minX >= u1Box.minX - maxLen - 20
		&& s.y1 >= minY
		&& s.y1 <= maxY
		&& s.len <= maxLen + 20;
}
const reviewExcludedSegments = normalizedSegments.filter(isApprovedMcuInterfaceStub);
const reviewSegments = normalizedSegments.filter(s => !isApprovedMcuInterfaceStub(s));
const reviewShortSegments = reviewSegments.filter(s => s.len <= shortMax);
const veryLongSegments = normalizedSegments
	.filter(s => s.len >= veryLongMin && !POWER_NETS.has(s.net || ''))
	.map(s => ({ net: s.net || '', len: s.len, seg: [s.x1, s.y1, s.x2, s.y2] }))
	.sort((a, b) => b.len - a.len);

const moduleWireIntrusions = [];
const segmentModules = new Map();
for (const g of model.groups || []) {
	const owners = new Set((g.pins || []).map(pin => {
		const mod = activeModules.find(m => m.refs.includes(pin.designator));
		return mod?.name;
	}).filter(Boolean));
	for (const s of g.segs || []) segmentModules.set(segKey(s), owners);
}
for (const s of normalizedSegments) {
	const servedModules = segmentModules.get(segKey(s)) || new Set();
	for (const mod of modules) {
		if (servedModules.has(mod.name)) continue;
		const inner = shrinkRect(mod.box, CONFIG.module?.wireBoxShrink ?? 8);
		if (inner.maxX <= inner.minX || inner.maxY <= inner.minY) continue;
		if (segIntersectsRect(s, inner)) {
			moduleWireIntrusions.push({
				module: mod.name,
				net: s.net || '',
				len: s.len,
				seg: [s.x1, s.y1, s.x2, s.y2],
				box: inner,
			});
		}
	}
}

const shortSegmentRatio = normalizedSegments.length ? round2(shortSegments.length / normalizedSegments.length) : 1;
const reviewShortSegmentRatio = reviewSegments.length ? round2(reviewShortSegments.length / reviewSegments.length) : 1;
const findings = [];
if (reviewShortSegmentRatio < (CONFIG.structureGate?.minShortSegmentRatio ?? 0.88)) {
	findings.push({
		rule: 'S1-short-segment-ratio',
		severity: 'hard',
		category: 'structure',
		msg: `Review short segment ratio ${reviewShortSegmentRatio} below ${CONFIG.structureGate.minShortSegmentRatio}`,
		where: {
			shortSegments: reviewShortSegments.length,
			totalSegments: reviewSegments.length,
			rawShortSegments: shortSegments.length,
			rawTotalSegments: normalizedSegments.length,
			excludedApprovedInterfaceStubs: reviewExcludedSegments.map(s => ({ net: s.net || '', len: s.len, seg: [s.x1, s.y1, s.x2, s.y2] })),
			shortMax,
		},
	});
}
if (longSegments.length > (CONFIG.structureGate?.maxLongSegments ?? 4)) {
	findings.push({
		rule: 'S2-long-segment-budget',
		severity: 'hard',
		category: 'structure',
		msg: `Too many long segments: ${longSegments.length} > ${CONFIG.structureGate.maxLongSegments}`,
		where: { longSegments },
	});
}
if (veryLongSegments.length > (CONFIG.structureGate?.maxVeryLongSegments ?? 0)) {
	findings.push({
		rule: 'S3-very-long-segment',
		severity: 'hard',
		category: 'structure',
		msg: `Very long segments are not allowed: ${veryLongSegments.length}`,
		where: { veryLongSegments },
	});
}
const minGap = gaps.length ? Math.min(...gaps.map(g => g.gap)) : null;
if (minGap != null && minGap < (CONFIG.structureGate?.minModuleGap ?? 60)) {
	findings.push({
		rule: 'S4-module-gap-budget',
		severity: 'hard',
		category: 'structure',
		msg: `Minimum module gap ${minGap} below ${CONFIG.structureGate.minModuleGap}`,
		where: { minGap, gaps: gaps.sort((a, b) => a.gap - b.gap).slice(0, 5) },
	});
}
if (laneInterlocks.length > 0) {
	findings.push({
		rule: 'S5-module-lane-interlock',
		severity: 'hard',
		category: 'structure',
		msg: `Module boxes have partial lane interlocks: ${laneInterlocks.length}`,
		where: { laneInterlocks },
	});
}
if (moduleWireIntrusions.length > (CONFIG.structureGate?.maxModuleWireIntrusions ?? 0)) {
	findings.push({
		rule: 'S8-module-wire-intrusion',
		severity: 'hard',
		category: 'structure',
		msg: `Wires intrude into unrelated module spaces: ${moduleWireIntrusions.length}`,
		where: { intrusions: moduleWireIntrusions.slice(0, 12) },
	});
}
const areaBudgetFailures = moduleAreaBudgets.filter(x => !x.pass);
if (areaBudgetFailures.length > 0) {
	findings.push({
		rule: 'S9-module-area-budget',
		severity: 'hard',
		category: 'structure',
		msg: `Module review rectangles are too large or sprawled: ${areaBudgetFailures.length}`,
		where: { modules: areaBudgetFailures },
	});
}
const aspectBudgetFailures = moduleAspectBudgets.filter(x => !x.pass);
if (aspectBudgetFailures.length > 0) {
	findings.push({
		rule: 'S10-module-aspect-budget',
		severity: 'hard',
		category: 'structure',
		msg: `Module review rectangles have non-reference aspect ratios: ${aspectBudgetFailures.length}`,
		where: { modules: aspectBudgetFailures },
	});
}
if (inputColumnSkew != null && inputColumnSkew > layoutDiscipline.maxInputColumnSkew) {
	findings.push({
		rule: 'S11-input-column-alignment',
		severity: 'hard',
		category: 'structure',
		msg: `USB and LDO input/power column skew is too large: ${inputColumnSkew} > ${layoutDiscipline.maxInputColumnSkew}`,
		where: { inputColumnSkew, maxInputColumnSkew: layoutDiscipline.maxInputColumnSkew, usb: modulesByName.usb?.box, ldo: modulesByName.ldo?.box },
	});
}
if (outputSubcolumnGap != null && (outputSubcolumnGap < layoutDiscipline.minOutputSubcolumnGap || outputSubcolumnGap > layoutDiscipline.maxOutputSubcolumnGap)) {
	findings.push({
		rule: 'S12-output-subcolumn-spacing',
		severity: 'hard',
		category: 'structure',
		msg: `PMOS and relay output subcolumns are outside the readable spacing range: ${outputSubcolumnGap}`,
		where: {
			outputSubcolumnGap,
			minOutputSubcolumnGap: layoutDiscipline.minOutputSubcolumnGap,
			maxOutputSubcolumnGap: layoutDiscipline.maxOutputSubcolumnGap,
			pmos: modulesByName.pmos?.box,
			relay1: modulesByName.relay1?.box,
		},
	});
}
if (relaySizeDelta && (relaySizeDelta.width > layoutDiscipline.maxRepeatedSizeDelta || relaySizeDelta.height > layoutDiscipline.maxRepeatedSizeDelta)) {
	findings.push({
		rule: 'S13-repeated-module-shape',
		severity: 'hard',
		category: 'structure',
		msg: 'Repeated relay modules must keep matching review rectangle geometry',
		where: { relaySizeDelta, maxRepeatedSizeDelta: layoutDiscipline.maxRepeatedSizeDelta, relay1: modulesByName.relay1?.box, relay2: modulesByName.relay2?.box },
	});
}
if (buttonRowDelta != null && buttonRowDelta > layoutDiscipline.maxButtonRowDelta) {
	findings.push({
		rule: 'S14-support-row-alignment',
		severity: 'hard',
		category: 'structure',
		msg: `RESET and BOOT support modules must form a clean row: ${buttonRowDelta} > ${layoutDiscipline.maxButtonRowDelta}`,
		where: { buttonRowDelta, maxButtonRowDelta: layoutDiscipline.maxButtonRowDelta, btn1: modulesByName.btn1?.box, btn2: modulesByName.btn2?.box },
	});
}
if (storyGaps && (storyGaps.inputToMcu <= 0 || storyGaps.mcuToPmos <= 0 || storyGaps.pmosToRelay <= 0)) {
	findings.push({
		rule: 'S15-left-to-right-story',
		severity: 'hard',
		category: 'structure',
		msg: 'Functional columns must read left-to-right: input/power -> controller -> switched/output loads',
		where: { storyGaps, centers: centersByName },
	});
}
const repeatedCorridorFailures = repeated.filter(r => r.corridor != null && r.corridor < r.minCorridor);
if (repeatedCorridorFailures.length > 0) {
	findings.push({
		rule: 'S7-repeated-module-corridor',
		severity: 'hard',
		category: 'structure',
		msg: `Repeated module corridors are too tight: ${repeatedCorridorFailures.length}`,
		where: { repeated: repeatedCorridorFailures },
	});
}
if (!rawWire.pass) {
	findings.push({
		rule: 'S6-raw-wire-primitive-quality',
		severity: 'hard',
		category: 'structure',
		msg: 'Raw wire primitives contain zero/duplicate/diagonal or over-complex geometry',
		where: {
			zeroSegments: rawWire.zeroSegments,
			duplicateSegments: rawWire.duplicateSegments,
			duplicatePoints: rawWire.duplicatePoints,
			diagonalSegments: rawWire.diagonalSegments,
			overComplexPrimitives: rawWire.overComplexPrimitives,
			overSharedPointPrimitives: rawWire.overSharedPointPrimitives,
			overBranchedPairPrimitives: rawWire.overBranchedPairPrimitives,
			pairBranchPoints: rawWire.pairBranchPoints,
			maxPrimitiveSegments: rawWire.maxPrimitiveSegments,
			maxPairSegments: rawWire.maxPairSegments,
			maxDuplicatePoints: rawWire.maxDuplicatePoints,
			maxPairBranchPoints: rawWire.maxPairBranchPoints,
			offenders: rawWire.offenders.slice(0, 10),
		},
	});
}

const bySev = { hard: 0, soft: 0, info: 0 };
for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;

const report = {
	generatedAt: new Date().toISOString(),
	project: model.project,
	moduleRegistry: {
		source: registry.source,
		modules: activeModules.length,
		repeatedGroups: activeRepeatedGroups.length,
	},
	stats: {
		parts: model.parts.length,
		segments: normalizedSegments.length,
		netflags: model.netflags.length,
		wireGroups: model.groups.length,
		ignoredNonOrthogonalMergedSegments: (model.segments || []).length - normalizedSegments.length,
		shortSegments: shortSegments.length,
		reviewSegments: reviewSegments.length,
		reviewShortSegments: reviewShortSegments.length,
		reviewExcludedApprovedInterfaceStubs: reviewExcludedSegments.length,
		longSegments: longSegments.length,
		veryLongSegments: veryLongSegments.length,
		moduleWireIntrusions: moduleWireIntrusions.length,
		shortSegmentRatio,
		reviewShortSegmentRatio,
		layoutDiscipline,
		rawWire: {
			wireCount: rawWire.wireCount,
			zeroSegments: rawWire.zeroSegments,
			duplicateSegments: rawWire.duplicateSegments,
			duplicatePoints: rawWire.duplicatePoints,
			diagonalSegments: rawWire.diagonalSegments,
			overComplexPrimitives: rawWire.overComplexPrimitives,
			overSharedPointPrimitives: rawWire.overSharedPointPrimitives,
			overBranchedPairPrimitives: rawWire.overBranchedPairPrimitives,
			pairBranchPoints: rawWire.pairBranchPoints,
			maxPrimitiveSegments: rawWire.maxPrimitiveSegments,
			maxPairSegments: rawWire.maxPairSegments,
			maxDuplicatePoints: rawWire.maxDuplicatePoints,
			maxPairBranchPoints: rawWire.maxPairBranchPoints,
		},
	},
	modules,
	minModuleGap: minGap,
	gaps: gaps.sort((a, b) => a.gap - b.gap).slice(0, 12),
	laneInterlocks,
	moduleWireIntrusions: moduleWireIntrusions.slice(0, 20),
	repeated,
	longSegments,
	veryLongSegments,
	findings,
	severity: bySev,
	pass: bySev.hard === 0 && bySev.soft === 0 && bySev.info === 0,
};

return report;
}

export function runStructureMetricsFile(snapPath = SNAP, outPath = OUT) {
	const snap = readJson(snapPath);
	const report = computeStructureMetricsFromSnapshot(snap);
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	return report;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const report = runStructureMetricsFile(SNAP, OUT);
	console.log(`structure metrics -> ${OUT}`);
	console.log(`modules=${report.modules.length} minGap=${report.minModuleGap} shortRatio=${report.stats.shortSegmentRatio} longSegments=${report.longSegments.length} pass=${report.pass}`);
	process.exit(report.pass ? 0 : 1);
}
