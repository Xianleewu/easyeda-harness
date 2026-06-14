import { mkdirSync, writeFileSync } from 'node:fs';
import { REQUIRED_DRAWING_RULES, REQUIRED_RULE_PROFILE } from '../contracts/module_contract.mjs';
import { buildCellManifestTemplate } from './pack_scaffold.mjs';

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function unique(items) {
	return [...new Set(items.filter(Boolean))];
}

function moduleVisualId(id) {
	return String(id || '').replace(/_/g, '-');
}

export function buildScaffold(spec, { pack = 'aihwdebugger', useGeneratedCells = false } = {}) {
	const modules = asArray(spec.modules);
	const generatedManifest = buildCellManifestTemplate(spec.circuitPack || pack, spec);
	const generatedCellsByModule = new Map(asArray(generatedManifest.cells).map(cell => [cell.moduleType, cell]));
	const visualEvidenceRegions = unique([
		'global-sheet',
		...modules.map(mod => moduleVisualId(mod.id)),
		'title-template',
	]);
	const contract = {
		schemaVersion: 1,
		projectId: spec.projectId || 'new-easyeda-project',
		status: 'scaffold',
		intent: spec.intent || 'Scaffolded EasyEDA schematic workflow.',
		agentWorkflow: {
			freeDrawAllowed: false,
			authoritativeEditPath: 'project_spec.json -> project contract -> project_netlist.json -> project_assembly.json -> deterministic cells -> gates -> gated write-back',
			requiredEntrypoints: ['accept', 'accept:live', 'apply:gated'],
		},
		modules: modules.map(mod => ({
			id: mod.id,
			title: mod.title || mod.id,
			requiredParts: [],
			requiredNets: asArray(mod.requiredNets),
			visualEvidence: moduleVisualId(mod.id),
			drawingRules: [...REQUIRED_DRAWING_RULES],
		})),
		interfaces: asArray(spec.interfaces).map(iface => ({ ...iface, policy: iface.policy || 'visible-or-grouped-contract' })),
		visualEvidenceRegions,
		qualityPolicy: {
			severityMustBeZero: true,
			drcErrors: 0,
			drcWarnings: 0,
			drcInfo: 0,
			singleSheetNoNetPortsByDefault: true,
			fakeTextNetLabelsAllowed: false,
			wireNameLeftAlignMode: 6,
			wireNameRightAlignMode: 8,
			ruleProfile: { ...REQUIRED_RULE_PROFILE },
			...(spec.qualityPolicy || {}),
		},
	};

	const moduleIdsByNet = new Map();
	for (const mod of modules) {
		for (const net of asArray(mod.requiredNets)) {
			if (!moduleIdsByNet.has(net)) moduleIdsByNet.set(net, []);
			moduleIdsByNet.get(net).push(mod.id);
		}
	}
	const netlist = {
		schemaVersion: 1,
		projectId: contract.projectId,
		source: 'project_spec.json scaffold',
		nets: [...moduleIdsByNet.entries()].map(([name, moduleIds]) => ({
			name,
			requiredPins: [],
			modulePins: Object.fromEntries(moduleIds.map(id => [id, []])),
		})),
		allowedAnonymousNets: [],
	};
	const libraryManifest = {
		generatedFrom: 'gsd scaffold',
		purpose: 'Approved EasyEDA library bindings for this project. Fill every contract requiredPart before generation.',
		bindingKeys: ['Symbol', 'Device', 'Footprint'],
		parts: {},
	};
	const librarySnapshot = {
		project: contract.projectId,
		source: 'project_library_snapshot.json scaffold',
		components: [],
		netflags: [],
		wires: [],
		texts: [],
	};

	const anchors = Object.fromEntries(modules.map((mod, index) => [mod.id, { x: 300 + index * 240, y: 600 }]));
	const columns = modules.map((mod, index) => ({
		id: `column_${index + 1}`,
		role: mod.title || mod.id,
		modules: [mod.id],
	}));
	const moduleRegions = modules.map((mod, index) => ({
		module: mod.id,
		anchor: mod.id,
		column: columns[index].id,
		dx: 0,
		dy: 0,
		width: 180,
		height: 140,
		role: mod.title || mod.id,
	}));
	const anchorVariants = [
		{ id: 'base', dxStep: 0, dy: 0 },
		{ id: 'compact-right', dxStep: 20, dy: 0 },
		{ id: 'wide-right', dxStep: 60, dy: 0 },
		{ id: 'raise-row', dxStep: 0, dy: -80 },
		{ id: 'lower-row', dxStep: 0, dy: 80 },
		{ id: 'wide-lower', dxStep: 60, dy: 80 },
		{ id: 'wide-raise', dxStep: 60, dy: -80 },
		{ id: 'compact-lower', dxStep: 20, dy: 80 },
		{ id: 'compact-raise', dxStep: 20, dy: -80 },
		{ id: 'staggered', dxStep: 40, dy: 0, stagger: 50 },
	].map(variant => ({
		id: variant.id,
		anchors: Object.fromEntries(modules.map((mod, index) => [mod.id, {
			dx: index * variant.dxStep,
			dy: variant.dy + (variant.stagger && index % 2 ? variant.stagger : 0),
		}])),
	}));
	const interfaceRoutes = asArray(contract.interfaces).map(iface => ({
		net: iface.net,
		from: iface.from,
		to: iface.to,
		strategy: iface.strategy || 'grouped-net-label',
		channel: `${iface.from || 'source'}-to-${iface.to || 'target'}`,
		direction: 'left-to-right',
	}));
	const groupedSignalRoutes = interfaceRoutes.filter(route => route.strategy === 'grouped-net-label' && route.net && !['GND', 'SYS_3V3', 'SYS_5V', 'VBUS'].includes(route.net));
	const labelColumnMap = new Map();
	function addLabelColumn({ moduleId, side, routeEnd, net }) {
		const x = anchors[moduleId]?.x == null ? (side === 'left' ? 540 : 300) : anchors[moduleId].x + (side === 'left' ? -90 : 90);
		const key = `${moduleId || 'module'}:${side}:${routeEnd}:${x}`;
		if (!labelColumnMap.has(key)) {
			labelColumnMap.set(key, {
				id: `${moduleId || 'module'}_${routeEnd}_${side}_labels`,
				role: `${moduleId || 'module'} ${routeEnd === 'from' ? 'output' : 'input'} interface labels aligned on a single ${side} column`,
				module: moduleId || '',
				routeEnd,
				side,
				x,
				tolerance: 4,
				nets: [],
			});
		}
		const col = labelColumnMap.get(key);
		if (!col.nets.includes(net)) col.nets.push(net);
	}
	for (const route of groupedSignalRoutes) {
		addLabelColumn({ moduleId: route.from, side: 'right', routeEnd: 'from', net: route.net });
		addLabelColumn({ moduleId: route.to, side: 'left', routeEnd: 'to', net: route.net });
	}
	const labelColumns = [...labelColumnMap.values()];
	const assembly = {
		schemaVersion: 1,
		projectId: contract.projectId,
		circuitPack: spec.circuitPack || pack,
		cellManifest: `circuit_packs/${spec.circuitPack || pack}/cell_manifest.json`,
		layoutProfile: 'scaffold',
		agentPolicy: {
			freeDrawAllowed: false,
			authoritativeEditPath: 'project_spec.json -> project contract -> project_netlist.json -> project_assembly.json -> deterministic cells -> gates -> gated write-back',
		},
		anchors,
		layoutPolicy: {
			candidateSource: 'project_assembly.layoutPolicy',
			flow: 'left-to-right: fill ordered functional columns before generation',
			columns,
			moduleRegions,
			minModuleGap: 90,
			minColumnGap: 120,
			maxModuleWireIntrusions: 0,
			requireNoLaneInterlocks: true,
			interfaceRoutes,
			labelColumns,
			baseAnchors: anchors,
			anchorVariants,
			inputRows: [{ y: 600 }],
			outputRows: [{ y: 600 }],
			xProfiles: [{ scaffold: true }],
		},
		modules: modules.map((mod, index) => ({
			id: mod.id,
			order: (index + 1) * 10,
			registryModule: useGeneratedCells ? mod.id : '',
			cell: useGeneratedCells ? (generatedCellsByModule.get(mod.id)?.id || '') : '',
			anchor: mod.id,
			refs: {},
			netArgs: {},
			nets: asArray(mod.requiredNets),
		})),
	};

	return { contract, netlist, assembly, libraryManifest, librarySnapshot };
}

