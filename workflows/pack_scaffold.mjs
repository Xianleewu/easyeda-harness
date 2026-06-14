import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

export function validatePackId(packId) {
	const id = String(packId || '').trim();
	if (!/^[a-z][a-z0-9_]*$/.test(id)) {
		throw new Error('pack id must match /^[a-z][a-z0-9_]*$/');
	}
	return id;
}

function writeIfMissing(path, content) {
	if (existsSync(path)) return { path, status: 'exists' };
	writeFileSync(path, content, 'utf8');
	return { path, status: 'created' };
}

function packSource(packId) {
	return `export const fallbackAnchors = {};
export const cellBuilders = {};

export function normalizeLibrarySnapshot(snap) {
\treturn snap;
}

export const writer = {
\tid: '${packId}-writer',
\tscaffoldOnly: true,
\tgenerate: 'circuit_packs/${packId}/apply_writer.mjs',
\trun: 'circuit_packs/${packId}/apply_run.mjs',
};

export const pack = {
\tid: '${packId}',
\tscaffoldOnly: true,
\tfallbackAnchors,
\tcellBuilders,
\tnormalizeLibrarySnapshot,
\twriter,
};
`;
}

function applyWriterSource(packId) {
	return `if (process.env.EASYEDA_APPLY_WRITER_AUTHORIZED !== '1') {
\tconsole.error('ABORT: apply writer is only callable through apply:gated.');
\tprocess.exit(1);
}

console.error('ABORT: ${packId} apply writer scaffold is not implemented. Generate EasyEDA write-back JS from full_model.json here.');
process.exit(2);
`;
}

function applyRunSource(packId) {
	return `if (process.env.EASYEDA_APPLY_WRITER_AUTHORIZED !== '1' || process.env.EASYEDA_APPLY_RUN_AUTHORIZED !== '1') {
\tconsole.error('ABORT: apply runner is only callable through apply:gated.');
\tprocess.exit(1);
}
if (!process.argv.includes('--force')) {
\tconsole.error('ABORT: ${packId} apply runner requires --force from apply:gated.');
\tprocess.exit(1);
}

console.error('ABORT: ${packId} apply runner scaffold is not implemented. Execute generated EasyEDA JS chunks here.');
process.exit(2);
`;
}

function moduleCellId(moduleId) {
	return `${String(moduleId || 'module').replace(/[^A-Za-z0-9_]/g, '_')}_cell`;
}

function portKind(net) {
	const name = String(net || '').toUpperCase();
	if (name === 'GND' || name.endsWith('_GND')) return 'gnd';
	if (['VCC', 'VDD', 'VBUS'].includes(name) || /(^|_)(3V3|5V|12V|VIN|VOUT|PWR|POWER|SUPPLY)(_|$)/.test(name)) return 'power';
	return 'sig';
}

function portSide(moduleIndex, moduleCount, kind) {
	if (kind !== 'sig') return kind === 'gnd' ? 'local' : 'top';
	if (moduleCount <= 1) return 'right';
	return moduleIndex === 0 ? 'right' : moduleIndex === moduleCount - 1 ? 'left' : 'right';
}

export function buildCellManifestTemplate(packId, spec = null) {
	const modules = Array.isArray(spec?.modules) ? spec.modules : [];
	return {
		schemaVersion: 1,
		packId,
		purpose: `Scaffold cell contracts for the ${packId} circuit pack. Fill cells and builders before generation.`,
		requiredQualityRules: [
			'orthogonal-wiring',
			'real-net-labels',
			'text-clearance',
			'module-box-isolation',
			'no-fake-net-text',
			'no-unnecessary-net-ports',
		],
		cellTemplate: {
			geometryContract: {
				orthogonalWiresOnly: true,
				noLocalWireCrossings: true,
				noWiresThroughComponentBodies: true,
				noVisibleObjectOverlaps: true,
				checkedBy: ['gsd:plan cell-builder dry-run', 'contract:geometry', 'contract:geometry:live'],
			},
			labelContract: {
				visibleSignalLabelsMustUseRealNetflags: true,
				floatingLabelsAllowed: false,
				leftSideAlignMode: 6,
				rightSideAlignMode: 8,
				labelColumnsSource: 'project_assembly.layoutPolicy.labelColumns',
				checkedBy: ['contract:labels', 'contract:labels:live'],
			},
			portLayout: {
				EXAMPLE_INPUT: { side: 'left', kind: 'sig', label: 'required' },
				EXAMPLE_OUTPUT: { side: 'right', kind: 'sig', label: 'required' },
				GND: { side: 'local', kind: 'gnd', label: 'optional' },
			},
		},
		cells: modules.map((mod, index) => {
			const ports = [...new Set((Array.isArray(mod.requiredNets) ? mod.requiredNets : []).filter(Boolean))];
			const portLayout = Object.fromEntries(ports.map(net => {
				const kind = portKind(net);
				return [net, {
					side: portSide(index, modules.length, kind),
					kind,
					label: kind === 'sig' ? 'required' : 'optional',
				}];
			}));
			return {
				id: moduleCellId(mod.id),
				moduleType: mod.id || `module_${index + 1}`,
				refs: ['MAIN'],
				optionalRefs: [],
				netArgs: [],
				ports,
				portLayout,
				layoutIntent: mod.title || mod.id || `module ${index + 1}`,
				qualityRules: [
					'orthogonal-wiring',
					'real-net-labels',
					'text-clearance',
					'module-box-isolation',
					'no-fake-net-text',
					'no-unnecessary-net-ports',
				],
			};
		}),
	};
}

