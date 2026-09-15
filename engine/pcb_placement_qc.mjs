const MIL_PER_MM = 1 / 0.0254;

export const PCB_DEFAULTS = Object.freeze({
	gridMil: 10,
	generalClearanceMil: MIL_PER_MM,
	passiveArrayClearanceMil: 0.5 * MIL_PER_MM,
	boardEdgeMil: 0.3 * MIL_PER_MM,
	cornerRadiusMil: MIL_PER_MM,
	maxOuterMarginMil: 80,
	alignmentToleranceMil: 1,
	regionToleranceMil: 0.1,
});

const finite = value => Number.isFinite(Number(value));
const boxValid = box => box && ['minX', 'minY', 'maxX', 'maxY'].every(key => finite(box[key]))
	&& box.minX <= box.maxX && box.minY <= box.maxY;
const pairKey = (a, b) => [String(a), String(b)].sort().join('|');
const center = box => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
const contains = (outer, inner, pad = 0) => inner.minX >= outer.minX + pad && inner.maxX <= outer.maxX - pad
	&& inner.minY >= outer.minY + pad && inner.maxY <= outer.maxY - pad;
const overlap = (a, b, clearance = 0) => !(a.maxX + clearance <= b.minX || b.maxX + clearance <= a.minX
	|| a.maxY + clearance <= b.minY || b.maxY + clearance <= a.minY);

export function rectangleUnionArea(boxes) {
	const valid = (boxes || []).filter(boxValid);
	const xs = [...new Set(valid.flatMap(box => [box.minX, box.maxX]))].sort((a, b) => a - b);
	let area = 0;
	for (let i = 1; i < xs.length; i++) {
		const x0 = xs[i - 1], x1 = xs[i];
		if (x1 <= x0) continue;
		const spans = valid.filter(box => box.minX < x1 && box.maxX > x0)
			.map(box => [box.minY, box.maxY]).sort((a, b) => a[0] - b[0]);
		if (!spans.length) continue;
		let [start, end] = spans[0], height = 0;
		for (const [nextStart, nextEnd] of spans.slice(1)) {
			if (nextStart <= end) end = Math.max(end, nextEnd);
			else { height += end - start; [start, end] = [nextStart, nextEnd]; }
		}
		height += end - start;
		area += (x1 - x0) * height;
	}
	return area;
}

export function boxGap(a, b) {
	const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
	const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
	return Math.hypot(dx, dy);
}

export function boardFromOutlineSource(source) {
	if (!Array.isArray(source) || source[0] !== 'R' || source.length < 7) return null;
	const [, x, y, width, height, rotation, round] = source.map((value, index) => index ? Number(value) : value);
	if (![x, y, width, height, rotation, round].every(finite) || width <= 0 || height <= 0) return null;
	if (Math.abs(rotation % 360) > 1e-6) return { source, rotation, unsupported: 'rotated-rectangle' };
	return {
		source,
		rotation,
		cornerRadiusMil: round,
		widthMil: width,
		heightMil: height,
		bbox: { minX: x, minY: y - height, maxX: x + width, maxY: y },
	};
}

export function flattenPcbDrc(raw, out = []) {
	for (const row of raw || []) {
		if (Array.isArray(row?.list) && row.list.length) flattenPcbDrc(row.list, out);
		else if (row?.errorType) out.push(row);
	}
	return out;
}

function add(results, id, deviations, detail = {}) {
	results.push({ id, pass: deviations.length === 0, deviations, detail });
}

function policyIndex(policy) {
	const cells = policy.cells || [];
	const modules = policy.modules || [];
	const cellById = new Map(cells.map(cell => [cell.id, cell]));
	const moduleById = new Map(modules.map(module => [module.id, module]));
	const cellOfRef = new Map();
	for (const cell of cells) for (const ref of cell.members || []) {
		if (cellOfRef.has(ref)) throw new Error(`component assigned to multiple cells: ${ref}`);
		cellOfRef.set(ref, cell.id);
	}
	const passivePairs = new Set();
	for (const group of policy.passiveArrays || []) {
		const members = group.members || [];
		for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++)
			passivePairs.add(pairKey(members[i], members[j]));
	}
	return { cells, modules, cellById, moduleById, cellOfRef, passivePairs };
}

