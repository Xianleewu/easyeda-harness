import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cellContractMap, loadCellManifest, resolveCellManifestPath } from './cell_manifest.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const REPORT = process.env.EASYEDA_PROJECT_ASSEMBLY_REPORT || DIR + 'project_assembly_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-assembly', msg, where });
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function values(obj) {
	return Object.values(obj || {}).filter(Boolean);
}

function validateAssembly(contract, assembly, cellContracts) {
	const findings = [];
	const contractModules = new Map(asArray(contract.modules).map(mod => [mod.id, mod]));
	const assemblyModules = new Map(asArray(assembly.modules).map(mod => [mod.id, mod]));
	const anchors = assembly.anchors || {};
	const refOwners = new Map();

	if (assembly.projectId !== contract.projectId) {
		hard(findings, 'PA1-project-id-match', 'project_assembly.json projectId must match project_contract.json', {
			contractProjectId: contract.projectId,
			assemblyProjectId: assembly.projectId,
		});
	}

	if (assembly.agentPolicy?.freeDrawAllowed !== false) {
		hard(findings, 'PA2-no-free-draw', 'project assembly must explicitly disallow free draw', {
			freeDrawAllowed: assembly.agentPolicy?.freeDrawAllowed,
		});
	}

	for (const [id, mod] of contractModules) {
		const mapping = assemblyModules.get(id);
		if (!mapping) {
			hard(findings, 'PA3-module-mapped', `${id} contract module is missing from project_assembly.json`, { module: id });
			continue;
		}

		const cell = cellContracts.get(mapping.cell);
		if (!cell) {
			hard(findings, 'PA4-cell-known', `${id} uses an unknown deterministic cell`, { module: id, cell: mapping.cell, allowedCells: [...cellContracts.keys()] });
			continue;
		}

		if (!mapping.registryModule) {
			hard(findings, 'PA5-registry-module', `${id} assembly mapping must name the harness registry module`, { module: id });
		}
		if (!mapping.anchor || !finitePoint(anchors[mapping.anchor])) {
			hard(findings, 'PA6-anchor-defined', `${id} assembly mapping must reference a defined finite anchor`, { module: id, anchor: mapping.anchor, anchorValue: anchors[mapping.anchor] });
		}

		const refKeys = new Set(Object.keys(mapping.refs || {}));
		for (const key of cell.refs) {
			if (!refKeys.has(key)) hard(findings, 'PA7-cell-required-refs', `${id} ${mapping.cell} missing required ref role ${key}`, { module: id, cell: mapping.cell, refs: mapping.refs || {} });
		}
		const allowedRefKeys = new Set([...cell.refs, ...asArray(cell.optionalRefs)]);
		const unknownRefKeys = [...refKeys].filter(key => !allowedRefKeys.has(key));
		if (unknownRefKeys.length) hard(findings, 'PA8-cell-ref-roles-known', `${id} assembly has ref roles not accepted by ${mapping.cell}`, { module: id, cell: mapping.cell, unknownRefKeys });

		const mappedRefs = new Set(values(mapping.refs));
		for (const [role, ref] of Object.entries(mapping.refs || {})) {
			if (!ref) continue;
			if (refOwners.has(ref)) {
				hard(findings, 'PA21-ref-owned-once', 'each physical designator in project_assembly.json refs must belong to exactly one assembly module', {
					designator: ref,
					first: refOwners.get(ref),
					duplicate: { module: id, role },
				});
			} else {
				refOwners.set(ref, { module: id, role });
			}
		}
		const requiredParts = new Set(asArray(mod.requiredParts));
		const missingParts = [...requiredParts].filter(ref => !mappedRefs.has(ref));
		const staleRefs = [...mappedRefs].filter(ref => !requiredParts.has(ref));
		if (missingParts.length) hard(findings, 'PA9-contract-parts-mapped', `${id} required parts are not mapped into deterministic cell refs`, { module: id, missingParts });
		if (staleRefs.length) hard(findings, 'PA10-no-stale-refs', `${id} assembly maps refs outside contract requiredParts`, { module: id, staleRefs });

		const mappedNets = new Set(asArray(mapping.nets));
		const missingNets = asArray(mod.requiredNets).filter(net => !mappedNets.has(net));
		const staleNets = [...mappedNets].filter(net => !asArray(mod.requiredNets).includes(net));
		if (missingNets.length) hard(findings, 'PA11-contract-nets-mapped', `${id} required nets are not listed in assembly mapping`, { module: id, missingNets });
		if (staleNets.length) hard(findings, 'PA12-no-stale-nets', `${id} assembly lists nets outside contract requiredNets`, { module: id, staleNets });

		const netArgs = mapping.netArgs || {};
		for (const key of cell.netArgs) {
			if (!netArgs[key]) hard(findings, 'PA13-cell-required-netargs', `${id} ${mapping.cell} missing required netArg ${key}`, { module: id, cell: mapping.cell, netArgs });
		}
		for (const net of values(netArgs)) {
			if (!mappedNets.has(net)) hard(findings, 'PA14-netargs-declared', `${id} netArg ${net} must also be present in assembly nets`, { module: id, net });
		}
		for (const port of cell.ports) {
			const resolvedNet = netArgs[port] || (mappedNets.has(port) ? port : '');
			if (!resolvedNet) {
				hard(findings, 'PA19-cell-port-bound', `${id} ${mapping.cell} port ${port} must resolve to an assembly net through netArgs or nets`, {
					module: id,
					cell: mapping.cell,
					port,
					netArgs,
					nets: [...mappedNets],
				});
			} else if (!mappedNets.has(resolvedNet)) {
				hard(findings, 'PA20-cell-port-net-declared', `${id} ${mapping.cell} port ${port} resolves to ${resolvedNet}, but that net is not declared in assembly nets`, {
					module: id,
					cell: mapping.cell,
					port,
					resolvedNet,
					nets: [...mappedNets],
				});
			}
		}
	}

	for (const id of assemblyModules.keys()) {
		if (!contractModules.has(id)) hard(findings, 'PA15-no-stale-modules', `${id} assembly module is not present in project_contract.json`, { module: id });
	}

	for (const iface of asArray(contract.interfaces)) {
		const from = assemblyModules.get(iface.from);
		const to = assemblyModules.get(iface.to);
		if (!from || !to) continue;
		if (!asArray(from.nets).includes(iface.net)) hard(findings, 'PA16-interface-from-net', `${iface.net} must be listed in source module assembly nets`, { interface: iface, sourceAssembly: from?.id });
		if (!asArray(to.nets).includes(iface.net)) hard(findings, 'PA17-interface-to-net', `${iface.net} must be listed in target module assembly nets`, { interface: iface, targetAssembly: to?.id });
	}

	const orders = asArray(assembly.modules).map(mod => mod.order).filter(order => order !== undefined);
	const duplicateOrders = orders.filter((order, index) => orders.indexOf(order) !== index);
	if (duplicateOrders.length) hard(findings, 'PA18-order-unique', 'assembly module order values must be unique', { duplicateOrders });

	return findings;
}

