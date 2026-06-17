import { CONFIG } from '../config.mjs';
import { round2 } from '../model.mjs';
import { loadProjectModuleRegistry } from '../module_registry.mjs';

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

function areaOfBox(b) {
	return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
}

function internalPacking(parts, refs) {
	const hit = refs.map(r => parts.get(r)).filter(Boolean);
	if (!hit.length) return null;
	const boxes = hit.map(p => p.bbox).filter(Boolean);
	if (!boxes.length) return null;
	const outer = {
		minX: Math.min(...boxes.map(b => b.minX)),
		maxX: Math.max(...boxes.map(b => b.maxX)),
		minY: Math.min(...boxes.map(b => b.minY)),
		maxY: Math.max(...boxes.map(b => b.maxY)),
	};
	const outerArea = areaOfBox(outer);
	const partArea = boxes.reduce((sum, b) => sum + areaOfBox(b), 0);
	return {
		outer,
		outerArea: round2(outerArea),
		partArea: round2(partArea),
		ratio: outerArea > 0 ? Number((partArea / outerArea).toFixed(4)) : 0,
	};
}

function center(b) {
	return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function distance(a, b) {
	const ca = center(a), cb = center(b);
	return round2(Math.hypot(ca.x - cb.x, ca.y - cb.y));
}

function partCenter(p) {
	const b = p?.bodyBBox || p?.bbox;
	return b ? center(b) : null;
}

function strictBetween(v, a, b) {
	return v > Math.min(a, b) + 1e-6 && v < Math.max(a, b) - 1e-6;
}

function interiorCrossings(segs) {
	const F = [];
	const hSegs = segs.filter(s => Math.abs(s.y1 - s.y2) < 1e-6);
	const vSegs = segs.filter(s => Math.abs(s.x1 - s.x2) < 1e-6);
	for (const h of hSegs) {
		for (const v of vSegs) {
			if (!strictBetween(v.x1, h.x1, h.x2) || !strictBetween(h.y1, v.y1, v.y2)) continue;
			if (h.net && v.net && h.net === v.net) continue;
			F.push({ h, v, x: v.x1, y: h.y1 });
		}
	}
	return F;
}

function netIslandStats(groups) {
	const signalNets = new Set(CONFIG.wiring?.continuousSignalNets || []);
	const byNet = new Map();
	for (const g of groups || []) {
		const nets = [...new Set((g.segs || []).map(s => s.net).filter(n => signalNets.has(n)))];
		for (const net of nets) {
			if (!byNet.has(net)) byNet.set(net, []);
			byNet.get(net).push({
				segments: g.segs.length,
				pins: (g.pins || []).map(p => `${p.designator}.${p.pinName}`),
				totalLen: g.totalLen,
			});
		}
	}
	return byNet;
}

export function c9ReferenceQuality(m) {
	const F = [];
	const byRef = new Map(m.parts.map(p => [p.designator, p]));
	const registry = loadProjectModuleRegistry();
	const moduleMargin = CONFIG.reference?.moduleMargin ?? 12;
	const modules = registry.modules.map(({ name, refs }) => ({ name, refs, box: boxOf(byRef, refs, moduleMargin) }))
		.filter(x => x.box);
	const mod = Object.fromEntries(modules.map(x => [x.name, x]));

	for (const x of modules) {
		const w = x.box.maxX - x.box.minX;
		const h = x.box.maxY - x.box.minY;
		const area = w * h;
		const maxArea = CONFIG.reference?.maxModuleArea?.[x.name] ?? 115000;
		/* 一个只含 <=2 个器件的模块（如串联分压/单串阻）天然是细长线性形，
		 * 放宽其长宽比上限；AIHWDEBUGER 模块在 3.2 下已通过，放宽不会新增 finding。 */
		const baseAspect = CONFIG.reference?.maxModuleAspect?.[x.name] ?? 3.2;
		const maxAspect = (x.refs?.length ?? 99) <= 2 ? Math.max(baseAspect, 6) : baseAspect;
		const aspect = round2(Math.max(w / Math.max(1, h), h / Math.max(1, w)));
		if (area > maxArea) F.push({
			rule: 'C9.1-module-sprawl',
			severity: 'hard',
			category: 'layout',
			msg: `${x.name} module is too sprawled: area ${round2(area)} > ${maxArea}`,
			where: { module: x.name, box: x.box, area: round2(area), maxArea },
		});
		if (aspect > maxAspect) F.push({
			rule: 'C9.2-module-aspect',
			severity: 'hard',
			category: 'layout',
			msg: `${x.name} module aspect is too high: ${aspect} > ${maxAspect}`,
			where: { module: x.name, box: x.box, aspect, maxAspect },
		});
		const pack = internalPacking(byRef, x.refs);
		const minPacking = CONFIG.reference?.minModuleInternalPacking?.[x.name];
		if (pack && minPacking != null && pack.ratio < minPacking) F.push({
			rule: 'C9.22-module-internal-packing',
			severity: 'hard',
			category: 'layout',
			msg: `${x.name} module internals are too sparse: packing ${pack.ratio} < ${minPacking}`,
			where: { module: x.name, ...pack, minPacking },
		});
	}

	if (mod.usb && mod.mcu && center(mod.usb.box).x >= center(mod.mcu.box).x) F.push({
		rule: 'C9.3-flow-usb-mcu',
		severity: 'hard',
		category: 'layout',
		msg: 'USB input must be left of MCU in the main reading flow',
		where: { usb: mod.usb.box, mcu: mod.mcu.box },
	});
	if (mod.mcu && mod.pmos && center(mod.pmos.box).x <= center(mod.mcu.box).x) F.push({
		rule: 'C9.4-flow-mcu-power',
		severity: 'hard',
		category: 'layout',
		msg: 'Power switch block must be right of MCU control block',
		where: { mcu: mod.mcu.box, pmos: mod.pmos.box },
	});
	if (mod.usb && mod.ldo && mod.mcu) {
		const usbC = center(mod.usb.box), ldoC = center(mod.ldo.box), mcuC = center(mod.mcu.box);
		if (usbC.x > mcuC.x || ldoC.x > mcuC.x) F.push({
			rule: 'C9.13-system-input-left',
			severity: 'hard',
			category: 'layout',
			msg: 'Input and regulator blocks must stay left of the MCU system boundary',
			where: { usb: mod.usb.box, ldo: mod.ldo.box, mcu: mod.mcu.box },
		});
		if (Math.abs(usbC.x - ldoC.x) > (CONFIG.reference?.maxInputColumnSkew ?? 140)) F.push({
			rule: 'C9.14-input-column-skew',
			severity: 'hard',
			category: 'layout',
			msg: `USB and LDO input-column centers are too far apart: ${round2(Math.abs(usbC.x - ldoC.x))}`,
			where: { usb: mod.usb.box, ldo: mod.ldo.box, skew: round2(Math.abs(usbC.x - ldoC.x)) },
		});
	}
	if (mod.mcu && mod.pmos && mod.relay1 && mod.relay2) {
		const mcuC = center(mod.mcu.box), pmosC = center(mod.pmos.box);
		const relayC = { x: (center(mod.relay1.box).x + center(mod.relay2.box).x) / 2,
			y: (center(mod.relay1.box).y + center(mod.relay2.box).y) / 2 };
		const pmosGap = pmosC.x - mcuC.x;
		const relayGap = relayC.x - mcuC.x;
		if (pmosGap < (CONFIG.reference?.minOutputColumnGap ?? 220) || relayGap < (CONFIG.reference?.minOutputColumnGap ?? 220)) F.push({
			rule: 'C9.15-output-right-of-mcu',
			severity: 'hard',
			category: 'layout',
			msg: 'Output/load driver columns must read to the right of MCU with a clear system gap',
			where: { mcu: mod.mcu.box, pmos: mod.pmos.box, relay1: mod.relay1.box, relay2: mod.relay2.box, pmosGap: round2(pmosGap), relayGap: round2(relayGap) },
		});
	}
	const edgeChecks = [
		{ rule: 'C9.16-pmos-input-terminal-edge', part: 'CN1', anchor: 'Q1', side: 'left', min: CONFIG.reference?.minTerminalEdgeGap ?? 120 },
		{ rule: 'C9.17-pmos-output-terminal-edge', part: 'CN2', anchor: 'Q1', side: 'right', min: CONFIG.reference?.minTerminalEdgeGap ?? 80 },
		{ rule: 'C9.18-relay-terminal-edge', part: 'CN3', anchor: 'Q3', side: 'right', min: CONFIG.reference?.minTerminalEdgeGap ?? 90 },
		{ rule: 'C9.18-relay-terminal-edge', part: 'CN4', anchor: 'Q4', side: 'right', min: CONFIG.reference?.minTerminalEdgeGap ?? 90 },
	];
	for (const e of edgeChecks) {
		const p = partCenter(byRef.get(e.part));
		const a = partCenter(byRef.get(e.anchor));
		if (!p || !a) continue;
		const delta = e.side === 'left' ? a.x - p.x : p.x - a.x;
		if (delta < e.min) F.push({
			rule: e.rule,
			severity: 'hard',
			category: 'layout',
			msg: `${e.part} must sit on the ${e.side} edge of its served output/input cell: ${round2(delta)} < ${e.min}`,
			where: { part: e.part, anchor: e.anchor, delta: round2(delta), min: e.min },
		});
	}
	if (mod.mcu && mod.btn1) {
		const d = distance(mod.mcu.box, mod.btn1.box);
		const max = CONFIG.reference?.maxSupportDistance?.btnToMcu ?? 260;
		if (d > max) F.push({
			rule: 'C9.9-button-mcu-distance',
			severity: 'hard',
			category: 'layout',
			msg: `RESET button cell is too far from MCU EN pin group: ${d} > ${max}`,
			where: { button: mod.btn1.box, mcu: mod.mcu.box, distance: d, max },
		});
	}
	if (mod.mcu && mod.btn2) {
		const d = distance(mod.mcu.box, mod.btn2.box);
		const max = CONFIG.reference?.maxSupportDistance?.btnToMcu ?? 260;
		if (d > max) F.push({
			rule: 'C9.9-button-mcu-distance',
			severity: 'hard',
			category: 'layout',
			msg: `BOOT button cell is too far from MCU IO9 pin group: ${d} > ${max}`,
			where: { button: mod.btn2.box, mcu: mod.mcu.box, distance: d, max },
		});
	}
	if (mod.mcu && mod.btn1 && mod.btn2) {
		const b1 = center(mod.btn1.box);
		const b2 = center(mod.btn2.box);
		const mc = center(mod.mcu.box);
		if (Math.abs(b1.y - b2.y) > 35) F.push({
			rule: 'C9.11-button-row-align',
			severity: 'hard',
			category: 'layout',
			msg: `RESET/BOOT button cells must form a clean row; y delta ${round2(Math.abs(b1.y - b2.y))} > 35`,
			where: { btn1: mod.btn1.box, btn2: mod.btn2.box },
		});
		if (Math.abs(((b1.x + b2.x) / 2) - mc.x) > 180) F.push({
			rule: 'C9.12-button-row-near-mcu',
			severity: 'hard',
			category: 'layout',
			msg: 'RESET/BOOT row must stay near the MCU column instead of becoming a detached support island',
			where: { btn1: mod.btn1.box, btn2: mod.btn2.box, mcu: mod.mcu.box },
		});
	}
	if (mod.mcu && mod.ldo) {
		const d = distance(mod.mcu.box, mod.ldo.box);
		const max = CONFIG.reference?.maxSupportDistance?.ldoToMcu ?? 430;
		if (d > max) F.push({
			rule: 'C9.10-power-mcu-distance',
			severity: 'hard',
			category: 'layout',
			msg: `LDO power cell is too far from MCU power pins: ${d} > ${max}`,
			where: { ldo: mod.ldo.box, mcu: mod.mcu.box, distance: d, max },
		});
	}
	if (mod.mcu && mod.relay1 && mod.relay2) {
		const c1 = center(mod.relay1.box);
		const c2 = center(mod.relay2.box);
		if (Math.abs(c1.x - c2.x) > 35 && Math.abs(c1.y - c2.y) > 35) F.push({
			rule: 'C9.5-repeated-relay-grid',
			severity: 'hard',
			category: 'layout',
			msg: 'Relay driver modules must form a clean row or column',
			where: { relay1: mod.relay1.box, relay2: mod.relay2.box },
		});
		if (Math.abs((mod.relay1.box.maxX - mod.relay1.box.minX) - (mod.relay2.box.maxX - mod.relay2.box.minX)) > 10 ||
			Math.abs((mod.relay1.box.maxY - mod.relay1.box.minY) - (mod.relay2.box.maxY - mod.relay2.box.minY)) > 10) {
			F.push({
				rule: 'C9.6-repeated-relay-shape',
				severity: 'hard',
				category: 'layout',
				msg: 'Relay repeated cells must have matching module box size',
				where: { relay1: mod.relay1.box, relay2: mod.relay2.box },
			});
		}
		if (Math.abs(c1.x - c2.x) <= 35) {
			const corridor = Math.abs(c1.y - c2.y) - ((mod.relay1.box.maxY - mod.relay1.box.minY) + (mod.relay2.box.maxY - mod.relay2.box.minY)) / 2;
			const min = CONFIG.reference?.minRepeatedVerticalCorridor ?? 90;
			if (corridor < min) F.push({
				rule: 'C9.19-repeated-relay-vertical-corridor',
				severity: 'hard',
				category: 'layout',
				msg: `Vertical relay channels need reference-style whitespace: ${round2(corridor)} < ${min}`,
				where: { relay1: mod.relay1.box, relay2: mod.relay2.box, corridor: round2(corridor), min },
			});
		}
		if (mod.pmos) {
			const outputGap = Math.abs(center(mod.pmos.box).x - c1.x);
			const minGap = CONFIG.reference?.minOutputSubcolumnGap ?? 250;
			const maxGap = CONFIG.reference?.maxOutputSubcolumnGap ?? 460;
			if (outputGap < minGap) F.push({
				rule: 'C9.20-output-subcolumns',
				severity: 'hard',
				category: 'layout',
				msg: 'PMOS and relay outputs must form distinct readable output subcolumns',
				where: { pmos: mod.pmos.box, relay1: mod.relay1.box, relay2: mod.relay2.box, outputGap: round2(outputGap), minGap },
			});
			if (outputGap > maxGap) F.push({
				rule: 'C9.21-output-subcolumn-sprawl',
				severity: 'hard',
				category: 'layout',
				msg: `PMOS and relay output subcolumns are too far apart for one readable output band: ${round2(outputGap)} > ${maxGap}`,
				where: { pmos: mod.pmos.box, relay1: mod.relay1.box, relay2: mod.relay2.box, outputGap: round2(outputGap), maxGap },
			});
		}
	}

	const allSegs = m.segments || [];
	for (const c of interiorCrossings(allSegs)) {
		F.push({
			rule: 'C9.7-any-wire-crossing',
			severity: 'hard',
			category: 'wiring',
			msg: `Interior wire crossing at (${c.x},${c.y}) between ${c.h.net || '(unnamed)'} and ${c.v.net || '(unnamed)'}`,
			where: c,
		});
	}

	for (const [net, islands] of netIslandStats(m.groups)) {
		if (islands.length > 1) F.push({
			rule: 'C9.8-signal-physical-islands',
			severity: 'hard',
			category: 'wiring',
			msg: `${net} is split into ${islands.length} physical wire islands; use continuous local wiring instead of label-only stubs`,
			where: { net, islands },
		});
	}

	return F;
}