function checkCoverage(snapshot, policy, index, results) {
	const components = snapshot.components || [];
	const refs = components.map(component => component.ref || component.designator).filter(Boolean);
	const refSet = new Set(refs);
	const deviations = [];
	if (!components.length) deviations.push({ kind: 'missing-components' });
	if (refSet.size !== refs.length) deviations.push({ kind: 'duplicate-designator' });
	for (const component of components) {
		const ref = component.ref || component.designator;
		if (!ref || !boxValid(component.bbox) || !finite(component.x) || !finite(component.y))
			deviations.push({ kind: 'incomplete-component-geometry', ref: ref || '?' });
	}
	if (components.length > 1 && (!index.modules.length || !index.cells.length))
		deviations.push({ kind: 'missing-module-or-cell-policy' });
	for (const ref of refs) if (!index.cellOfRef.has(ref)) deviations.push({ kind: 'unassigned-component', ref });
	for (const [ref, cell] of index.cellOfRef) if (!refSet.has(ref)) deviations.push({ kind: 'unknown-policy-member', ref, cell });
	for (const group of policy.passiveArrays || []) for (const ref of group.members || [])
		if (!refSet.has(ref)) deviations.push({ kind: 'unknown-passive-array-member', group: group.id, ref });
	add(results, 'PCB-COVERAGE', deviations, { components: components.length, assigned: index.cellOfRef.size });
}

function checkBoard(snapshot, policy, results) {
	const board = snapshot.board || {};
	const deviations = [];
	if (!boxValid(board.bbox)) deviations.push({ kind: 'missing-board-bbox' });
	if (!finite(board.cornerRadiusMil)) deviations.push({ kind: 'missing-corner-radius' });
	else if (Math.abs(board.cornerRadiusMil - (policy.cornerRadiusMil ?? PCB_DEFAULTS.cornerRadiusMil)) > 1)
		deviations.push({ kind: 'corner-radius', actual: board.cornerRadiusMil, expected: policy.cornerRadiusMil ?? PCB_DEFAULTS.cornerRadiusMil });
	if (finite(board.rotation) && Math.abs(board.rotation % 360) > 1e-6) deviations.push({ kind: 'rotated-board', rotation: board.rotation });
	const edgeExceptions = new Set(policy.edgeMountExceptions || []);
	const boxes = [];
	for (const component of snapshot.components || []) {
		const ref = component.ref || component.designator;
		if (!boxValid(board.bbox) || !boxValid(component.bbox)) continue;
		boxes.push(component.bbox);
		if (!edgeExceptions.has(ref) && !contains(board.bbox, component.bbox, 0)) deviations.push({ kind: 'component-outside-board', ref });
	}
	if (boxValid(board.bbox) && boxes.length) {
		const envelope = {
			minX: Math.min(...boxes.map(box => box.minX)), minY: Math.min(...boxes.map(box => box.minY)),
			maxX: Math.max(...boxes.map(box => box.maxX)), maxY: Math.max(...boxes.map(box => box.maxY)),
		};
		const margins = {
			left: envelope.minX - board.bbox.minX, right: board.bbox.maxX - envelope.maxX,
			top: board.bbox.maxY - envelope.maxY, bottom: envelope.minY - board.bbox.minY,
		};
		const maxMargin = policy.maxOuterMarginMil ?? PCB_DEFAULTS.maxOuterMarginMil;
		for (const [side, value] of Object.entries(margins)) if (value > maxMargin)
			deviations.push({ kind: 'excess-outer-margin', side, value: +value.toFixed(2), maxMargin });
		return add(results, 'PCB-BOARD', deviations, { bbox: board.bbox, margins });
	}
	add(results, 'PCB-BOARD', deviations, { bbox: board.bbox || null });
}

