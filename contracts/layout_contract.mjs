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

function labelColumnCovers(columns, route, side, moduleId) {
	return asArray(columns).some(col => {
		if (col.side !== side) return false;
		if (!asArray(col.nets).includes(route.net)) return false;
		if (col.module && col.module !== moduleId) return false;
		if (col.routeEnd && col.routeEnd !== (side === 'right' ? 'from' : 'to')) return false;
		return true;
	});
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
		const fromCovered = labelColumnCovers(columns, route, 'right', route.from);
		const toCovered = labelColumnCovers(columns, route, 'left', route.to);
		if (!fromCovered) {
			hard(findings, 'PL31-label-column-covers-route-from', 'each grouped-net-label route needs a right-side output label column for its source module', {
				route,
				expected: { side: 'right', module: route.from, net: route.net, routeEnd: 'from' },
				candidateColumns: columns.filter(col => asArray(col.nets).includes(route.net)).map(col => ({ id: col.id || null, side: col.side || null, module: col.module || null, routeEnd: col.routeEnd || null, x: col.x ?? null })),
			}, category);
		}
		if (!toCovered) {
			hard(findings, 'PL32-label-column-covers-route-to', 'each grouped-net-label route needs a left-side input label column for its target module', {
				route,
				expected: { side: 'left', module: route.to, net: route.net, routeEnd: 'to' },
				candidateColumns: columns.filter(col => asArray(col.nets).includes(route.net)).map(col => ({ id: col.id || null, side: col.side || null, module: col.module || null, routeEnd: col.routeEnd || null, x: col.x ?? null })),
			}, category);
		}
	}
	for (const iface of asArray(contract?.interfaces)) {
		const route = groupedRoutes.find(r => r.net === iface.net && r.from === iface.from && r.to === iface.to);
		if (!route) continue;
		if (!labelColumnCovers(columns, route, 'right', iface.from) || !labelColumnCovers(columns, route, 'left', iface.to)) {
			hard(findings, 'PL33-label-column-covers-interface', 'each grouped-net-label contract interface must have source and target label-column coverage', {
				interface: iface,
			}, category);
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
	findings.push(...validateGroupedRouteLabelColumns(options.contract, assembly, category));
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
	if ((structure.minModuleGap ?? 0) < minGapRequired) {
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
