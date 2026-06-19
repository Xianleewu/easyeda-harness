import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { validateSpecSchema, asArray } from '../contracts/spec_schema.mjs';
import { generateContext } from './plexus_generate.mjs';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'design-brief', msg, where });
}

function soft(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'soft', category: 'design-brief', msg, where });
}

function addFinding(findings, severity, rule, msg, where = {}) {
	if (severity === 'soft') soft(findings, rule, msg, where);
	else hard(findings, rule, msg, where);
}

function moduleMap(doc) {
	return new Map(asArray(doc?.modules).map(mod => [mod.id, mod]));
}

function keyOfInterface(iface) {
	return `${iface?.net || ''}:${iface?.from || ''}:${iface?.to || ''}`;
}

function qualityChecklist(spec, contract) {
	const q = { ...(spec?.qualityPolicy || {}), ...(contract?.qualityPolicy || {}) };
	return [
		{ id: 'erc-net-ownership', item: 'Every cross-module net has one declared source/target interface.', expected: true },
		{ id: 'pin-map-complete', item: 'Every required net has concrete requiredPins or modulePins before generation.', expected: true },
		{ id: 'orthogonal-routing', item: 'Generated and live wires are orthogonal.', gate: 'contract:geometry / contract:geometry:live' },
		{ id: 'no-crossing', item: 'Different-net and unnamed wire crossings are forbidden.', gate: 'PG3-wire-crossing' },
		{ id: 'no-overlap', item: 'Text, attributes, symbols, labels, and components do not overlap.', gate: 'PG5/PG6 plus label gate' },
		{ id: 'label-columns', item: 'Visible labels are real net labels, column-budgeted, endpoint-attached, and realized.', gate: 'contract:labels / LL22' },
		{ id: 'no-net-ports', item: 'Single-sheet schematics avoid unnecessary NET PORT symbols.', expected: q.singleSheetNoNetPortsByDefault !== false },
		{ id: 'drc-zero', item: 'Final EasyEDA DRC is 0 error / 0 warning / 0 info.', expected: { errors: q.drcErrors ?? 0, warnings: q.drcWarnings ?? 0, info: q.drcInfo ?? 0 } },
	];
}

function buildBlockDiagram(spec, assembly) {
	const modules = asArray(spec?.modules).map((mod, index) => {
		const asm = asArray(assembly?.modules).find(item => item.id === mod.id) || {};
		return {
			id: mod.id,
			title: mod.title || mod.id,
			order: asm.order ?? (index + 1) * 10,
			column: asArray(assembly?.layoutPolicy?.columns).find(col => asArray(col.modules).includes(mod.id))?.id || null,
			anchor: asm.anchor || null,
			requiredNets: asArray(mod.requiredNets),
		};
	});
	const interfaces = asArray(spec?.interfaces).map(iface => {
		const route = asArray(assembly?.layoutPolicy?.interfaceRoutes).find(r => keyOfInterface(r) === keyOfInterface(iface)) || {};
		return {
			net: iface.net,
			from: iface.from,
			to: iface.to,
			strategy: route.strategy || iface.strategy || null,
			direction: route.direction || iface.direction || null,
			fromSide: route.fromSide || iface.fromSide || null,
			toSide: route.toSide || iface.toSide || null,
			channel: route.channel || null,
		};
	});
	return { modules, interfaces };
}

function buildModuleAssumptions(spec, contract, assembly) {
	const contractMods = moduleMap(contract);
	const assemblyMods = moduleMap(assembly);
	return asArray(spec?.modules).map(mod => {
		const cm = contractMods.get(mod.id) || {};
		const am = assemblyMods.get(mod.id) || {};
		return {
			module: mod.id,
			title: mod.title || cm.title || mod.id,
			requiredParts: asArray(cm.requiredParts),
			requiredNets: asArray(cm.requiredNets).length ? asArray(cm.requiredNets) : asArray(mod.requiredNets),
			cell: am.cell || null,
			registryModule: am.registryModule || null,
			visualEvidence: cm.visualEvidence || null,
			openAssumptions: [
				...(asArray(cm.requiredParts).length ? [] : ['requiredParts not filled']),
				...(am.cell ? [] : ['deterministic cell mapping not filled']),
				...(am.registryModule ? [] : ['registryModule not filled']),
			],
		};
	});
}

function buildPinNetPlan(spec, netlist) {
	const netEntries = new Map(asArray(netlist?.nets).map(net => [net.name, net]));
	const allNets = [...new Set(asArray(spec?.modules).flatMap(mod => asArray(mod.requiredNets)))];
	return allNets.map(name => {
		const entry = netEntries.get(name) || {};
		const modulePins = entry.modulePins || {};
		return {
			net: name,
			requiredPins: asArray(entry.requiredPins),
			modules: Object.keys(modulePins).length
				? Object.entries(modulePins).map(([module, pins]) => ({ module, pins: asArray(pins) }))
				: asArray(spec?.modules).filter(mod => asArray(mod.requiredNets).includes(name)).map(mod => ({ module: mod.id, pins: [] })),
			status: asArray(entry.requiredPins).length || Object.values(modulePins).some(pins => asArray(pins).length) ? 'mapped' : 'needs-pin-map',
		};
	});
}

