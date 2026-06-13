import { circuitPackIds, getCircuitPack } from '../circuit_packs/registry.mjs';
import { asArray, validateSpecSchema } from '../contracts/spec_schema.mjs';
import { validateModuleContract } from '../contracts/module_contract.mjs';
import { validateNetContract } from '../contracts/net_contract.mjs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';
import { asArray as cellArray, loadCellManifest, resolveCellManifestPath } from '../engine/cell_manifest.mjs';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'gsd-plan', msg, where });
}

function setOf(items) {
	return new Set(asArray(items).filter(Boolean));
}

function missingFrom(required, actual) {
	const have = setOf(actual);
	return [...setOf(required)].filter(item => !have.has(item));
}

function moduleById(doc) {
	return new Map(asArray(doc?.modules).map(mod => [mod.id, mod]));
}

function netsByName(netlist) {
	return new Map(asArray(netlist?.nets).map(net => [net.name, net]));
}

function validateSpecRealization(spec, contract, netlist, assembly, model = null) {
	const findings = [];
	const specModules = moduleById(spec);
	const contractModules = moduleById(contract);
	const assemblyModules = moduleById(assembly);
	const netEntries = netsByName(netlist);

	if (contract?.projectId !== spec?.projectId) {
		hard(findings, 'GP1-project-id-contract', 'project_contract.json projectId must match the planned spec', {
			specProjectId: spec?.projectId,
			contractProjectId: contract?.projectId,
		});
	}
	if (netlist?.projectId !== spec?.projectId) {
		hard(findings, 'GP2-project-id-netlist', 'project_netlist.json projectId must match the planned spec', {
			specProjectId: spec?.projectId,
			netlistProjectId: netlist?.projectId,
		});
	}
	if (assembly?.projectId !== spec?.projectId) {
		hard(findings, 'GP3-project-id-assembly', 'project_assembly.json projectId must match the planned spec', {
			specProjectId: spec?.projectId,
			assemblyProjectId: assembly?.projectId,
		});
	}

	for (const [id, specMod] of specModules.entries()) {
		const contractMod = contractModules.get(id);
		const assemblyMod = assemblyModules.get(id);
		if (!contractMod) {
			hard(findings, 'GP4-contract-module-covered', `${id} from spec is missing in project_contract.json`, { module: id });
			continue;
		}
		const missingContractNets = missingFrom(specMod.requiredNets, contractMod.requiredNets);
		if (missingContractNets.length) {
			hard(findings, 'GP5-contract-module-nets', `${id} contract does not cover spec required nets`, { module: id, missingContractNets });
		}
		if (!asArray(contractMod.requiredParts).length) {
			hard(findings, 'GP6-contract-parts', `${id} contract must define requiredParts before generation`, { module: id });
		}
		if (!assemblyMod) {
			hard(findings, 'GP7-assembly-module-covered', `${id} from spec is missing in project_assembly.json`, { module: id });
			continue;
		}
		for (const key of ['cell', 'anchor', 'registryModule']) {
			if (!assemblyMod[key]) hard(findings, 'GP8-assembly-executable-module', `${id} assembly module must define ${key}`, { module: id, key });
		}
		const missingAssemblyNets = missingFrom(specMod.requiredNets, assemblyMod.nets);
		if (missingAssemblyNets.length) {
			hard(findings, 'GP9-assembly-module-nets', `${id} assembly does not cover spec required nets`, { module: id, missingAssemblyNets });
		}
	}

	for (const iface of asArray(spec.interfaces)) {
		const matched = asArray(contract.interfaces).some(candidate => candidate.net === iface.net && candidate.from === iface.from && candidate.to === iface.to);
		if (!matched) hard(findings, 'GP10-interface-covered', 'project_contract.json must cover every spec interface', { interface: iface });
	}

	const specNets = setOf(asArray(spec.modules).flatMap(mod => asArray(mod.requiredNets)));
	for (const net of specNets) {
		if (!netEntries.has(net)) hard(findings, 'GP11-netlist-net-covered', `${net} from spec is missing in project_netlist.json`, { net });
	}

	const policy = assembly?.layoutPolicy || {};
	if (!policy.candidateSource || !policy.flow || !asArray(policy.columns).length || !policy.baseAnchors || !asArray(policy.xProfiles).length) {
		hard(findings, 'GP12-layout-policy-present', 'project_assembly.json must define layoutPolicy candidateSource, flow, columns, baseAnchors, and xProfiles before planning', {
			candidateSource: policy.candidateSource || null,
			flow: policy.flow || null,
			columns: asArray(policy.columns).length,
			baseAnchors: Object.keys(policy.baseAnchors || {}).length,
			xProfiles: asArray(policy.xProfiles).length,
		});
	}

	if (model) {
		const netResult = validateNetContract(contract, netlist, model);
		for (const finding of netResult.findings) hard(findings, `GP-${finding.rule}`, finding.msg, finding.where);
	}

	return findings;
}

