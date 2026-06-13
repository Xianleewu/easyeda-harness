import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_MANIFEST = DIR + 'circuit_packs/aihwdebugger/cell_manifest.json';

export function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

export function resolveCellManifestPath(assembly = null, basePath = '') {
	const rel = assembly?.cellManifest || assembly?.cellManifestPath || 'circuit_packs/aihwdebugger/cell_manifest.json';
	if (/^[A-Za-z]:[\\/]/.test(rel) || rel.startsWith('/')) return rel.replace(/\\/g, '/');
	if (basePath) {
		const normalizedBase = basePath.replace(/\\/g, '/');
		const baseDir = normalizedBase.endsWith('.json') ? dirname(normalizedBase).replace(/\\/g, '/') : normalizedBase.replace(/\/$/, '');
		const local = `${baseDir}/${rel}`.replace(/\\/g, '/');
		if (existsSync(local)) return local;
		const rootRelative = (DIR + rel).replace(/\\/g, '/');
		if (existsSync(rootRelative)) return rootRelative;
		return local;
	}
	return (DIR + rel).replace(/\\/g, '/');
}

export function loadCellManifest(path = DEFAULT_MANIFEST) {
	if (!existsSync(path)) throw new Error(`cell manifest not found: ${path}`);
	const manifest = readJson(path);
	return {
		...manifest,
		cells: asArray(manifest.cells),
	};
}

export function cellContractMap(manifest) {
	return new Map(asArray(manifest?.cells).map(cell => [cell.id, {
		refs: asArray(cell.refs),
		optionalRefs: asArray(cell.optionalRefs),
		netArgs: asArray(cell.netArgs),
		ports: asArray(cell.ports),
		moduleType: cell.moduleType || '',
		layoutIntent: cell.layoutIntent || '',
	}]));
}