function manifestSource(packId, spec = null) {
	return `${JSON.stringify({
		...buildCellManifestTemplate(packId, spec),
	}, null, 2)}\n`;
}

function registrySource(root) {
	const circuitPacksDir = `${root.replace(/\\/g, '/')}/circuit_packs`;
	const packIds = readdirSync(circuitPacksDir, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.filter(id => existsSync(`${circuitPacksDir}/${id}/pack.mjs`))
		.sort();
	const imports = packIds.map(id => `import { pack as ${id} } from './${id}/pack.mjs';`).join('\n');
	const entries = packIds.map(id => `\t[${id}.id, ${id}],`).join('\n');
	return `// Generated by workflows/pack_scaffold.mjs when circuit packs are added.
// Keep imports static so generator and gates remain synchronous.
${imports}

const PACKS = new Map([
${entries}
]);

export function getCircuitPack(id = 'aihwdebugger') {
\tconst pack = PACKS.get(id || 'aihwdebugger');
\tif (!pack) throw new Error(\`Unknown circuit pack: \${id}\`);
\treturn pack;
}

export function circuitPackIds() {
\treturn [...PACKS.keys()];
}
`;
}

export function syncPackRegistry(root) {
	const path = `${root.replace(/\\/g, '/')}/circuit_packs/registry.mjs`;
	const next = registrySource(root);
	const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
	if (before === next) return { path, status: 'unchanged' };
	writeFileSync(path, next, 'utf8');
	return { path, status: before ? 'updated' : 'created' };
}

export function buildMinimalSpec(packId) {
	return {
		schemaVersion: 1,
		projectId: `${packId}-project`,
		circuitPack: packId,
		intent: 'Scaffolded EasyEDA schematic project. Replace this with the real circuit intent before generation.',
		modules: [
			{ id: 'module_1', title: 'First module', requiredNets: ['NET_1', 'GND'] },
		],
		interfaces: [],
		qualityPolicy: {
			severityMustBeZero: true,
			drcErrors: 0,
			drcWarnings: 0,
			drcInfo: 0,
			singleSheetNoNetPortsByDefault: true,
			fakeTextNetLabelsAllowed: false,
		},
	};
}

export function writePackScaffold({ root, packId, spec = null }) {
	const id = validatePackId(packId);
	const dir = `${root.replace(/\\/g, '/')}/circuit_packs/${id}`;
	mkdirSync(dir, { recursive: true });
	const files = [
		writeIfMissing(`${dir}/pack.mjs`, packSource(id)),
		writeIfMissing(`${dir}/apply_writer.mjs`, applyWriterSource(id)),
		writeIfMissing(`${dir}/apply_run.mjs`, applyRunSource(id)),
		writeIfMissing(`${dir}/cell_manifest.json`, manifestSource(id, spec)),
		syncPackRegistry(root),
	];
	return {
		generatedAt: new Date().toISOString(),
		pass: true,
		packId: id,
		dir,
		readyForGenerate: false,
		files,
		nextStep: `Implement circuit_packs/${id}/pack.mjs cellBuilders, circuit_packs/${id}/cell_manifest.json, and the pack writer entrypoints, then fill project_contract.json, project_netlist.json, approved_library_manifest.json, and project_assembly.json until plan passes and apply:gated writer preflight passes.`,
	};
}
