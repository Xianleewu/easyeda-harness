// 确定性整图组装（与 AI 无关）
import { readFileSync } from 'node:fs';
import { withLocalPins } from './transform.mjs';
import { buildModel } from './buildmodel.mjs';
import { relayDriver, ldoCell, buttonCell, mcuCell, usbCell, pmosCell } from './cells.mjs';
import { buildDocumentLayer } from '../harness/document_style.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const PROJECT_ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';

const FALLBACK_ANCHORS = {
	usb:   { x: 620,  y: 980 },
	ldo:   { x: 440,  y: 800 },
	btn1:  { x: 760,  y: 520 },
	btn2:  { x: 1000, y: 520 },
	mcu:   { x: 920,  y: 820 },
	pmos:  { x: 1340, y: 780 },
	relay1:{ x: 1720, y: 740 },
	relay2:{ x: 1720, y: 475 },
};

const CELL_BUILDERS = {
	usbCell,
	ldoCell,
	buttonCell,
	mcuCell,
	pmosCell,
	relayDriver,
};

let cachedAssemblyPath = null;
let cachedAssembly = null;

function cloneAnchors(anchors) {
	return Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, { ...v }]));
}

export function loadProjectAssembly(path = PROJECT_ASSEMBLY) {
	const assembly = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	return {
		...assembly,
		anchors: assembly.anchors || FALLBACK_ANCHORS,
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
	for (const c of snap.components || []) {
		if (c.designator === 'Q1') {
			for (const p of c.pins || []) {
				if (['5', '6', '7', '8'].includes(String(p.num))) p.x = c.x + 25;
			}
			if (c.bbox) c.bbox.maxX = Math.min(c.bbox.maxX, c.x + 25.5);
		}
		if (c.designator === 'SW1' || c.designator === 'SW2') {
			const mk = (num, name, dx, dy, rot) => ({ num, name, x: c.x + dx, y: c.y + dy, rot, len: 10 });
			c.pins = [
				mk('1', '1', -20, 10, 180),
				mk('2', '2', -20, -10, 180),
				mk('3', '3', -20, -20, 180),
				mk('4', '4', 20, -20, 0),
				mk('5', '5', 20, 10, 0),
				mk('6', '6', 20, -10, 0),
			];
			if (c.bbox) {
				c.bbox.minX = c.x - 10.5;
				c.bbox.maxX = c.x + 10.5;
				c.bbox.minY = c.y - 20.5;
				c.bbox.maxY = c.y + 10.5;
			}
		}
	}
	const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
	return { snap, byDes };
}

export function assemble(byDes, anchors = null, assembly = projectAssembly()) {
	const resolvedAnchors = { ...cloneAnchors(assembly.anchors || FALLBACK_ANCHORS), ...(anchors ? cloneAnchors(anchors) : {}) };
	const cells = [];
	for (const mod of assembly.modules || []) {
		const build = CELL_BUILDERS[mod.cell];
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