const findings = [];
let contract = null;
let assembly = null;
let manifest = null;
let manifestPath = null;
if (!existsSync(CONTRACT)) hard(findings, 'PA0-contract-file', 'project_contract.json is required before assembly audit', { path: CONTRACT });
if (!existsSync(ASSEMBLY)) hard(findings, 'PA0-assembly-file', 'project_assembly.json is required before deterministic assembly can be trusted', { path: ASSEMBLY });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PA0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PA0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}
if (assembly) {
	manifestPath = resolveCellManifestPath(assembly, ASSEMBLY);
	if (!existsSync(manifestPath)) hard(findings, 'PA0-cell-manifest-file', 'project_assembly.json must point to an existing cell manifest', { manifestPath });
	else {
		try { manifest = loadCellManifest(manifestPath); } catch (e) { hard(findings, 'PA0-cell-manifest-parse', 'cell manifest must parse as JSON', { manifestPath, error: e.message }); }
	}
}
if (contract && assembly && manifest) findings.push(...validateAssembly(contract, assembly, cellContractMap(manifest)));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	assemblyProjectId: assembly?.projectId || null,
	circuitPack: assembly?.circuitPack || null,
	cellManifest: manifestPath,
	modules: asArray(assembly?.modules).length,
	anchors: Object.keys(assembly?.anchors || {}).length,
	cellTypes: [...new Set(asArray(assembly?.modules).map(mod => mod.cell).filter(Boolean))],
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project assembly ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
