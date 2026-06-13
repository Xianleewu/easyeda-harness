import { mkdirSync, writeFileSync } from 'node:fs';

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function unique(items) {
	return [...new Set(items.filter(Boolean))];
}

function moduleVisualId(id) {
	return String(id || '').replace(/_/g, '-');
}

export function buildScaffold(spec, { pack = 'aihwdebugger' } = {}) {
	const modules = asArray(spec.modules);
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

	const anchors = Object.fromEntries(modules.map((mod, index) => [mod.id, { x: 300 + index * 240, y: 600 }]));
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
			columns: modules.map((mod, index) => ({
				id: `column_${index + 1}`,
				role: mod.title || mod.id,
				modules: [mod.id],
			})),
			minModuleGap: 90,
			maxModuleWireIntrusions: 0,
			requireNoLaneInterlocks: true,
			baseAnchors: anchors,
			inputRows: [{ y: 600 }],
			outputRows: [{ y: 600 }],
			xProfiles: [{ scaffold: true }],
		},
		modules: modules.map((mod, index) => ({
			id: mod.id,
			order: (index + 1) * 10,
			registryModule: '',
			cell: '',
			anchor: mod.id,
			refs: {},
			netArgs: {},
			nets: asArray(mod.requiredNets),
		})),
	};

	return { contract, netlist, assembly, libraryManifest };
}

export function writeScaffold({ outDir, spec, pack = 'aihwdebugger' }) {
	mkdirSync(outDir, { recursive: true });
	const normalizedSpec = { ...spec, circuitPack: spec.circuitPack || pack };
	const { contract, netlist, assembly, libraryManifest } = buildScaffold(normalizedSpec, { pack });
	const files = {
		'project_spec.json': normalizedSpec,
		'project_contract.json': contract,
		'project_netlist.json': netlist,
		'project_assembly.json': assembly,
		'approved_library_manifest.json': libraryManifest,
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
		nextStep: 'Fill requiredParts, approved library bindings, requiredPins, deterministic cell mappings, refs, registryModule, netArgs, anchors, and layoutPolicy until node bin/easyeda-gsd.mjs plan <outDir>/project_spec.json passes.',
	};
	writeFileSync(`${outDir}/gsd_scaffold_report.json`, JSON.stringify(report, null, 2) + '\n', 'utf8');
	return report;
}