function checkDensity(snapshot, policy, results) {
	const board = snapshot.board?.bbox;
	const deviations = [];
	const target = Number(policy.density?.minComponentUtilization);
	const mechanicalReason = String(policy.density?.mechanicalConstraintReason || '').trim();
	if (!Number.isFinite(target) && !mechanicalReason) deviations.push({ kind: 'missing-density-declaration' });
	if (Number.isFinite(target) && (target <= 0 || target > 1)) deviations.push({ kind: 'invalid-density-target', target });
	let componentArea = null, boardArea = null, utilization = null;
	if (boxValid(board)) {
		boardArea = (board.maxX - board.minX) * (board.maxY - board.minY);
		componentArea = rectangleUnionArea((snapshot.components || []).map(component => component.bbox));
		utilization = boardArea > 0 ? componentArea / boardArea : null;
		if (Number.isFinite(target) && utilization + 1e-9 < target)
			deviations.push({ kind: 'component-utilization', actual: +utilization.toFixed(4), minimum: target });
	}
	add(results, 'PCB-DENSITY', deviations, {
		componentArea: componentArea == null ? null : +componentArea.toFixed(2),
		boardArea: boardArea == null ? null : +boardArea.toFixed(2),
		utilization: utilization == null ? null : +utilization.toFixed(4),
		target: Number.isFinite(target) ? target : null,
		mechanicalConstraintReason: mechanicalReason || null,
	});
}

function checkPlacement(snapshot, policy, index, results) {
	const components = (snapshot.components || []).filter(component => boxValid(component.bbox));
	const byRef = new Map(components.map(component => [component.ref || component.designator, component]));
	const deviations = [];
	const bottomExceptions = new Set(policy.bottomSideExceptions || []);
	const grid = policy.gridMil ?? PCB_DEFAULTS.gridMil;
	const tolerance = policy.gridToleranceMil ?? 1e-6;
	for (const component of components) {
		const ref = component.ref || component.designator;
		if (component.layer !== 1 && !bottomExceptions.has(ref)) deviations.push({ kind: 'unexpected-bottom-component', ref, layer: component.layer });
		if (![0, 90, 180, 270].some(rotation => Math.abs((((component.rotation - rotation) % 360) + 360) % 360) <= tolerance))
			deviations.push({ kind: 'non-orthogonal-rotation', ref, rotation: component.rotation });
		for (const [axis, value] of [['x', component.x], ['y', component.y]])
			if (Math.abs(value - Math.round(value / grid) * grid) > tolerance) deviations.push({ kind: 'off-grid-origin', ref, axis, value, grid });
	}
	for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
		const a = components[i], b = components[j];
		if (a.layer !== b.layer) continue;
		const aRef = a.ref || a.designator, bRef = b.ref || b.designator;
		const passive = index.passivePairs.has(pairKey(aRef, bRef));
		const minimum = passive ? (policy.passiveArrayClearanceMil ?? PCB_DEFAULTS.passiveArrayClearanceMil)
			: (policy.generalClearanceMil ?? PCB_DEFAULTS.generalClearanceMil);
		const gap = boxGap(a.bbox, b.bbox);
		if (gap + 1e-6 < minimum) deviations.push({ kind: 'component-clearance', a: aRef, b: bRef, gap: +gap.toFixed(3), minimum, exception: passive ? 'passive-array' : null });
	}
	for (const group of policy.passiveArrays || []) {
		const members = (group.members || []).map(ref => byRef.get(ref)).filter(Boolean);
		if (members.length !== (group.members || []).length) continue;
		const rotations = new Set(members.map(component => ((component.rotation % 360) + 360) % 360));
		const cells = new Set((group.members || []).map(ref => index.cellOfRef.get(ref)));
		if (rotations.size !== 1) deviations.push({ kind: 'passive-array-rotation', group: group.id });
		if (cells.size !== 1 || cells.has(undefined)) deviations.push({ kind: 'passive-array-cell', group: group.id });
		if (group.axis === 'x' || group.axis === 'y') {
			const orthogonal = group.axis === 'x' ? 'y' : 'x';
			const values = members.map(component => component[orthogonal]);
			const spread = Math.max(...values) - Math.min(...values);
			if (spread > (group.toleranceMil ?? PCB_DEFAULTS.alignmentToleranceMil)) deviations.push({ kind: 'passive-array-axis', group: group.id, spread });
		}
	}
	add(results, 'PCB-PLACEMENT', deviations, { components: components.length, gridMil: grid, passiveArrays: (policy.passiveArrays || []).length });
}

