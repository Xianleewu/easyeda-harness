import { asArray } from './module_contract.mjs';

function hard(findings, rule, msg, where = {}, category = 'project-layout') {
	findings.push({ rule, severity: 'hard', category, msg, where });
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function columnIndexByModule(policy) {
	const result = new Map();
	for (const [index, column] of asArray(policy.columns).entries()) {
		for (const moduleId of asArray(column.modules)) {
			result.set(moduleId, {
				index,
				id: column.id || `column_${index + 1}`,
				role: column.role || '',
			});
		}
	}
	return result;
}

function finiteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function rectFromRegion(region, anchor) {
	if (!region || !finitePoint(anchor) || !finiteNumber(region.width) || !finiteNumber(region.height)) return null;
	const cx = anchor.x + Number(region.dx || 0);
	const cy = anchor.y + Number(region.dy || 0);
	const w = Number(region.width);
	const h = Number(region.height);
	if (w <= 0 || h <= 0) return null;
	return {
		minX: cx - w / 2,
		maxX: cx + w / 2,
		minY: cy - h / 2,
		maxY: cy + h / 2,
	};
}

function rectGap(a, b) {
	if (!a || !b) return null;
	const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
	const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
	if (dx === 0 && dy === 0) return 0;
	return Number(Math.hypot(dx, dy).toFixed(3));
}

function finiteRect(rect) {
	if (!rect) return null;
	const minX = Number(rect.minX);
	const maxX = Number(rect.maxX);
	const minY = Number(rect.minY);
	const maxY = Number(rect.maxY);
	if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
	if (maxX < minX || maxY < minY) return null;
	return { minX, maxX, minY, maxY };
}

function rectContains(outer, inner, tolerance = 0) {
	if (!outer || !inner) return false;
	return inner.minX >= outer.minX - tolerance
		&& inner.maxX <= outer.maxX + tolerance
		&& inner.minY >= outer.minY - tolerance
		&& inner.maxY <= outer.maxY + tolerance;
}

export function measureColumnAnchorGaps(assembly) {
	const policy = assembly?.layoutPolicy || {};
	const modules = asArray(assembly?.modules);
	const anchors = assembly?.anchors || {};
	const columns = asArray(policy.columns);
	const moduleToAnchor = new Map(modules.map(mod => [mod.id, mod.anchor]));
	const measured = [];
	for (const [index, column] of columns.entries()) {
		const points = asArray(column.modules)
			.map(moduleId => ({ moduleId, anchor: moduleToAnchor.get(moduleId) }))
			.filter(item => finitePoint(anchors[item.anchor]))
			.map(item => ({ ...item, x: anchors[item.anchor].x }));
		if (!points.length) {
			measured.push({
				index,
				id: column.id || `column_${index + 1}`,
				modules: asArray(column.modules),
				centerX: null,
				span: null,
				points,
			});
			continue;
		}
		const minX = Math.min(...points.map(p => p.x));
		const maxX = Math.max(...points.map(p => p.x));
		measured.push({
			index,
			id: column.id || `column_${index + 1}`,
			modules: asArray(column.modules),
			centerX: Number(((minX + maxX) / 2).toFixed(3)),
			span: Number((maxX - minX).toFixed(3)),
			points,
		});
	}
	const pairs = [];
	for (let i = 0; i + 1 < measured.length; i++) {
		const left = measured[i];
		const right = measured[i + 1];
		pairs.push({
			leftColumn: left.id,
			rightColumn: right.id,
			leftCenterX: left.centerX,
			rightCenterX: right.centerX,
			gap: left.centerX == null || right.centerX == null ? null : Number((right.centerX - left.centerX).toFixed(3)),
		});
	}
	return { columns: measured, pairs };
}

export function interfaceKey(iface) {
	return `${iface?.net || ''}:${iface?.from || ''}:${iface?.to || ''}`;
}

export function validateInterfaceRoutes(contract, assembly, category = 'project-layout') {
	const findings = [];
	const policy = assembly?.layoutPolicy || {};
	const modules = new Set(asArray(assembly?.modules).map(mod => mod.id).filter(Boolean));
	const routes = asArray(policy.interfaceRoutes);
	const routeByKey = new Map();
	const validStrategies = new Set(['visible-continuity', 'grouped-net-label']);
	const validDirections = new Set(['left-to-right', 'right-to-left', 'vertical', 'local']);
	for (const [index, route] of routes.entries()) {
		const key = interfaceKey(route);
		if (routeByKey.has(key)) hard(findings, 'PL24-interface-route-unique', 'layoutPolicy.interfaceRoutes must not duplicate a contract interface route', { route, firstIndex: routeByKey.get(key), duplicateIndex: index }, category);
		else routeByKey.set(key, index);
		if (!route?.net || !route?.from || !route?.to) hard(findings, 'PL25-interface-route-key', 'interface route needs net/from/to', { index, route }, category);
		if (route?.from && !modules.has(route.from)) hard(findings, 'PL26-interface-route-module-known', 'interface route from module must exist in project_assembly.json', { index, route }, category);
		if (route?.to && !modules.has(route.to)) hard(findings, 'PL26-interface-route-module-known', 'interface route to module must exist in project_assembly.json', { index, route }, category);
		if (!validStrategies.has(route?.strategy)) hard(findings, 'PL27-interface-route-strategy', 'interface route strategy must be visible-continuity or grouped-net-label', { index, route, validStrategies: [...validStrategies] }, category);
		if (!route?.channel || typeof route.channel !== 'string') hard(findings, 'PL28-interface-route-channel', 'interface route must name a readable channel or lane', { index, route }, category);
		if (!validDirections.has(route?.direction)) hard(findings, 'PL29-interface-route-direction', 'interface route direction must declare left-to-right, right-to-left, vertical, or local', { index, route, validDirections: [...validDirections] }, category);
		for (const key of ['fromSide', 'toSide']) {
			if (route?.[key] != null && !['left', 'right'].includes(route[key])) {
				hard(findings, 'PL55-interface-route-label-side', 'interface route fromSide/toSide must be left or right when declared', { index, route, key }, category);
			}
		}
	}
	for (const iface of asArray(contract?.interfaces)) {
		if (!routeByKey.has(interfaceKey(iface))) hard(findings, 'PL23-interface-route-covered', 'every contract interface must have a layoutPolicy.interfaceRoutes entry before generation', { interface: iface });
	}
	return findings;
}

const DEFAULT_SIGNAL_POWER_NETS = new Set(['GND', 'SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW', 'VBUS']);

function signalRoute(route, powerNets = DEFAULT_SIGNAL_POWER_NETS) {
	const net = String(route?.net || '');
	return route?.strategy === 'grouped-net-label' && net && !powerNets.has(net) && !net.startsWith('NC_');
}

function routeEndSide(route, routeEnd) {
	const key = routeEnd === 'from' ? 'fromSide' : 'toSide';
	const side = route?.[key];
	if (side === 'left' || side === 'right') return side;
	return routeEnd === 'from' ? 'right' : 'left';
}

function labelColumnCovers(columns, route, routeEnd, moduleId, side = routeEndSide(route, routeEnd)) {
	return asArray(columns).some(col => {
		if (col.side !== side) return false;
		if (!asArray(col.nets).includes(route.net)) return false;
		if (col.module && col.module !== moduleId) return false;
		if (col.routeEnd && col.routeEnd !== routeEnd) return false;
		return true;
	});
}

export function validateLabelColumnContracts(assembly, category = 'project-layout') {
	const findings = [];
	const policy = assembly?.layoutPolicy || {};
	const columns = asArray(policy.labelColumns);
	const modules = new Set(asArray(assembly?.modules).map(mod => mod.id).filter(Boolean));
	const ids = new Set();
	const budgetKeys = new Set();
	for (const [index, col] of columns.entries()) {
		const id = col.id || `label_column_${index + 1}`;
		if (ids.has(id)) hard(findings, 'PL47-label-column-id-unique', 'layoutPolicy.labelColumns ids must be unique', { index, id, column: col }, category);
		ids.add(id);
		if (!col.role || typeof col.role !== 'string') hard(findings, 'PL48-label-column-role', 'layoutPolicy.labelColumns entries must explain their reading-flow role', { index, column: col }, category);
		if (!['left', 'right'].includes(col.side)) hard(findings, 'PL49-label-column-side', 'layoutPolicy.labelColumns entries must declare side left or right', { index, column: col }, category);
		if (!finiteNumber(col.x)) hard(findings, 'PL50-label-column-x', 'layoutPolicy.labelColumns entries must declare finite x', { index, column: col }, category);
		if (!asArray(col.nets).length) hard(findings, 'PL51-label-column-nets', 'layoutPolicy.labelColumns entries must declare allowed nets', { index, column: col }, category);
		if (!col.module || typeof col.module !== 'string') {
			hard(findings, 'PL52-label-column-module', 'layoutPolicy.labelColumns entries must declare the owning module before generation', { index, column: col }, category);
		} else if (modules.size && !modules.has(col.module)) {
			hard(findings, 'PL52-label-column-module', 'layoutPolicy.labelColumns module must exist in project_assembly.json modules', { index, column: col, knownModules: [...modules] }, category);
		}
		if (!['from', 'to', 'local'].includes(col.routeEnd)) {
			hard(findings, 'PL53-label-column-route-end', 'layoutPolicy.labelColumns entries must declare routeEnd as from, to, or local', { index, column: col }, category);
		}
		for (const net of asArray(col.nets)) {
			const key = `${col.module || ''}:${col.routeEnd || ''}:${col.side || ''}:${col.x ?? ''}:${net}`;
			if (budgetKeys.has(key)) {
				hard(findings, 'PL54-label-column-budget-unique', 'layoutPolicy.labelColumns must not duplicate the same module-side net budget at the same side and x', {
					index,
					key,
					column: col,
				}, category);
			}
			budgetKeys.add(key);
		}
	}
	return findings;
}

export function validateGroupedRouteLabelColumns(contract, assembly, category = 'project-layout', options = {}) {
	const findings = [];
	const policy = assembly?.layoutPolicy || {};
	const columns = asArray(policy.labelColumns);
	const powerNets = options.powerNets || DEFAULT_SIGNAL_POWER_NETS;
	const groupedRoutes = asArray(policy.interfaceRoutes).filter(route => signalRoute(route, powerNets));
	if (groupedRoutes.length && !columns.length) {
		hard(findings, 'PL30-label-columns-declared', 'layoutPolicy.labelColumns must declare interface label columns for every grouped-net-label route', {
			groupedRoutes: groupedRoutes.map(route => ({ net: route.net, from: route.from, to: route.to, channel: route.channel })),
		}, category);
	}
	for (const route of groupedRoutes) {
		const fromSide = routeEndSide(route, 'from');
		const toSide = routeEndSide(route, 'to');
		const fromCovered = labelColumnCovers(columns, route, 'from', route.from, fromSide);
		const toCovered = labelColumnCovers(columns, route, 'to', route.to, toSide);
		if (!fromCovered) {
			hard(findings, 'PL31-label-column-covers-route-from', 'each grouped-net-label route needs a source module-side label column matching route.fromSide', {
				route,
				expected: { side: fromSide, module: route.from, net: route.net, routeEnd: 'from' },
				candidateColumns: columns.filter(col => asArray(col.nets).includes(route.net)).map(col => ({ id: col.id || null, side: col.side || null, module: col.module || null, routeEnd: col.routeEnd || null, x: col.x ?? null })),
			}, category);
		}
		if (!toCovered) {
			hard(findings, 'PL32-label-column-covers-route-to', 'each grouped-net-label route needs a target module-side label column matching route.toSide', {
				route,
				expected: { side: toSide, module: route.to, net: route.net, routeEnd: 'to' },
				candidateColumns: columns.filter(col => asArray(col.nets).includes(route.net)).map(col => ({ id: col.id || null, side: col.side || null, module: col.module || null, routeEnd: col.routeEnd || null, x: col.x ?? null })),
			}, category);
		}
	}
	for (const iface of asArray(contract?.interfaces)) {
		const route = groupedRoutes.find(r => r.net === iface.net && r.from === iface.from && r.to === iface.to);
		if (!route) continue;
		if (!labelColumnCovers(columns, route, 'from', iface.from) || !labelColumnCovers(columns, route, 'to', iface.to)) {
			hard(findings, 'PL33-label-column-covers-interface', 'each grouped-net-label contract interface must have source and target label-column coverage', {
				interface: iface,
			}, category);
		}
	}
	return findings;
}

export function validateModuleRegions(assembly, category = 'project-layout', options = {}) {
	const findings = [];
	const policy = assembly?.layoutPolicy || {};
	const modules = asArray(assembly?.modules);
	const anchors = assembly?.anchors || {};
	const columns = columnIndexByModule(policy);
	const regions = asArray(policy.moduleRegions);
	const moduleIds = new Set(modules.map(mod => mod.id).filter(Boolean));
	const moduleById = new Map(modules.map(mod => [mod.id, mod]).filter(([id]) => Boolean(id)));
	const regionByModule = new Map();
	const minGap = policy.minModuleGap ?? 90;
	if (!regions.length) {
		hard(findings, 'PL34-module-regions-declared', 'layoutPolicy.moduleRegions must declare the minimum readable rectangle for every module before generation', {
			modules: [...moduleIds],
		}, category);
		return findings;
	}
	for (const [index, region] of regions.entries()) {
		const moduleId = region.module || region.id;
		if (!moduleId) {
			hard(findings, 'PL35-module-region-id', 'each module region must name module', { index, region }, category);
			continue;
		}
		if (!moduleIds.has(moduleId)) {
			hard(findings, 'PL36-module-region-known', 'layoutPolicy.moduleRegions references an unknown assembly module', { module: moduleId, region }, category);
			continue;
		}
		if (regionByModule.has(moduleId)) {
			hard(findings, 'PL37-module-region-unique', 'each module must have exactly one module region', { module: moduleId, first: regionByModule.get(moduleId), duplicate: region }, category);
			continue;
		}
		const mod = modules.find(item => item.id === moduleId) || {};
		if (region.anchor && region.anchor !== mod.anchor) {
			hard(findings, 'PL38-module-region-anchor', 'module region anchor must match the assembly module anchor', { module: moduleId, expected: mod.anchor || null, actual: region.anchor }, category);
		}
		if (!columns.has(moduleId)) {
			hard(findings, 'PL39-module-region-column', 'module region cannot be checked until layoutPolicy.columns covers the module', { module: moduleId }, category);
		} else if (region.column && region.column !== columns.get(moduleId).id) {
			hard(findings, 'PL39-module-region-column', 'module region column must match layoutPolicy.columns', { module: moduleId, expected: columns.get(moduleId).id, actual: region.column }, category);
		}
		if (!finiteNumber(region.width) || !finiteNumber(region.height) || region.width <= 0 || region.height <= 0) {
			hard(findings, 'PL40-module-region-size', 'module region must declare positive finite width and height', { module: moduleId, region }, category);
		} else {
			const aspect = Math.max(region.width / Math.max(1, region.height), region.height / Math.max(1, region.width));
			if (aspect > (policy.maxModuleRegionAspect ?? 4)) {
				hard(findings, 'PL41-module-region-aspect', 'module region aspect ratio is too extreme for a readable schematic block', {
					module: moduleId,
					width: region.width,
					height: region.height,
					aspect: Number(aspect.toFixed(3)),
					maxAspect: policy.maxModuleRegionAspect ?? 4,
				}, category);
			}
		}
		const anchor = anchors[mod.anchor];
		const box = rectFromRegion(region, anchor);
		if (!box) {
			hard(findings, 'PL42-module-region-box', 'module region must resolve to a finite rectangle from module anchor, dx/dy, width, and height', { module: moduleId, anchor: mod.anchor || null, region }, category);
			continue;
		}
		regionByModule.set(moduleId, { module: moduleId, region, box, column: columns.get(moduleId)?.id || null });
	}
	const missing = [...moduleIds].filter(id => !regionByModule.has(id));
	if (missing.length) hard(findings, 'PL43-module-region-covers-modules', 'layoutPolicy.moduleRegions must cover every assembly module', { missing }, category);
	const resolved = [...regionByModule.values()];
	for (let i = 0; i < resolved.length; i++) {
		for (let j = i + 1; j < resolved.length; j++) {
			const a = resolved[i];
			const b = resolved[j];
			const gap = rectGap(a.box, b.box);
			if (gap != null && gap < minGap) {
				hard(findings, 'PL44-module-region-gap', 'planned module regions must not overlap or interlock; keep the declared minimum gap before generation', {
					minModuleGap: minGap,
					gap,
					a: { module: a.module, column: a.column, box: a.box },
					b: { module: b.module, column: b.column, box: b.box },
				}, category);
			}
		}
	}
	const actualModules = Array.isArray(options.structure?.modules) ? options.structure.modules : [];
	if (actualModules.length && regionByModule.size) {
		const actualByName = new Map();
		for (const actual of actualModules) {
			const name = actual?.name || actual?.id;
			if (name) actualByName.set(name, actual);
		}
		const fitTolerance = policy.moduleRegionFitTolerance ?? 4;
		for (const planned of regionByModule.values()) {
			const mod = moduleById.get(planned.module) || {};
			const actualName = mod.registryModule || mod.id || planned.module;
			const actual = actualByName.get(actualName) || actualByName.get(planned.module);
			if (!actual) {
				hard(findings, 'PL45-module-region-actual-present', 'final structure metrics must report the actual generated bbox for every planned module region', {
					module: planned.module,
					expectedActualNames: [...new Set([actualName, planned.module].filter(Boolean))],
					availableActualModules: [...actualByName.keys()],
				}, category);
				continue;
			}
			const actualBox = finiteRect(actual.box);
			if (!actualBox) {
				hard(findings, 'PL45-module-region-actual-present', 'final structure metrics module bbox must be finite before module region fit can be trusted', {
					module: planned.module,
					actualName: actual.name || actual.id || null,
					actualBox: actual.box || null,
				}, category);
				continue;
			}
			if (!rectContains(planned.box, actualBox, fitTolerance)) {
				hard(findings, 'PL46-module-region-contains-actual', 'actual generated module bbox must stay inside its planned module region; adjust the cell geometry or enlarge/move layoutPolicy.moduleRegions before accepting the layout', {
					module: planned.module,
					actualName: actual.name || actual.id || null,
					tolerance: fitTolerance,
					plannedBox: planned.box,
					actualBox,
				}, category);
			}
		}
	}
	return findings;
}

export function validateLayoutContract(assembly, layout, structure, options = {}) {
	const category = options.category || 'project-layout';
	const findings = [];
	const policy = assembly.layoutPolicy || {};
	const modules = asArray(assembly.modules);
	const anchors = assembly.anchors || {};
	const base = policy.baseAnchors || {};

	if (!policy.candidateSource) hard(findings, 'PL1-candidate-source-declared', 'layoutPolicy.candidateSource must be declared', {}, category);
	if (!policy.flow || typeof policy.flow !== 'string') hard(findings, 'PL14-flow-declared', 'layoutPolicy.flow must declare the intended schematic reading flow', {}, category);
	if (!asArray(policy.columns).length) hard(findings, 'PL15-columns-declared', 'layoutPolicy.columns must declare ordered module columns before layout search', {}, category);
	if (!asArray(policy.interfaceRoutes).length && asArray(options.contract?.interfaces).length) {
		hard(findings, 'PL22-interface-routes-declared', 'layoutPolicy.interfaceRoutes must declare cross-module routing intent before layout search', {}, category);
	}
	findings.push(...validateInterfaceRoutes(options.contract, assembly, category));
	findings.push(...validateLabelColumnContracts(assembly, category));
	findings.push(...validateGroupedRouteLabelColumns(options.contract, assembly, category));
	findings.push(...validateModuleRegions(assembly, category, { structure }));
	if (layout.candidateSource !== policy.candidateSource) {
		hard(findings, 'PL2-planner-uses-assembly-policy', 'layout planner report must prove candidates came from project_assembly.json layoutPolicy', {
			expected: policy.candidateSource,
			actual: layout.candidateSource,
		}, category);
	}

	for (const mod of modules) {
		if (!mod.anchor || !finitePoint(anchors[mod.anchor])) {
			hard(findings, 'PL3-module-anchor-defined', `${mod.id} module must reference a finite project anchor`, { module: mod.id, anchor: mod.anchor }, category);
		}
		if (!mod.registryModule) {
			hard(findings, 'PL4-registry-module-defined', `${mod.id} module must name its registry module for layout metrics`, { module: mod.id }, category);
		}
	}

	const columns = columnIndexByModule(policy);
	const moduleIds = new Set(modules.map(mod => mod.id));
	const columnIds = new Set();
	for (const [index, column] of asArray(policy.columns).entries()) {
		const id = column.id || `column_${index + 1}`;
		if (columnIds.has(id)) hard(findings, 'PL19-column-id-unique', 'layoutPolicy.columns ids must be unique', { column: id }, category);
		columnIds.add(id);
		if (!asArray(column.modules).length) hard(findings, 'PL20-column-nonempty', 'layoutPolicy.columns entries must contain at least one module', { column: id }, category);
	}
	const missingColumns = [...moduleIds].filter(id => !columns.has(id));
	if (missingColumns.length) {
		hard(findings, 'PL16-module-column-covered', 'layoutPolicy.columns must place every assembly module in an ordered reading-flow column', { missingColumns }, category);
	}
	for (const column of asArray(policy.columns)) {
		for (const id of asArray(column.modules)) {
			if (!moduleIds.has(id)) hard(findings, 'PL17-column-module-known', 'layoutPolicy.columns references an unknown assembly module', { column: column.id || null, module: id }, category);
		}
	}
	const orderedModules = modules
		.filter(mod => columns.has(mod.id) && finitePoint(anchors[mod.anchor]))
		.map(mod => ({ id: mod.id, x: anchors[mod.anchor].x, column: columns.get(mod.id) }));
	const columnPairs = [];
	for (const a of orderedModules) {
		for (const b of orderedModules) {
			if (a.column.index >= b.column.index) continue;
			columnPairs.push({ left: a.id, right: b.id, leftX: a.x, rightX: b.x, leftColumn: a.column.id, rightColumn: b.column.id });
		}
	}
	const reversedPairs = columnPairs.filter(pair => pair.leftX > pair.rightX);
	if (reversedPairs.length) {
		hard(findings, 'PL18-column-x-order', 'module anchors must follow the declared left-to-right layoutPolicy.columns order', { reversedPairs }, category);
	}
	const minColumnGap = policy.minColumnGap ?? 120;
	const columnGaps = measureColumnAnchorGaps(assembly);
	const narrowColumnGaps = columnGaps.pairs.filter(pair => pair.gap != null && pair.gap < minColumnGap);
	if (narrowColumnGaps.length) {
		hard(findings, 'PL21-column-gap', 'adjacent layoutPolicy.columns must have enough X separation for readable module blocks', {
			minColumnGap,
			narrowColumnGaps,
			columns: columnGaps.columns.map(col => ({ id: col.id, centerX: col.centerX, modules: col.modules })),
		}, category);
	}

	const expectedAnchors = new Set(modules.map(mod => mod.anchor).filter(Boolean));
	const missingBase = [...expectedAnchors].filter(anchor => !finitePoint(base[anchor]));
	if (missingBase.length) {
		hard(findings, 'PL5-base-anchors-cover-modules', 'layoutPolicy.baseAnchors must cover every module anchor', { missingBase }, category);
	}

	const stats = layout.policyStats || {};
	if ((stats.baseAnchors ?? 0) < expectedAnchors.size) hard(findings, 'PL6-policy-stats-base-anchors', 'planner policy stats show incomplete base anchor coverage', { stats, expectedAnchors: expectedAnchors.size }, category);
	if ((stats.anchorVariants ?? 0) < 1 && ((stats.inputRows ?? 0) < 1 || (stats.outputRows ?? 0) < 1 || (stats.xProfiles ?? 0) < 1)) {
		hard(findings, 'PL7-policy-search-space', 'layoutPolicy must define anchorVariants or inputRows/outputRows/xProfiles so layout search is project-driven', { stats }, category);
	}
	if ((layout.totalCandidates ?? 0) < 10) {
		hard(findings, 'PL8-candidate-count', 'layout planner must evaluate multiple project-policy candidates, not a single fixed coordinate set', {
			totalCandidates: layout.totalCandidates,
			availableCandidates: layout.availableCandidates,
		}, category);
	}

	const best = layout.best || {};
	if (best.pass !== true) hard(findings, 'PL9-best-layout-pass', 'layout planner best candidate must pass all local layout audits', { bestPass: best.pass, score: best.score }, category);

	const minGapRequired = policy.minModuleGap ?? 90;
	/* 模块间距对单模块项目无意义（不存在模块对），>=2 模块才校验。 */
	if (modules.length >= 2 && (structure.minModuleGap ?? 0) < minGapRequired) {
		hard(findings, 'PL10-min-module-gap', 'final layout must keep module rectangles separated by the project minimum gap', {
			minModuleGap: structure.minModuleGap,
			required: minGapRequired,
			gaps: structure.gaps,
		}, category);
	}

	if (policy.requireNoLaneInterlocks !== false && asArray(structure.laneInterlocks).length > 0) {
		hard(findings, 'PL11-no-lane-interlocks', 'final layout must not use interlocking module lanes', {
			laneInterlocks: structure.laneInterlocks,
		}, category);
	}

	const maxIntrusions = policy.maxModuleWireIntrusions ?? 0;
	const intrusionCount = structure.stats?.moduleWireIntrusions ?? asArray(structure.moduleWireIntrusions).length;
	if (intrusionCount > maxIntrusions) {
		hard(findings, 'PL12-no-wire-intrusions', 'final layout must not route wires through unrelated module spaces', {
			moduleWireIntrusions: intrusionCount,
			maxModuleWireIntrusions: maxIntrusions,
			intrusions: structure.moduleWireIntrusions,
		}, category);
	}

	if (structure.pass !== true) {
		hard(findings, 'PL13-structure-pass', 'structure_metrics report must pass for the final model', {
			severity: structure.severity,
			firstFinding: structure.findings?.[0] || null,
		}, category);
	}

	return findings;
}
