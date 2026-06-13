// 确定性整图组装（与 AI 无关）
import { readFileSync } from 'node:fs';
import { withLocalPins } from './transform.mjs';
import { buildModel } from './buildmodel.mjs';
import { buildDocumentLayer } from '../harness/document_style.mjs';
import { getCircuitPack } from '../circuit_packs/registry.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const PROJECT_ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';

export const CELL_BUILDERS = getCircuitPack('aihwdebugger').cellBuilders;

let cachedAssemblyPath = null;
let cachedAssembly = null;

function cloneAnchors(anchors) {
	return Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, { ...v }]));
}

export function loadProjectAssembly(path = PROJECT_ASSEMBLY) {
	const assembly = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	const pack = getCircuitPack(assembly.circuitPack || 'aihwdebugger');
	return {
		...assembly,
		anchors: assembly.anchors || pack.fallbackAnchors,
		modules: [...(assembly.modules || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
	};
}

function projectAssembly() {
	if (!cachedAssembly || cachedAssemblyPath !== PROJECT_ASSEMBLY) {
		cachedAssemblyPath = PROJECT_ASSEMBLY;
		cachedAssembly = loadProjectAssembly(PROJECT_ASSEMBLY);
	}
	return cachedAssembly;
}

export function loadPartLib(snapPath) {
	const snap = JSON.parse(readFileSync(snapPath, 'utf8').replace(/^\uFEFF/, ''));
	const assembly = projectAssembly();
	const pack = getCircuitPack(assembly.circuitPack || 'aihwdebugger');
	const normalizedSnap = pack.normalizeLibrarySnapshot ? pack.normalizeLibrarySnapshot(snap) : snap;
	const byDes = new Map(normalizedSnap.components.map(c => [c.designator, withLocalPins(c)]));
	return { snap: normalizedSnap, byDes };
}

export function assemble(byDes, anchors = null, assembly = projectAssembly()) {
	const pack = getCircuitPack(assembly.circuitPack || 'aihwdebugger');
	const cellBuilders = pack.cellBuilders || {};
	const resolvedAnchors = { ...cloneAnchors(assembly.anchors || pack.fallbackAnchors), ...(anchors ? cloneAnchors(anchors) : {}) };
	const cells = [];
	for (const mod of assembly.modules || []) {
		const build = cellBuilders[mod.cell];
		if (!build) throw new Error(`Unknown assembly cell ${mod.cell} for module ${mod.id}`);
		const anchor = resolvedAnchors[mod.anchor];
		if (!anchor) throw new Error(`Missing assembly anchor ${mod.anchor} for module ${mod.id}`);
		cells.push(build(byDes, mod.refs || {}, anchor, mod.netArgs || {}));
	}
	const place = {}, wires = [], flags = [], noConnects = [];
	for (const c of cells) {
		Object.assign(place, c.place);
		wires.push(...c.wires);
		flags.push(...c.flags);
		if (c.noConnects) noConnects.push(...c.noConnects);
	}
	const model = buildModel(byDes, { place, wires, flags, noConnects });
	model.writeModuleFrames = true;
	const documentLayer = buildDocumentLayer(model);
	return {
		...model,
		writeModuleFrames: true,
		...documentLayer,
		layoutProfile: {
			name: assembly.layoutProfile || 'project_assembly',
			projectId: assembly.projectId || null,
			generatedAt: new Date().toISOString(),
			anchors: cloneAnchors(resolvedAnchors),
			modules: (assembly.modules || []).map(mod => ({ id: mod.id, cell: mod.cell, anchor: mod.anchor })),
		},
	};
}

export function assembleFromSnap(snapPath, anchors) {
	if (snapPath instanceof Map) return assemble(snapPath, anchors);
	const { byDes } = loadPartLib(snapPath);
	return assemble(byDes, anchors);
}