function checkRegions(snapshot, policy, index, results) {
	const byRef = new Map((snapshot.components || []).map(component => [component.ref || component.designator, component]));
	const deviations = [];
	const tolerance = policy.regionToleranceMil ?? PCB_DEFAULTS.regionToleranceMil;
	for (const module of index.modules) if (!boxValid(module.box)) deviations.push({ kind: 'missing-module-box', module: module.id });
	for (const cell of index.cells) {
		if (!index.moduleById.has(cell.module)) deviations.push({ kind: 'unknown-cell-module', cell: cell.id, module: cell.module });
		if (!boxValid(cell.box)) deviations.push({ kind: 'missing-cell-box', cell: cell.id });
		const module = index.moduleById.get(cell.module);
		if (boxValid(cell.box) && boxValid(module?.box) && !contains(module.box, cell.box, -tolerance)) deviations.push({ kind: 'cell-outside-module', cell: cell.id, module: cell.module });
		for (const ref of cell.members || []) {
			const component = byRef.get(ref);
			if (component && boxValid(cell.box) && boxValid(component.bbox) && !contains(cell.box, component.bbox, -tolerance))
				deviations.push({ kind: 'component-outside-cell', ref, cell: cell.id });
		}
	}
	for (let i = 0; i < index.modules.length; i++) for (let j = i + 1; j < index.modules.length; j++) {
		const a = index.modules[i], b = index.modules[j];
		if (boxValid(a.box) && boxValid(b.box) && overlap(a.box, b.box, 0)) deviations.push({ kind: 'module-box-overlap', a: a.id, b: b.id });
	}
	add(results, 'PCB-REGIONS', deviations, { modules: index.modules.length, cells: index.cells.length });
}

function checkAlignment(snapshot, policy, results) {
	const byRef = new Map((snapshot.components || []).map(component => [component.ref || component.designator, component]));
	const deviations = [];
	for (const group of policy.alignGroups || []) {
		const members = (group.members || []).map(ref => byRef.get(ref)).filter(Boolean);
		if (members.length !== (group.members || []).length) { deviations.push({ kind: 'alignment-member-missing', group: group.id }); continue; }
		const axis = group.axis === 'x' ? 'x' : 'y';
		const values = members.map(component => group.field === 'center' ? center(component.bbox)[axis] : component[axis]);
		const spread = Math.max(...values) - Math.min(...values);
		if (spread > (group.toleranceMil ?? PCB_DEFAULTS.alignmentToleranceMil)) deviations.push({ kind: 'alignment-spread', group: group.id, axis, spread });
	}
	for (const group of policy.repeatedGroups || []) {
		const instances = group.instances || [];
		if (instances.length < 2) { deviations.push({ kind: 'repeated-group-instances', group: group.id }); continue; }
		const roles = Object.keys(instances[0] || {});
		const base = instances[0];
		const tolerance = group.toleranceMil ?? PCB_DEFAULTS.alignmentToleranceMil;
		const anchorRole = group.anchorRole || roles[0];
		for (let i = 1; i < instances.length; i++) {
			const a0 = byRef.get(base[anchorRole]), ai = byRef.get(instances[i][anchorRole]);
			if (!a0 || !ai) { deviations.push({ kind: 'repeated-anchor-missing', group: group.id, instance: i }); continue; }
			for (const role of roles) {
				const c0 = byRef.get(base[role]), ci = byRef.get(instances[i][role]);
				if (!c0 || !ci) { deviations.push({ kind: 'repeated-role-missing', group: group.id, instance: i, role }); continue; }
				const dx0 = c0.x - a0.x, dy0 = c0.y - a0.y, dxi = ci.x - ai.x, dyi = ci.y - ai.y;
				if (Math.abs(dx0 - dxi) > tolerance || Math.abs(dy0 - dyi) > tolerance || Math.abs((((c0.rotation - ci.rotation) % 360) + 360) % 360) > tolerance)
					deviations.push({ kind: 'repeated-geometry', group: group.id, instance: i, role, expected: [dx0, dy0, c0.rotation], actual: [dxi, dyi, ci.rotation] });
			}
		}
	}
	add(results, 'PCB-ALIGNMENT', deviations, { alignGroups: (policy.alignGroups || []).length, repeatedGroups: (policy.repeatedGroups || []).length });
}

