import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel, rectsGap, round2 } from '../harness/model.mjs';
import { MODULES } from '../harness/module_registry.mjs';
import { CONFIG } from '../harness/config.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_OUT = DIR + 'page_composition_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function boxOf(parts, refs, margin = 12) {
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

function center(box) {
	return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
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

function boxSize(box) {
	return { width: box.maxX - box.minX, height: box.maxY - box.minY };
}

function spanOverlap(a0, a1, b0, b1) {
	return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'page-composition', msg, where });
}

function sizeDelta(a, b) {
	const as = boxSize(a);
	const bs = boxSize(b);
	return {
		width: round2(Math.abs(as.width - bs.width)),
		height: round2(Math.abs(as.height - bs.height)),
	};
}

function orderedByX(...items) {
	for (let i = 1; i < items.length; i++) {
		if (!items[i - 1] || !items[i]) continue;
		if (center(items[i - 1].box).x >= center(items[i].box).x) return false;
	}
	return true;
}

function moduleRows(modules, tolerance = 95) {
	const rows = [];
	for (const mod of [...modules].sort((a, b) => center(b.box).y - center(a.box).y)) {
		const c = center(mod.box);
		const row = rows.find(r => Math.abs(r.y - c.y) <= tolerance);
		if (row) {
			row.modules.push(mod.name);
			row.y = row.modules.reduce((sum, name) => sum + center(modules.find(m => m.name === name).box).y, 0) / row.modules.length;
		} else {
			rows.push({ y: c.y, modules: [mod.name] });
		}
	}
	return rows.map(r => ({ y: round2(r.y), modules: r.modules.sort() }));
}