function validateExecutableCells(assembly, pack, assemblyPath = '') {
	const findings = [];
	if (!assembly || !pack) return findings;
	let manifest = null;
	let manifestPath = null;
	try {
		manifestPath = resolveCellManifestPath(assembly, assemblyPath);
		manifest = loadCellManifest(manifestPath);
	} catch (e) {
		hard(findings, 'GP15-cell-manifest-load', 'project_assembly.json must point to a readable cell manifest before generation', {
			cellManifest: assembly.cellManifest || null,
			error: e.message,
		});
		return findings;
	}
	const manifestCells = new Set(cellArray(manifest.cells).map(cell => cell.id).filter(Boolean));
	const builderCells = new Set(Object.keys(pack.cellBuilders || {}));
	for (const mod of asArray(assembly.modules)) {
		if (!manifestCells.has(mod.cell)) {
			hard(findings, 'GP16-assembly-cell-declared', `${mod.id} uses a cell not declared by the selected cell manifest`, {
				module: mod.id,
				cell: mod.cell,
				manifestPath,
				manifestCells: [...manifestCells],
			});
			continue;
		}
		if (!builderCells.has(mod.cell)) {
			hard(findings, 'GP17-assembly-cell-builder', `${mod.id} uses a cell without an implemented pack builder`, {
				module: mod.id,
				cell: mod.cell,
				circuitPack: pack.id,
				implementedBuilders: [...builderCells],
			});
		}
	}
	return findings;
}

function validatePartLibrarySnapshot(contract, partLibSnapshot, partLibPath = '') {
	const findings = [];
	if (!contract || !partLibSnapshot) return findings;
	const requiredParts = new Set(asArray(contract.modules).flatMap(mod => asArray(mod.requiredParts)));
	const availableParts = new Set(asArray(partLibSnapshot.components).map(part => part.designator).filter(Boolean));
	for (const ref of requiredParts) {
		if (!availableParts.has(ref)) {
			hard(findings, 'GP18-part-lib-required-part', `${ref} required by project_contract.json is missing from the active project library snapshot`, {
				designator: ref,
				partLibPath,
			});
		}
	}
	return findings;
}

export function buildGsdPlan({ spec, contract, netlist, assembly, libraryManifest = null, partLibSnapshot = null, model = null, specPath = 'project_spec.json', assemblyPath = '', partLibPath = '', inputFindings = [] }) {
	const findings = [...asArray(inputFindings)];
	findings.push(...validateSpecSchema(spec));
	if (contract) findings.push(...validateModuleContract(contract).map(f => ({ ...f, category: 'gsd-plan' })));
	else hard(findings, 'GP0-contract-present', 'project_contract.json is required for planning');
	if (!netlist) hard(findings, 'GP0-netlist-present', 'project_netlist.json is required for planning');
	if (!assembly) hard(findings, 'GP0-assembly-present', 'project_assembly.json is required for planning');
	if (contract && libraryManifest) {
		const libraryResult = validateLibraryContract(contract, libraryManifest);
		for (const finding of libraryResult.findings) hard(findings, `GP-${finding.rule}`, finding.msg, finding.where);
	} else if (!libraryManifest) {
		hard(findings, 'GP0-library-manifest-present', 'approved_library_manifest.json is required for planning approved library bindings');
	}

	let pack = null;
	const packId = spec?.circuitPack || assembly?.circuitPack || 'aihwdebugger';
	try {
		pack = getCircuitPack(packId);
		if (pack.scaffoldOnly === true) {
			hard(findings, 'GP14-pack-implemented', 'selected circuit pack is scaffold-only and must implement builders before generation', { circuitPack: packId });
		}
	} catch (e) {
		hard(findings, 'GP13-pack-registered', 'spec/assembly circuitPack must be registered', { circuitPack: packId, registeredPacks: circuitPackIds(), error: e.message });
	}
	if (assembly && pack) findings.push(...validateExecutableCells(assembly, pack, assemblyPath));
	findings.push(...validatePartLibrarySnapshot(contract, partLibSnapshot, partLibPath));

	if (contract && netlist && assembly) findings.push(...validateSpecRealization(spec, contract, netlist, assembly, model));

	const report = {
		generatedAt: new Date().toISOString(),
		pass: findings.length === 0,
		spec: specPath,
		projectId: spec?.projectId || contract?.projectId || null,
		circuitPack: pack?.id || packId,
		registeredPacks: circuitPackIds(),
		cellManifest: assembly?.cellManifest || null,
		libraryManifest: 'approved_library_manifest.json',
		partLib: partLibPath || null,
		modules: asArray(spec?.modules).map(mod => mod.id),
		interfaces: asArray(spec?.interfaces).length,
		requiredLocalGate: 'node bin/easyeda-gsd.mjs accept',
		requiredFinalGate: 'node bin/easyeda-gsd.mjs live-check',
		finalApply: `node bin/easyeda-gsd.mjs apply --gated ${specPath}`,
		severity: { hard: findings.length, soft: 0, info: 0 },
		findings,
	};
	return report;
}