function buildLayoutPlan(assembly) {
	const policy = assembly?.layoutPolicy || {};
	return {
		flow: policy.flow || null,
		columns: asArray(policy.columns).map(col => ({ id: col.id || null, role: col.role || null, modules: asArray(col.modules) })),
		moduleRegions: asArray(policy.moduleRegions).map(region => ({
			module: region.module || region.id || null,
			anchor: region.anchor || null,
			column: region.column || null,
			width: region.width ?? null,
			height: region.height ?? null,
		})),
		interfaceRoutes: asArray(policy.interfaceRoutes).map(route => ({
			net: route.net,
			from: route.from,
			to: route.to,
			strategy: route.strategy,
			direction: route.direction,
			fromSide: route.fromSide || null,
			toSide: route.toSide || null,
			channel: route.channel || null,
		})),
		labelColumns: asArray(policy.labelColumns).map(col => ({
			id: col.id || null,
			module: col.module || null,
			routeEnd: col.routeEnd || null,
			side: col.side || null,
			x: col.x ?? null,
			nets: asArray(col.nets),
		})),
	};
}

function nextTasks({ spec, contract, netlist, assembly }) {
	const tasks = [];
	if (!contract) tasks.push({ id: 'contract-create', target: 'project_contract.json', action: 'Create module contract from the approved spec before drawing.' });
	if (!netlist) tasks.push({ id: 'netlist-create', target: 'project_netlist.json', action: 'Create pin/net plan with requiredPins or modulePins for each net.' });
	if (!assembly) tasks.push({ id: 'assembly-create', target: 'project_assembly.json', action: 'Create layoutPolicy columns, moduleRegions, interfaceRoutes, labelColumns, and deterministic cell mappings.' });
	for (const mod of asArray(contract?.modules)) {
		if (!asArray(mod.requiredParts).length) tasks.push({ id: `parts-${mod.id}`, target: 'project_contract.json', module: mod.id, action: 'Select approved parts and fill requiredParts.' });
	}
	for (const mod of asArray(assembly?.modules)) {
		if (!mod.cell || !mod.registryModule) tasks.push({ id: `cell-${mod.id}`, target: 'project_assembly.json', module: mod.id, action: 'Bind this module to an implemented deterministic cell and registry module.' });
	}
	const unmapped = buildPinNetPlan(spec, netlist).filter(net => net.status !== 'mapped');
	if (unmapped.length) tasks.push({ id: 'pin-map', target: 'project_netlist.json', action: 'Fill concrete pin mappings for nets before full schematic generation.', nets: unmapped.slice(0, 20).map(net => net.net) });
	if (!tasks.length) tasks.push({ id: 'local-gates', target: 'acceptance', action: 'Run local accept, inspect previews, then proceed to live evidence before write-back.' });
	return tasks.slice(0, 20);
}

function isSignalNet(net) {
	return !!net && !['GND', 'SYS_3V3', 'SYS_5V', 'VBUS'].includes(net);
}