export function auditPageComposition(snap, opts = {}) {
	const model = buildModel(snap);
	const findings = [];
	const parts = new Map(model.parts.map(p => [p.designator, p]));
	const modules = MODULES.map(mod => ({ ...mod, box: boxOf(parts, mod.refs, opts.moduleMargin ?? 12) })).filter(m => m.box);
	const byName = Object.fromEntries(modules.map(m => [m.name, m]));
	const contentBox = union(modules.map(m => m.box));
	const outputBox = union([byName.pmos?.box, byName.relay1?.box, byName.relay2?.box]);
	const supportBox = union([byName.btn1?.box, byName.btn2?.box]);
	const inputBox = union([byName.usb?.box, byName.ldo?.box]);

	const minGap = modules.length > 1
		? Math.min(...modules.flatMap((a, i) => modules.slice(i + 1).map(b => rectsGap(a.box, b.box))))
		: null;

	const inputSpread = byName.usb && byName.ldo ? Math.abs(center(byName.usb.box).y - center(byName.ldo.box).y) : null;
	const inputColumnSkew = byName.usb && byName.ldo ? Math.abs(center(byName.usb.box).x - center(byName.ldo.box).x) : null;
	const maxInputSpread = opts.maxInputSpread ?? 230;
	const maxInputColumnSkew = opts.maxInputColumnSkew ?? 130;
	if (inputSpread != null && inputSpread > maxInputSpread) {
		hard(findings, 'P1-input-power-column',
			`USB input and LDO power must read as one compact input/power column: ${round2(inputSpread)} > ${maxInputSpread}`,
			{ usb: byName.usb.box, ldo: byName.ldo.box, inputSpread: round2(inputSpread), maxInputSpread });
	}
	if (inputColumnSkew != null && inputColumnSkew > maxInputColumnSkew) {
		hard(findings, 'P2-input-power-x-alignment',
			`USB input and LDO power column x-skew is too large: ${round2(inputColumnSkew)} > ${maxInputColumnSkew}`,
			{ inputColumnSkew: round2(inputColumnSkew), maxInputColumnSkew });
	}

	const supportToMcu = supportBox && byName.mcu
		? Math.max(0, byName.mcu.box.minY - supportBox.maxY, supportBox.minY - byName.mcu.box.maxY)
		: null;
	const maxSupportToMcuGap = opts.maxSupportToMcuGap ?? 150;
	if (supportToMcu != null && supportToMcu > maxSupportToMcuGap) {
		hard(findings, 'P3-support-near-controller',
			`Reset/boot support row is too detached from the MCU: ${round2(supportToMcu)} > ${maxSupportToMcuGap}`,
			{ supportBox, mcu: byName.mcu.box, supportToMcu: round2(supportToMcu), maxSupportToMcuGap });
	}

	const outputSize = outputBox ? boxSize(outputBox) : null;
	let outputStack = null;
	const maxOutputHeight = opts.maxOutputHeight ?? 520;
	if (outputSize && outputSize.height > maxOutputHeight) {
		hard(findings, 'P4-output-band-height',
			`Output modules should form a compact output band instead of a tall stack: ${round2(outputSize.height)} > ${maxOutputHeight}`,
			{ outputBox, outputHeight: round2(outputSize.height), maxOutputHeight });
	}
	if (byName.relay1 && byName.relay2) {
		const r1 = byName.relay1.box;
		const r2 = byName.relay2.box;
		const r1c = center(r1);
		const r2c = center(r2);
		const xDelta = Math.abs(r1c.x - r2c.x);
		const delta = sizeDelta(r1, r2);
		const gap = Math.max(0, Math.max(r2.minY - r1.maxY, r1.minY - r2.maxY));
		const maxXDelta = opts.maxOutputStackXDelta ?? 35;
		const maxSizeDelta = opts.maxOutputStackSizeDelta ?? 10;
		const minGap = opts.minOutputStackGap ?? (CONFIG.reference?.minRepeatedVerticalCorridor ?? 90);
		outputStack = {
			xDelta: round2(xDelta),
			sizeDelta: delta,
			gap: round2(gap),
			maxXDelta,
			maxSizeDelta,
			minGap,
		};
		if (xDelta > maxXDelta || delta.width > maxSizeDelta || delta.height > maxSizeDelta || gap < minGap) {
			hard(findings, 'P8-output-stack-rhythm',
				'repeated relay outputs must form one aligned, equally sized, whitespace-separated output stack',
				{ relay1: r1, relay2: r2, ...outputStack });
		}
	}
	let supportRow = null;
	if (byName.btn1 && byName.btn2 && byName.mcu) {
		const b1 = byName.btn1.box;
		const b2 = byName.btn2.box;
		const mc = byName.mcu.box;
		const b1c = center(b1);
		const b2c = center(b2);
		const mcc = center(mc);
		const yDelta = Math.abs(b1c.y - b2c.y);
		const rowGap = Math.max(0, Math.max(b2.minX - b1.maxX, b1.minX - b2.maxX));
		const belowMcu = Math.max(0, mc.minY - Math.max(b1.maxY, b2.maxY));
		const rowCenterX = (b1c.x + b2c.x) / 2;
		const maxYDelta = opts.maxSupportRowYDelta ?? 35;
		const minRowGap = opts.minSupportRowGap ?? 90;
		const minBelowMcu = opts.minSupportBelowMcu ?? 80;
		const maxRowCenterSkew = opts.maxSupportRowCenterSkew ?? 190;
		supportRow = {
			yDelta: round2(yDelta),
			rowGap: round2(rowGap),
			belowMcu: round2(belowMcu),
			rowCenterSkew: round2(Math.abs(rowCenterX - mcc.x)),
			maxYDelta,
			minRowGap,
			minBelowMcu,
			maxRowCenterSkew,
		};
		if (yDelta > maxYDelta || rowGap < minRowGap || belowMcu < minBelowMcu || Math.abs(rowCenterX - mcc.x) > maxRowCenterSkew) {
			hard(findings, 'P9-support-row-rhythm',
				'RESET and BOOT support modules must read as one aligned support row below the MCU',
				{ btn1: b1, btn2: b2, mcu: mc, ...supportRow });
		}
	}

	if (contentBox) {
		const contentSize = boxSize(contentBox);
		const aspect = contentSize.width / Math.max(1, contentSize.height);
		const minAspect = opts.minContentAspect ?? 1.45;
		const maxAspect = opts.maxContentAspect ?? 2.35;
		if (aspect < minAspect || aspect > maxAspect) {
			hard(findings, 'P5-page-aspect-balance',
				`Module bounding page aspect is outside the reference-readable range: ${round2(aspect)} not in [${minAspect}, ${maxAspect}]`,
				{ contentBox, aspect: round2(aspect), minAspect, maxAspect });
		}
	}

	if (byName.usb && byName.ldo && byName.mcu && byName.pmos && byName.relay1) {
		if (!orderedByX(inputBox ? { box: inputBox } : byName.usb, byName.mcu, byName.pmos, byName.relay1)) {
			hard(findings, 'P6-left-to-right-story',
				'Functional columns must read left-to-right as input/power, controller, output/load.',
				{ inputBox, mcu: byName.mcu.box, pmos: byName.pmos.box, relay1: byName.relay1.box });
		}
	}

	const moduleOverlapFindings = [];
	for (let i = 0; i < modules.length; i++) {
		for (let j = i + 1; j < modules.length; j++) {
			const a = modules[i], b = modules[j];
			const xo = spanOverlap(a.box.minX, a.box.maxX, b.box.minX, b.box.maxX);
			const yo = spanOverlap(a.box.minY, a.box.maxY, b.box.minY, b.box.maxY);
			if (xo > 0 && yo > 0) moduleOverlapFindings.push({ a: a.name, b: b.name, xOverlap: round2(xo), yOverlap: round2(yo) });
		}
	}
	if (moduleOverlapFindings.length) {
		hard(findings, 'P7-module-box-overlap',
			`Functional module rectangles overlap: ${moduleOverlapFindings.length}`,
			{ overlaps: moduleOverlapFindings });
	}

	const rows = moduleRows(modules);
	const severity = { hard: findings.length, soft: 0, info: 0 };
	return {
		generatedAt: new Date().toISOString(),
		pass: severity.hard === 0 && severity.soft === 0 && severity.info === 0,
		severity,
		stats: {
			modules: modules.length,
			minGap,
			inputSpread: inputSpread == null ? null : round2(inputSpread),
			inputColumnSkew: inputColumnSkew == null ? null : round2(inputColumnSkew),
			supportToMcu: supportToMcu == null ? null : round2(supportToMcu),
			outputHeight: outputSize ? round2(outputSize.height) : null,
			outputStack,
			supportRow,
			contentAspect: contentBox ? round2(boxSize(contentBox).width / Math.max(1, boxSize(contentBox).height)) : null,
			rows,
		},
		metrics: {
			moduleBoxes: modules.map(m => ({ name: m.name, role: m.role, box: m.box })),
			inputBox,
			supportBox,
			outputBox,
			contentBox,
		},
		findings,
	};
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const snapPath = process.argv[2] || 'full_model.json';
	const outPath = process.argv[3] || DEFAULT_OUT;
	const report = auditPageComposition(readJson(snapPath));
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`page composition -> ${outPath}`);
	console.log(`inputSpread=${report.stats.inputSpread} supportGap=${report.stats.supportToMcu} outputHeight=${report.stats.outputHeight} pass=${report.pass}`);
	if (report.findings.length) {
		for (const f of report.findings.slice(0, 12)) console.log(`  [${f.severity}] ${f.rule}: ${f.msg}`);
	}
	process.exit(report.pass ? 0 : 1);
}
