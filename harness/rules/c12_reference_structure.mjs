import { loadProjectModuleRegistry } from '../module_registry.mjs';
import { round2 } from '../model.mjs';
import { CONFIG } from '../config.mjs';

function centerOfPart(p) {
	const b = p?.bodyBBox || p?.bbox;
	if (!b) return null;
	return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function sizeOfPart(p) {
	const b = p?.bodyBBox || p?.bbox;
	if (!b) return null;
	return { w: b.maxX - b.minX, h: b.maxY - b.minY };
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

function boxCenter(b) {
	return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function boxSize(b) {
	return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

function axisCorridor(aBox, bBox) {
	const xGap = Math.max(bBox.minX - aBox.maxX, aBox.minX - bBox.maxX);
	const yGap = Math.max(bBox.minY - aBox.maxY, aBox.minY - bBox.maxY);
	return Math.max(xGap, yGap);
}

export function c12ReferenceStructure(m) {
	const F = [];
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	const registry = loadProjectModuleRegistry();
	const modules = new Map((registry.modules || []).map(mod => [mod.name, mod]));

	for (const group of registry.repeatedGroups || []) {
		if (group.modules.length !== 2) continue;
		const [aName, bName] = group.modules;
		const aMod = modules.get(aName);
		const bMod = modules.get(bName);
		if (!aMod || !bMod) continue;
		const aBox = boxOf(parts, aMod.refs);
		const bBox = boxOf(parts, bMod.refs);
		if (!aBox || !bBox) continue;
		const aC = boxCenter(aBox);
		const bC = boxCenter(bBox);
		const aSize = boxSize(aBox);
		const bSize = boxSize(bBox);
		const sizeDelta = Math.max(Math.abs(aSize.w - bSize.w), Math.abs(aSize.h - bSize.h));
		if (sizeDelta > group.maxSizeDelta) {
			F.push({
				rule: 'C12.1-repeated-module-box-delta',
				severity: 'hard',
				category: 'layout',
				msg: `${group.name} repeated module boxes differ too much: ${round2(sizeDelta)} > ${group.maxSizeDelta}`,
				where: { group: group.name, a: aName, b: bName, aBox, bBox, sizeDelta: round2(sizeDelta) },
			});
		}

		const minCorridor = group.minCorridor ?? CONFIG.reference?.minRepeatedModuleCorridor ?? 90;
		const corridor = axisCorridor(aBox, bBox);
		if (corridor < minCorridor) {
			F.push({
				rule: 'C12.5-repeated-module-corridor',
				severity: 'hard',
				category: 'layout',
				msg: `${group.name} repeated modules need a clear corridor: ${round2(corridor)} < ${minCorridor}`,
				where: { group: group.name, a: aName, b: bName, aBox, bBox, corridor: round2(corridor), min: minCorridor },
			});
		}

		for (const [aRef, bRef] of group.roleMap || []) {
			const a = parts.get(aRef);
			const b = parts.get(bRef);
			if (!a || !b) continue;
			const ac = centerOfPart(a);
			const bc = centerOfPart(b);
			const as = sizeOfPart(a);
			const bs = sizeOfPart(b);
			if (!ac || !bc || !as || !bs) continue;
			const relA = { x: ac.x - aC.x, y: ac.y - aC.y };
			const relB = { x: bc.x - bC.x, y: bc.y - bC.y };
			const relErr = Math.max(Math.abs(relA.x - relB.x), Math.abs(relA.y - relB.y));
			const partSizeDelta = Math.max(Math.abs(as.w - bs.w), Math.abs(as.h - bs.h));
			if (relErr > group.maxRelativeError) {
				F.push({
					rule: 'C12.2-repeated-part-relative-position',
					severity: 'hard',
					category: 'layout',
					msg: `${group.name} repeated role ${aRef}/${bRef} relative position differs: ${round2(relErr)} > ${group.maxRelativeError}`,
					where: { group: group.name, refs: [aRef, bRef], relA, relB, relErr: round2(relErr) },
				});
			}
			if (partSizeDelta > 3) {
				F.push({
					rule: 'C12.3-repeated-part-size',
					severity: 'hard',
					category: 'layout',
					msg: `${group.name} repeated role ${aRef}/${bRef} symbol size differs: ${round2(partSizeDelta)}`,
					where: { group: group.name, refs: [aRef, bRef], sizeA: as, sizeB: bs },
				});
			}
		}

		for (const role of group.anchorRoleMap || []) {
			const [aAnchorRef, bAnchorRef] = role.anchors || [];
			const [aRef, bRef] = role.refs || [];
			const aAnchor = parts.get(aAnchorRef);
			const bAnchor = parts.get(bAnchorRef);
			const a = parts.get(aRef);
			const b = parts.get(bRef);
			if (!aAnchor || !bAnchor || !a || !b) continue;
			const aa = centerOfPart(aAnchor);
			const ba = centerOfPart(bAnchor);
			const ac = centerOfPart(a);
			const bc = centerOfPart(b);
			if (!aa || !ba || !ac || !bc) continue;
			const relA = { x: ac.x - aa.x, y: ac.y - aa.y };
			const relB = { x: bc.x - ba.x, y: bc.y - ba.y };
			const relErr = Math.max(Math.abs(relA.x - relB.x), Math.abs(relA.y - relB.y));
			if (relErr > group.maxRelativeError) {
				F.push({
					rule: 'C12.4-repeated-anchor-relative-position',
					severity: 'hard',
					category: 'layout',
					msg: `${group.name} repeated role ${role.role || `${aRef}/${bRef}`} relative to anchor differs: ${round2(relErr)} > ${group.maxRelativeError}`,
					where: { group: group.name, anchors: [aAnchorRef, bAnchorRef], refs: [aRef, bRef], relA, relB, relErr: round2(relErr) },
				});
			}
		}
	}

	return F;
}