export function writeScaffold({ outDir, spec, pack = 'aihwdebugger', useGeneratedCells = false }) {
	mkdirSync(outDir, { recursive: true });
	const normalizedSpec = { ...spec, circuitPack: spec.circuitPack || pack };
	const { contract, netlist, assembly, libraryManifest, librarySnapshot } = buildScaffold(normalizedSpec, { pack, useGeneratedCells });
	const files = {
		'project_spec.json': normalizedSpec,
		'project_contract.json': contract,
		'project_netlist.json': netlist,
		'project_assembly.json': assembly,
		'approved_library_manifest.json': libraryManifest,
		'project_library_snapshot.json': librarySnapshot,
	};
	for (const [name, data] of Object.entries(files)) {
		writeFileSync(`${outDir}/${name}`, JSON.stringify(data, null, 2) + '\n', 'utf8');
	}
	const report = {
		generatedAt: new Date().toISOString(),
		pass: true,
		mode: 'scaffold',
		outDir,
		circuitPack: normalizedSpec.circuitPack,
		files: Object.keys(files),
		readyForGenerate: false,
		nextStep: 'Fill requiredParts, approved library bindings, requiredPins, deterministic cell mappings, refs, registryModule, netArgs, portLayout, layoutPolicy.labelColumns, anchors, and writer implementation until node bin/easyeda-gsd.mjs plan <outDir>/project_spec.json passes.',
	};
	writeFileSync(`${outDir}/gsd_scaffold_report.json`, JSON.stringify(report, null, 2) + '\n', 'utf8');
	return report;
}
