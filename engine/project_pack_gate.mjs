import { existsSync, writeFileSync } from 'node:fs';
import { circuitPackIds, getCircuitPack } from '../circuit_packs/registry.mjs';
import { loadCellManifest, readJson, resolveCellManifestPath } from './cell_manifest.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const REPORT = process.env.EASYEDA_PROJECT_PACK_REPORT || DIR + 'project_pack_report.json';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-pack', msg, where });
}

const findings = [];
let assembly = null;
let pack = null;
let manifest = null;
let manifestPath = null;

if (!existsSync(ASSEMBLY)) {
	hard(findings, 'PP0-assembly-file', 'project_assembly.json is required before pack audit', { path: ASSEMBLY });
} else {
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PP0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}

if (assembly) {
	const packId = assembly.circuitPack || 'aihwdebugger';
	try { pack = getCircuitPack(packId); } catch (e) { hard(findings, 'PP1-pack-known', 'assembly circuitPack must be registered', { circuitPack: packId, registeredPacks: circuitPackIds(), error: e.message }); }
	manifestPath = resolveCellManifestPath(assembly);
	if (!existsSync(manifestPath)) hard(findings, 'PP2-manifest-file', 'assembly cell manifest must exist', { manifestPath });
	else {
		try { manifest = loadCellManifest(manifestPath); } catch (e) { hard(findings, 'PP2-manifest-parse', 'cell manifest must parse as JSON', { manifestPath, error: e.message }); }
	}
}

if (pack) {
	if (!pack.id) hard(findings, 'PP3-pack-id', 'circuit pack must expose id');
	if (!pack.cellBuilders || typeof pack.cellBuilders !== 'object') hard(findings, 'PP4-pack-cell-builders', 'circuit pack must expose cellBuilders');
	if (!pack.fallbackAnchors || typeof pack.fallbackAnchors !== 'object') hard(findings, 'PP5-pack-fallback-anchors', 'circuit pack must expose fallbackAnchors');
	if (typeof pack.normalizeLibrarySnapshot !== 'function') hard(findings, 'PP6-pack-library-normalizer', 'circuit pack must expose normalizeLibrarySnapshot');
}
if (pack && manifest && manifest.packId !== pack.id) {
	hard(findings, 'PP7-manifest-pack-match', 'cell manifest packId must match registered pack id', { manifestPackId: manifest.packId, packId: pack.id });
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	circuitPack: assembly?.circuitPack || null,
	registeredPacks: circuitPackIds(),
	manifestPath,
	packApi: pack ? {
		id: pack.id,
		cellBuilders: Object.keys(pack.cellBuilders || {}),
		fallbackAnchors: Object.keys(pack.fallbackAnchors || {}),
		hasLibraryNormalizer: typeof pack.normalizeLibrarySnapshot === 'function',
	} : null,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project pack ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
