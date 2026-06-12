import { CONFIG } from '../config.mjs';
import { segIntersectsRect, shrinkRect, rectsGap } from '../model.mjs';
import { MODULES, partToModuleMap } from '../module_registry.mjs';

function expand(r, m) {
	return { minX: r.minX - m, maxX: r.maxX + m, minY: r.minY - m, maxY: r.maxY + m };
}

function unionBox(parts, margin) {
	const boxes = parts.map(p => p.bodyBBox || p.bbox);
	return expand({
		minX: Math.min(...boxes.map(b => b.minX)),
		maxX: Math.max(...boxes.map(b => b.maxX)),
		minY: Math.min(...boxes.map(b => b.minY)),
		maxY: Math.max(...boxes.map(b => b.maxY)),
	}, margin);
}

function spanOverlapRatio(a0, a1, b0, b1) {
	const overlap = Math.min(a1, b1) - Math.max(a0, b0);
	if (overlap <= 0) return 0;
	return overlap / Math.max(1, Math.min(a1 - a0, b1 - b0));
}

function inRectInclusive(x, y, r) {
	return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

function segKey(s) {
	const a = `${s.x1},${s.y1}`;
	const b = `${s.x2},${s.y2}`;
	return [a, b].sort().join('|');
}

export function c8ModuleBoxes(m) {
	const F = [];
	const byRef = new Map(m.parts.map(p => [p.designator, p]));
	const boxMargin = CONFIG.module?.boxMargin ?? 24;
	const minGap = CONFIG.module?.minGap ?? 40;
	const interlockMargin = CONFIG.module?.interlockMargin ?? 0;
	const interlockMaxSeparation = CONFIG.module?.interlockMaxSeparation ?? 180;
	const partialMin = CONFIG.module?.interlockPartialMin ?? 0.2;
	const partialMax = CONFIG.module?.interlockPartialMax ?? 0.75;
	const partToModule = partToModuleMap();
	const segmentModules = new Map();
	const modules = [];
	for (const { name, refs } of MODULES) {
		const parts = refs.map(r => byRef.get(r)).filter(Boolean);
		if (!parts.length) continue;
		modules.push({ name, refs, parts, box: unionBox(parts, boxMargin), laneBox: unionBox(parts, interlockMargin) });
	}

	for (const g of m.groups || []) {
		const owners = new Set((g.pins || []).map(pin => partToModule.get(pin.designator)).filter(Boolean));
		for (const s of g.segs || []) segmentModules.set(segKey(s), owners);
	}

	for (let i = 0; i < modules.length; i++) {
		for (let j = i + 1; j < modules.length; j++) {
			const a = modules[i], b = modules[j];
			const gap = rectsGap(a.box, b.box);
			if (gap < minGap) F.push({
				rule: 'C8.1-module-gap',
				severity: 'hard',
				category: 'layout',
				msg: `Module boxes too close/interlock: ${a.name} -> ${b.name} gap ${gap} < ${minGap}`,
				where: { a: a.name, b: b.name, gap, aBox: a.box, bBox: b.box },
			});

			const axSep = a.laneBox.maxX <= b.laneBox.minX || b.laneBox.maxX <= a.laneBox.minX;
			const aySep = a.laneBox.maxY <= b.laneBox.minY || b.laneBox.maxY <= a.laneBox.minY;
			const xSeparation = Math.max(b.laneBox.minX - a.laneBox.maxX, a.laneBox.minX - b.laneBox.maxX);
			const ySeparation = Math.max(b.laneBox.minY - a.laneBox.maxY, a.laneBox.minY - b.laneBox.maxY);
			const xRatio = spanOverlapRatio(a.laneBox.minX, a.laneBox.maxX, b.laneBox.minX, b.laneBox.maxX);
			const yRatio = spanOverlapRatio(a.laneBox.minY, a.laneBox.maxY, b.laneBox.minY, b.laneBox.maxY);
			const partialY = axSep && xSeparation <= interlockMaxSeparation && yRatio >= partialMin && yRatio <= partialMax;
			const partialX = aySep && ySeparation <= interlockMaxSeparation && xRatio >= partialMin && xRatio <= partialMax;
			if (partialY || partialX) F.push({
				rule: 'C8.4-module-lane-interlock',
				severity: 'hard',
				category: 'layout',
				msg: `Module boxes form a partial lane interlock: ${a.name} -> ${b.name} xOverlap=${xRatio.toFixed(2)} yOverlap=${yRatio.toFixed(2)}`,
				where: { a: a.name, b: b.name, xOverlapRatio: xRatio, yOverlapRatio: yRatio, xSeparation, ySeparation, aBox: a.laneBox, bBox: b.laneBox },
			});
		}
	}

	for (const p of m.parts) {
		const owner = partToModule.get(p.designator);
		for (const mod of modules) {
			if (mod.name === owner) continue;
			const bb = p.bodyBBox || p.bbox;
			const centerInside = inRectInclusive((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, mod.box);
			if (centerInside) F.push({
				rule: 'C8.2-part-in-other-module-box',
				severity: 'hard',
				category: 'layout',
				msg: `${p.designator} center is inside ${mod.name} module box`,
				where: { part: p.designator, owner, module: mod.name, box: mod.box },
			});
		}
	}

	for (const s of m.segments) {
		const servedModules = segmentModules.get(segKey(s)) || new Set();
		for (const mod of modules) {
			if (servedModules.has(mod.name)) continue;
			const inner = shrinkRect(mod.box, CONFIG.module?.wireBoxShrink ?? 8);
			if (inner.maxX <= inner.minX || inner.maxY <= inner.minY) continue;
			if (segIntersectsRect(s, inner)) F.push({
				rule: 'C8.3-wire-through-module-box',
				severity: 'hard',
				category: 'layout',
				msg: `Wire crosses through unrelated module ${mod.name}: seg=[${s.x1},${s.y1},${s.x2},${s.y2}] net=${s.net || ''}`,
				where: { module: mod.name, seg: [s.x1, s.y1, s.x2, s.y2], net: s.net || '' },
			});
		}
	}

	return F;
}