function auditCompleteness(findings, { draft, spec, contract, netlist, assembly, moduleAssumptions, pinNetPlan, layoutPlan }) {
	const severity = draft ? 'soft' : 'hard';
	if (!contract) addFinding(findings, severity, 'DB2-contract-required', 'project_contract.json is required for a generation-ready design brief', {});
	if (!netlist) addFinding(findings, severity, 'DB3-netlist-required', 'project_netlist.json is required for a generation-ready design brief', {});
	if (!assembly) addFinding(findings, severity, 'DB4-assembly-required', 'project_assembly.json is required for a generation-ready design brief', {});
	for (const item of moduleAssumptions) {
		if (item.openAssumptions.length) {
			addFinding(findings, severity, 'DB5-module-assumption-open', 'module assumptions must be closed before deterministic generation', {
				module: item.module,
				openAssumptions: item.openAssumptions,
			});
		}
	}
	for (const item of pinNetPlan) {
		if (item.status !== 'mapped') addFinding(findings, severity, 'DB6-pin-map-complete', 'every required net needs concrete requiredPins or modulePins before generation', { net: item.net });
	}
	if (!layoutPlan.flow) addFinding(findings, severity, 'DB7-layout-flow-required', 'layoutPolicy.flow must explain the schematic reading order before generation', {});
	if (!layoutPlan.columns.length) addFinding(findings, severity, 'DB8-layout-columns-required', 'layoutPolicy.columns must declare readable module columns before generation', {});
	if (!layoutPlan.moduleRegions.length) addFinding(findings, severity, 'DB9-module-regions-required', 'layoutPolicy.moduleRegions must declare module rectangles before generation', {});
	if (!layoutPlan.interfaceRoutes.length && asArray(spec?.interfaces).length) {
		addFinding(findings, severity, 'DB10-interface-routes-required', 'layoutPolicy.interfaceRoutes must explain cross-module signal ownership before generation', {});
	}
	if (!layoutPlan.labelColumns.length && asArray(spec?.interfaces).some(iface => isSignalNet(iface.net))) {
		addFinding(findings, severity, 'DB11-label-columns-required', 'layoutPolicy.labelColumns must budget visible signal labels before generation', {});
	}
	const labelColumns = layoutPlan.labelColumns;
	for (const iface of asArray(spec?.interfaces)) {
		const route = layoutPlan.interfaceRoutes.find(r => keyOfInterface(r) === keyOfInterface(iface)) || {};
		const strategy = route.strategy || iface.strategy;
		if (strategy !== 'grouped-net-label' || !isSignalNet(iface.net)) continue;
		const fromSide = route.fromSide || iface.fromSide || 'right';
		const toSide = route.toSide || iface.toSide || 'left';
		const fromOk = labelColumns.some(col => col.module === iface.from && col.routeEnd === 'from' && col.side === fromSide && col.nets.includes(iface.net));
		const toOk = labelColumns.some(col => col.module === iface.to && col.routeEnd === 'to' && col.side === toSide && col.nets.includes(iface.net));
		if (!fromOk || !toOk) {
			addFinding(findings, severity, 'DB12-grouped-interface-label-columns', 'grouped-net-label interfaces need source and target label columns with matching side and routeEnd', {
				interface: iface,
				expected: { fromSide, toSide },
				fromOk,
				toOk,
			});
		}
	}
}

export function buildDesignBrief(root, specPath = 'project_spec.json', options = {}) {
	const context = generateContext(root, specPath);
	const draft = options.draft === true;
	const findings = [];
	let spec = null;
	let contract = null;
	let netlist = null;
	let assembly = null;
	if (!existsSync(context.specAbs)) {
		hard(findings, 'DB0-spec-file', 'project_spec.json is required before a design brief can be generated', { path: context.specAbs });
	} else {
		try { spec = readJson(context.specAbs); } catch (e) { hard(findings, 'DB0-spec-parse', 'project_spec.json must parse as JSON', { error: e.message }); }
	}
	if (spec) findings.push(...validateSpecSchema(spec).map(f => ({ ...f, category: 'design-brief' })));
	for (const [key, path] of Object.entries({ contract: context.contractPath, netlist: context.netlistPath, assembly: context.assemblyPath })) {
		if (!existsSync(path)) {
			addFinding(findings, draft ? 'soft' : 'hard', `DB1-${key}-missing`, `${key} file is missing; brief will include open tasks`, { path });
			continue;
		}
		try {
			if (key === 'contract') contract = readJson(path);
			if (key === 'netlist') netlist = readJson(path);
			if (key === 'assembly') assembly = readJson(path);
		} catch (e) {
			hard(findings, `DB1-${key}-parse`, `${key} file must parse as JSON`, { path, error: e.message });
		}
	}
	const blockDiagram = buildBlockDiagram(spec, assembly);
	const moduleAssumptions = buildModuleAssumptions(spec, contract, assembly);
	const pinNetPlan = buildPinNetPlan(spec, netlist);
	const layoutPlan = buildLayoutPlan(assembly);
	auditCompleteness(findings, { draft, spec, contract, netlist, assembly, moduleAssumptions, pinNetPlan, layoutPlan });
	const hardCount = findings.filter(f => f.severity === 'hard').length;
	const softCount = findings.filter(f => f.severity === 'soft').length;
	const report = {
		generatedAt: new Date().toISOString(),
		pass: hardCount === 0,
		mode: draft ? 'design-brief-draft' : 'design-brief',
		draft,
		spec: specPath,
		projectId: spec?.projectId || contract?.projectId || null,
		circuitPack: spec?.circuitPack || assembly?.circuitPack || null,
		severity: { hard: hardCount, soft: softCount, info: 0 },
		blockDiagram,
		moduleAssumptions,
		pinNetPlan,
		layoutPlan,
		ercChecklist: qualityChecklist(spec, contract),
		nextTasks: nextTasks({ spec, contract, netlist, assembly }),
		findings,
	};
	return report;
}

export function writeDesignBrief(root, specPath = 'project_spec.json', reportPath = `${root.replace(/\\/g, '/')}/design_brief_report.json`, options = {}) {
	const report = buildDesignBrief(root.replace(/\\/g, '/'), specPath, options);
	writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
	return report;
}
