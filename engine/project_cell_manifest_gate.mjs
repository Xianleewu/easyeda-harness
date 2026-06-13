import { existsSync, writeFileSync } from 'node:fs';
import { CELL_BUILDERS } from './assemble.mjs';
import { asArray, cellContractMap, loadCellManifest, readJson, resolveCellManifestPath } from './cell_manifest.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const REPORT = process.env.EASYEDA_CELL_MANIFEST_REPORT || DIR + 'cell_manifest_report.json';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'cell-manifest', msg, where });
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function validateManifest(manifest, assembly, manifestPath) {
	const findings = [];
	if (manifest.schemaVersion !== 1) hard(findings, 'CM1-schema-version', 'cell manifest schemaVersion must be 1', { schemaVersion: manifest.schemaVersion });
	if (!manifest.packId) hard(findings, 'CM2-pack-id', 'cell manifest needs a stable packId');
	if (assembly.circuitPack && manifest.packId && assembly.circuitPack !== manifest.packId) {
		hard(findings, 'CM3-pack-match', 'project_assembly.json circuitPack must match cell manifest packId', {
			circuitPack: assembly.circuitPack,
			manifestPackId: manifest.packId,
			manifestPath,
		});
	}
	if (!asArray(manifest.cells).length) hard(findings, 'CM4-cells-present', 'cell manifest must declare at least one deterministic cell');

	const ids = asArray(manifest.cells).map(cell => cell.id);
	for (const duplicate of unique(ids.filter((id, index) => ids.indexOf(id) !== index))) {
		hard(findings, 'CM5-cell-id-unique', `duplicate cell id in manifest: ${duplicate}`, { cell: duplicate });
	}

	for (const [index, cell] of asArray(manifest.cells).entries()) {
		const id = cell?.id || `cell#${index}`;
		if (!cell?.id) hard(findings, 'CM6-cell-id', 'cell manifest entries need id', { index });
		if (!cell?.moduleType) hard(findings, 'CM7-module-type', `${id} needs moduleType`, { cell: id });
		if (!asArray(cell?.refs).length) hard(findings, 'CM8-ref-roles', `${id} must declare required ref roles`, { cell: id });
		if (!asArray(cell?.ports).length) hard(findings, 'CM9-ports', `${id} must declare electrical ports`, { cell: id });
		if (!cell?.layoutIntent) hard(findings, 'CM10-layout-intent', `${id} must declare layoutIntent so agents know the template purpose`, { cell: id });
		if (cell?.id && !CELL_BUILDERS[cell.id]) {
			hard(findings, 'CM11-builder-exists', `${cell.id} is declared in the manifest but has no implemented builder`, {
				cell: cell.id,
				implementedBuilders: Object.keys(CELL_BUILDERS),
			});
		}
	}

	const cells = cellContractMap(manifest);
	for (const mod of asArray(assembly.modules)) {
		if (!cells.has(mod.cell)) {
			hard(findings, 'CM12-assembly-cell-declared', `${mod.id} uses a cell not declared by the selected manifest`, {
				module: mod.id,
				cell: mod.cell,
				manifestCells: [...cells.keys()],
			});
		}
	}

	for (const cell of cells.keys()) {
		if (!asArray(assembly.modules).some(mod => mod.cell === cell)) {
			hard(findings, 'CM13-no-unused-cell-contracts', `${cell} is declared in the active manifest but unused by project_assembly.json`, { cell });
		}
	}

	return findings;
}

const findings = [];
let assembly = null;
let manifest = null;
let manifestPath = null;

if (!existsSync(ASSEMBLY)) hard(findings, 'CM0-assembly-file', 'project_assembly.json is required before cell manifest audit', { path: ASSEMBLY });
if (!findings.length) {
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'CM0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}
if (assembly) {
	manifestPath = resolveCellManifestPath(assembly);
	if (!existsSync(manifestPath)) hard(findings, 'CM0-manifest-file', 'selected cell manifest is missing', { path: manifestPath });
	else {
		try { manifest = loadCellManifest(manifestPath); } catch (e) { hard(findings, 'CM0-manifest-parse', 'cell manifest must parse as JSON', { path: manifestPath, error: e.message }); }
	}
}
if (manifest && assembly) findings.push(...validateManifest(manifest, assembly, manifestPath));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	packId: manifest?.packId || null,
	manifestPath,
	cellCount: asArray(manifest?.cells).length,
	implementedBuilders: Object.keys(CELL_BUILDERS),
	assemblyCells: unique(asArray(assembly?.modules).map(mod => mod.cell)),
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`cell manifest ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