function checkConnectors(snapshot, policy, results) {
	const byRef = new Map((snapshot.components || []).map(component => [component.ref || component.designator, component]));
	const board = snapshot.board?.bbox;
	const deviations = [];
	const outward = { left: [-1, 0], right: [1, 0], top: [0, 1], bottom: [0, -1] };
	for (const connector of policy.connectors || []) {
		const component = byRef.get(connector.ref);
		if (!component) { deviations.push({ kind: 'connector-missing', ref: connector.ref }); continue; }
		const expected = outward[connector.edge];
		const vector = connector.matingVector;
		if (!expected || !vector || expected[0] * vector[0] + expected[1] * vector[1] < 0.99)
			deviations.push({ kind: 'connector-facing', ref: connector.ref, edge: connector.edge, matingVector: vector || null });
		if (boxValid(board) && boxValid(component.bbox)) {
			const distance = connector.edge === 'left' ? component.bbox.minX - board.minX
				: connector.edge === 'right' ? board.maxX - component.bbox.maxX
					: connector.edge === 'top' ? board.maxY - component.bbox.maxY : component.bbox.minY - board.minY;
			if (distance > (connector.maxBodyEdgeGapMil ?? 80)) deviations.push({ kind: 'connector-too-far-from-edge', ref: connector.ref, distance });
		}
	}
	add(results, 'PCB-CONNECTORS', deviations, { connectors: (policy.connectors || []).length });
}

function checkDesignators(snapshot, results) {
	const components = snapshot.components || [];
	const byParent = new Map(components.map(component => [component.id, component]));
	const designators = (snapshot.designators || []).filter(item => item.visible !== false);
	const board = snapshot.board?.bbox;
	const deviations = [];
	if (designators.length !== components.length) deviations.push({ kind: 'designator-coverage', expected: components.length, actual: designators.length });
	for (let i = 0; i < designators.length; i++) {
		const a = designators[i];
		if (!boxValid(a.bbox)) { deviations.push({ kind: 'designator-bbox-missing', ref: a.ref }); continue; }
		if (boxValid(board) && !contains(board, a.bbox)) deviations.push({ kind: 'designator-outside-board', ref: a.ref });
		const rotation = ((Number(a.rotation || 0) % 360) + 360) % 360;
		if (rotation !== 0 && rotation !== 180) deviations.push({ kind: 'designator-not-horizontal', ref: a.ref, rotation });
		for (let j = i + 1; j < designators.length; j++) if (boxValid(designators[j].bbox) && overlap(a.bbox, designators[j].bbox))
			deviations.push({ kind: 'designator-overlap', a: a.ref, b: designators[j].ref });
		for (const component of components) if (component.id !== a.parent && boxValid(component.bbox) && overlap(a.bbox, component.bbox))
			deviations.push({ kind: 'designator-on-component', ref: a.ref, component: component.ref || component.designator });
		if (!byParent.has(a.parent)) deviations.push({ kind: 'designator-parent-missing', ref: a.ref });
	}
	add(results, 'PCB-DESIGNATORS', deviations, { components: components.length, designators: designators.length });
}

function checkDrc(snapshot, policy, results) {
	const findings = Array.isArray(snapshot.drc?.findings) ? snapshot.drc.findings : null;
	const deviations = [];
	if (!findings) deviations.push({ kind: 'missing-native-drc' });
	else for (const finding of findings) {
		if (policy.stage === 'placement' && finding.errorType === 'Connection Error') continue;
		deviations.push({ kind: 'native-drc', errorType: finding.errorType, errorObjType: finding.errorObjType, obj1: finding.obj1, obj2: finding.obj2 });
	}
	add(results, 'PCB-NATIVE-DRC', deviations, { stage: policy.stage || 'routed', findings: findings?.length ?? null });
}

export function judgePcbPlacement(snapshot, policy = {}) {
	const results = [];
	let index;
	try { index = policyIndex(policy); }
	catch (error) {
		add(results, 'PCB-POLICY', [{ kind: 'invalid-policy', message: error.message }]);
		return { pass: false, deterministicPass: false, results, deviationCount: 1 };
	}
	checkCoverage(snapshot, policy, index, results);
	checkBoard(snapshot, policy, results);
	checkDensity(snapshot, policy, results);
	checkPlacement(snapshot, policy, index, results);
	checkRegions(snapshot, policy, index, results);
	checkAlignment(snapshot, policy, results);
	checkConnectors(snapshot, policy, results);
	checkDesignators(snapshot, results);
	checkDrc(snapshot, policy, results);
	const deviationCount = results.reduce((sum, result) => sum + result.deviations.length, 0);
	return {
		pass: deviationCount === 0 && policy.visualReview?.status === 'pass',
		deterministicPass: deviationCount === 0,
		visualReview: policy.visualReview || { status: 'required' },
		deviationCount,
		results,
	};
}
