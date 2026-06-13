import { existsSync, writeFileSync } from 'node:fs';
import { asArray, cellContractMap, loadCellManifest, readJson, resolveCellManifestPath } from './cell_manifest.mjs';
import { withLocalPins } from './transform.mjs';
import { getCircuitPack } from '../circuit_packs/registry.mjs';
import { validateCellBuilderDryRun } from '../contracts/cell_builder_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const PART_LIB = process.env.EASYEDA_PART_LIB || DIR + 'snap2.json';
const REPORT = process.env.EASYEDA_CELL_MANIFEST_REPORT || DIR + 'cell_manifest_report.json';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'cell-manifest', msg, where });
}

function unique(values) {
	return [...new Set(values.filter(Boolean))];
}

function validateManifest(manifest, assembly, manifestPath, pack) {
	const findings = [];
	const requiredQualityRules = asArray(manifest.requiredQualityRules).length ? manifest.requiredQualityRules : [
		'orthogonal-wiring',
		'real-net-labels',
		'text-clearance',
		'module-box-isolation',
		'no-fake-net-text',
		'no-unnecessary-net-ports',
	];
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
	if (!asArray(manifest.requiredQualityRules).length) hard(findings, 'CM14-quality-rules-present', 'cell manifest must declare requiredQualityRules for reusable schematic quality contracts');

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
		const qualityRules = new Set(asArray(cell?.qualityRules));
		if (qualityRules.has('real-net-labels')) {
			if (!cell?.portLayout || typeof cell.portLayout !== 'object') {
				hard(findings, 'CM16-port-layout', `${id} must declare portLayout for executable net-label placement checks`, { cell: id });
			} else {
				for (const port of asArray(cell?.ports)) {
					const layout = cell.portLayout[port];
					if (!layout || typeof layout !== 'object') {
						hard(findings, 'CM17-port-layout-covers-ports', `${id} portLayout must cover every declared port`, { cell: id, port });
						continue;
					}
					if (!['left', 'right', 'top', 'bottom', 'local'].includes(layout.side)) {
						hard(findings, 'CM18-port-layout-side', `${id} ${port} portLayout.side must be left/right/top/bottom/local`, { cell: id, port, side: layout.side });
					}
					if (!['sig', 'power', 'gnd'].includes(layout.kind)) {
						hard(findings, 'CM19-port-layout-kind', `${id} ${port} portLayout.kind must be sig/power/gnd`, { cell: id, port, kind: layout.kind });
					}
					if (!['required', 'optional', 'forbidden'].includes(layout.label || 'optional')) {
						hard(findings, 'CM20-port-layout-label', `${id} ${port} portLayout.label must be required/optional/forbidden`, { cell: id, port, label: layout.label });
					}
				}
			}
		}
		if (!cell?.layoutIntent) hard(findings, 'CM10-layout-intent', `${id} must declare layoutIntent so agents know the template purpose`, { cell: id });
		const missingQualityRules = requiredQualityRules.filter(rule => !qualityRules.has(rule));
		if (missingQualityRules.length) {
			hard(findings, 'CM15-cell-quality-rules', `${id} must declare every required reusable quality rule it is designed to satisfy`, {
				cell: id,
				missingQualityRules,
				requiredQualityRules,
			});
		}
		if (cell?.id && !pack.cellBuilders?.[cell.id]) {
			hard(findings, 'CM11-builder-exists', `${cell.id} is declared in the manifest but has no implemented builder`, {
				cell: cell.id,
				implementedBuilders: Object.keys(pack.cellBuilders || {}),
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
let pack = null;

if (!existsSync(ASSEMBLY)) hard(findings, 'CM0-assembly-file', 'project_assembly.json is required before cell manifest audit', { path: ASSEMBLY });
if (!findings.length) {
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'CM0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}
if (assembly) {
	manifestPath = resolveCellManifestPath(assembly, ASSEMBLY);
	try { pack = getCircuitPack(assembly.circuitPack || 'aihwdebugger'); } catch (e) { hard(findings, 'CM0-pack-known', 'project_assembly.json must select a known circuit pack', { circuitPack: assembly.circuitPack, error: e.message }); }
	if (!existsSync(manifestPath)) hard(findings, 'CM0-manifest-file', 'selected cell manifest is missing', { path: manifestPath });
	else {
		try { manifest = loadCellManifest(manifestPath); } catch (e) { hard(findings, 'CM0-manifest-parse', 'cell manifest must parse as JSON', { path: manifestPath, error: e.message }); }
	}
}
let partLib = null;
let byDes = null;
if (existsSync(PART_LIB)) {
	try {
		partLib = readJson(PART_LIB);
		const normalized = pack?.normalizeLibrarySnapshot ? pack.normalizeLibrarySnapshot(partLib) : partLib;
		byDes = new Map(asArray(normalized?.components).map(c => [c.designator, withLocalPins(c)]));
	} catch (e) {
		hard(findings, 'CM0-part-lib-parse', 'active part library snapshot must parse before cell builder dry-run', { path: PART_LIB, error: e.message });
	}
}
if (manifest && assembly && pack) {
	findings.push(...validateManifest(manifest, assembly, manifestPath, pack));
	findings.push(...validateCellBuilderDryRun({ assembly, manifest, pack, byDes }));
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	packId: manifest?.packId || null,
	manifestPath,
	requiredQualityRules: asArray(manifest?.requiredQualityRules),
	cellCount: asArray(manifest?.cells).length,
	implementedBuilders: Object.keys(pack?.cellBuilders || {}),
	assemblyCells: unique(asArray(assembly?.modules).map(mod => mod.cell)),
	partLib: PART_LIB,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`cell manifest ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
