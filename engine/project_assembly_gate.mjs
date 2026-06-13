import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const REPORT = process.env.EASYEDA_PROJECT_ASSEMBLY_REPORT || DIR + 'project_assembly_report.json';

const CELL_CONTRACTS = {
	usbCell: { refs: ['J', 'Rcc1', 'Rcc2', 'Rdn', 'Rdp', 'Cv'], netArgs: [] },
	ldoCell: { refs: ['U', 'Co1', 'Co2'], netArgs: ['VIN', 'VOUT'] },
	buttonCell: { refs: ['SW', 'Rpu'], optionalRefs: ['Cap'], netArgs: ['SIG'] },
	mcuCell: { refs: ['U'], netArgs: [] },
	pmosCell: { refs: ['Q1', 'Q2', 'D1', 'R1', 'R2', 'R3', 'R4', 'CN1', 'CN2'], netArgs: [] },
	relayDriver: { refs: ['Q', 'Rs', 'Rpd', 'D', 'CN'], netArgs: ['EN', 'GATE', 'COILA', 'COILV'] },
};

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

function validateAssembly(contract, assembly) {
	const findings = [];
	const contractModules = new Map(asArray(contract.modules).map(mod => [mod.id, mod]));
	const assemblyModules = new Map(asArray(assembly.modules).map(mod => [mod.id, mod]));
	const anchors = assembly.anchors || {};

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

		const cell = CELL_CONTRACTS[mapping.cell];
		if (!cell) {
			hard(findings, 'PA4-cell-known', `${id} uses an unknown deterministic cell`, { module: id, cell: mapping.cell, allowedCells: Object.keys(CELL_CONTRACTS) });
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
if (!existsSync(CONTRACT)) hard(findings, 'PA0-contract-file', 'project_contract.json is required before assembly audit', { path: CONTRACT });
if (!existsSync(ASSEMBLY)) hard(findings, 'PA0-assembly-file', 'project_assembly.json is required before deterministic assembly can be trusted', { path: ASSEMBLY });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PA0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PA0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
}
if (contract && assembly) findings.push(...validateAssembly(contract, assembly));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	assemblyProjectId: assembly?.projectId || null,
	modules: asArray(assembly?.modules).length,
	anchors: Object.keys(assembly?.anchors || {}).length,
	cellTypes: [...new Set(asArray(assembly?.modules).map(mod => mod.cell).filter(Boolean))],
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project assembly ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
