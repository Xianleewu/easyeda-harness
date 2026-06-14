import { circuitPackIds, getCircuitPack } from '../circuit_packs/registry.mjs';
import { asArray, validateSpecSchema } from '../contracts/spec_schema.mjs';
import { validateModuleContract } from '../contracts/module_contract.mjs';
import { validateNetContract } from '../contracts/net_contract.mjs';
import { validateLibraryContract } from '../contracts/library_contract.mjs';
import { validateDrawingRuleBindings } from '../contracts/drawing_rule_registry.mjs';
import { validateCellBuilderDryRun } from '../contracts/cell_builder_contract.mjs';
import { interfaceKey, measureColumnAnchorGaps, validateInterfaceRoutes } from '../contracts/layout_contract.mjs';
import { asArray as cellArray, cellContractMap, loadCellManifest, resolveCellManifestPath } from '../engine/cell_manifest.mjs';
import { withLocalPins } from '../engine/transform.mjs';
import { HARNESS_RULES } from '../harness/rule_registry.mjs';

const LABEL_POWER_NETS = new Set(['GND', 'SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW', 'VBUS']);

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

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validateStaticLayoutPolicy(assembly) {
	const findings = [];
	if (!assembly) return findings;
	const policy = assembly.layoutPolicy || {};
	const modules = asArray(assembly.modules);
	const moduleIds = new Set(modules.map(mod => mod.id).filter(Boolean));
	const columns = asArray(policy.columns);
	const columnEntries = [];
	const seen = new Map();
	for (const [index, column] of columns.entries()) {
		for (const id of asArray(column.modules)) {
			columnEntries.push({ id, index, column: column.id || `column_${index + 1}` });
			if (seen.has(id)) {
				hard(findings, 'GP21-layout-column-unique-module', 'layoutPolicy.columns must assign each assembly module to exactly one ordered column', {
					module: id,
					firstColumn: seen.get(id).column,
					duplicateColumn: column.id || `column_${index + 1}`,
				});
			} else {
				seen.set(id, { index, column: column.id || `column_${index + 1}` });
			}
			if (!moduleIds.has(id)) {
				hard(findings, 'GP22-layout-column-module-known', 'layoutPolicy.columns references a module not present in project_assembly.json', {
					module: id,
					column: column.id || `column_${index + 1}`,
				});
			}
		}
	}
	const missingColumns = [...moduleIds].filter(id => !seen.has(id));
	if (missingColumns.length) {
		hard(findings, 'GP23-layout-column-covers-modules', 'layoutPolicy.columns must cover every assembly module before generation', { missingColumns });
	}
	const anchors = assembly.anchors || {};
	const base = policy.baseAnchors || {};
	const missingBase = modules.map(mod => mod.anchor).filter(Boolean).filter(anchor => !finitePoint(base[anchor]));
	if (missingBase.length) {
		hard(findings, 'GP24-layout-base-anchors-cover-modules', 'layoutPolicy.baseAnchors must define every module anchor used by project_assembly.json', {
			missingBaseAnchors: [...new Set(missingBase)],
		});
	}
	const ordered = modules
		.filter(mod => seen.has(mod.id) && finitePoint(anchors[mod.anchor]))
		.map(mod => ({ id: mod.id, x: anchors[mod.anchor].x, column: seen.get(mod.id) }));
	const reversedPairs = [];
	for (const left of ordered) {
		for (const right of ordered) {
			if (left.column.index >= right.column.index) continue;
			if (left.x > right.x) {
				reversedPairs.push({
					left: left.id,
					right: right.id,
					leftColumn: left.column.column,
					rightColumn: right.column.column,
					leftX: left.x,
					rightX: right.x,
				});
			}
		}
	}
	if (reversedPairs.length) {
		hard(findings, 'GP25-layout-column-x-order', 'module anchors must follow the declared left-to-right layoutPolicy.columns order before generation', {
			reversedPairs,
		});
	}
	const minColumnGap = policy.minColumnGap ?? 120;
	const columnGaps = measureColumnAnchorGaps(assembly);
	const narrowColumnGaps = columnGaps.pairs.filter(pair => pair.gap != null && pair.gap < minColumnGap);
	if (narrowColumnGaps.length) {
		hard(findings, 'GP26-layout-column-gap', 'adjacent layoutPolicy.columns must have enough X separation before generation', {
			minColumnGap,
			narrowColumnGaps,
			columns: columnGaps.columns.map(col => ({ id: col.id, centerX: col.centerX, modules: col.modules })),
		});
	}
	return findings;
}

function validateStaticInterfaceRoutes(contract, assembly) {
	const ruleMap = {
		'PL23-interface-route-covered': 'GP28-interface-route-covered',
		'PL24-interface-route-unique': 'GP29-interface-route-unique',
		'PL25-interface-route-key': 'GP30-interface-route-key',
		'PL26-interface-route-module-known': 'GP31-interface-route-module-known',
		'PL27-interface-route-strategy': 'GP32-interface-route-strategy',
		'PL28-interface-route-channel': 'GP33-interface-route-channel',
		'PL29-interface-route-direction': 'GP34-interface-route-direction',
	};
	return validateInterfaceRoutes(contract, assembly, 'gsd-plan').map(f => ({ ...f, rule: ruleMap[f.rule] || f.rule.replace(/^PL/, 'GP') }));
}

function validateStaticLabelColumns(contract, assembly) {
	const findings = [];
	const policy = assembly?.layoutPolicy || {};
	const columns = asArray(policy.labelColumns);
	const groupedRoutes = asArray(policy.interfaceRoutes)
		.filter(route => route.strategy === 'grouped-net-label')
		.filter(route => route.net && !LABEL_POWER_NETS.has(route.net) && !String(route.net).startsWith('NC_'));
	if (groupedRoutes.length && !columns.length) {
		hard(findings, 'GP35-label-columns-declared', 'layoutPolicy.labelColumns must declare visible label columns for grouped-net-label routes before generation', {
			groupedRoutes: groupedRoutes.map(route => ({ net: route.net, from: route.from, to: route.to, channel: route.channel })),
		});
	}
	const columnIds = new Set();
	for (const [index, col] of columns.entries()) {
		const id = col.id || `label_column_${index + 1}`;
		if (columnIds.has(id)) hard(findings, 'GP36-label-column-id-unique', 'layoutPolicy.labelColumns ids must be unique', { column: id });
		columnIds.add(id);
		if (!col.role || typeof col.role !== 'string') hard(findings, 'GP37-label-column-role', 'layoutPolicy.labelColumns entries must explain their reading-flow role', { index, column: col });
		if (!['left', 'right'].includes(col.side)) hard(findings, 'GP38-label-column-side', 'layoutPolicy.labelColumns entries must declare side left or right', { index, column: col });
		if (!Number.isFinite(col.x)) hard(findings, 'GP39-label-column-x', 'layoutPolicy.labelColumns entries must declare finite x', { index, column: col });
		if (!asArray(col.nets).length) hard(findings, 'GP40-label-column-nets', 'layoutPolicy.labelColumns entries must declare allowed nets', { index, column: col });
	}
	for (const route of groupedRoutes) {
		const covered = columns.some(col => asArray(col.nets).includes(route.net));
		if (!covered) hard(findings, 'GP41-label-column-covers-route-net', 'each grouped-net-label route must have at least one label column budget for its net', { route });
	}
	for (const iface of asArray(contract?.interfaces)) {
		const route = groupedRoutes.find(r => r.net === iface.net && r.from === iface.from && r.to === iface.to);
		if (!route) continue;
		const covered = columns.some(col => asArray(col.nets).includes(iface.net));
		if (!covered) hard(findings, 'GP42-label-column-covers-interface', 'each grouped-net-label contract interface must be covered by layoutPolicy.labelColumns', { interface: iface });
	}
	return findings;
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
	findings.push(...validateStaticLayoutPolicy(assembly));
	if (asArray(contract?.interfaces).length && !asArray(policy.interfaceRoutes).length) {
		hard(findings, 'GP27-interface-routes-declared', 'project_assembly.json layoutPolicy.interfaceRoutes must declare cross-module routing intent before generation', {
			interfaces: asArray(contract.interfaces).map(interfaceKey),
		});
	}
	findings.push(...validateStaticInterfaceRoutes(contract, assembly));
	findings.push(...validateStaticLabelColumns(contract, assembly));

	if (model) {
		const netResult = validateNetContract(contract, netlist, model);
		for (const finding of netResult.findings) hard(findings, `GP-${finding.rule}`, finding.msg, finding.where);
	}

	return findings;
}

function validateExecutableCells(assembly, pack, assemblyPath = '', partLibSnapshot = null) {
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
	const cellContracts = cellContractMap(manifest);
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
		const cell = cellContracts.get(mod.cell);
		if (cell) {
			const netArgs = mod.netArgs || {};
			const mappedNets = new Set(asArray(mod.nets));
			for (const port of cell.ports) {
				const resolvedNet = netArgs[port] || (mappedNets.has(port) ? port : '');
				if (!resolvedNet) {
					hard(findings, 'GP19-cell-port-bound', `${mod.id} ${mod.cell} port ${port} must resolve to an assembly net through netArgs or nets before generation`, {
						module: mod.id,
						cell: mod.cell,
						port,
						netArgs,
						nets: [...mappedNets],
					});
				} else if (!mappedNets.has(resolvedNet)) {
					hard(findings, 'GP20-cell-port-net-declared', `${mod.id} ${mod.cell} port ${port} resolves to ${resolvedNet}, but that net is not declared in assembly nets`, {
						module: mod.id,
						cell: mod.cell,
						port,
						resolvedNet,
						nets: [...mappedNets],
					});
				}
			}
		}
	}
	if (partLibSnapshot) {
		const normalized = pack.normalizeLibrarySnapshot ? pack.normalizeLibrarySnapshot(JSON.parse(JSON.stringify(partLibSnapshot))) : partLibSnapshot;
		const byDes = new Map(cellArray(normalized?.components).map(c => [c.designator, withLocalPins(c)]));
		findings.push(...validateCellBuilderDryRun({ assembly, manifest, pack, byDes }).map(f => ({ ...f, category: 'gsd-plan' })));
	}
	return findings;
}

function validateExecutableDrawingRules(contract, assembly, assemblyPath = '') {
	const findings = [];
	if (!contract || !assembly) return findings;
	let manifest = null;
	try {
		manifest = loadCellManifest(resolveCellManifestPath(assembly, assemblyPath));
	} catch {
		return findings;
	}
	const registeredRuleIds = HARNESS_RULES.map(rule => rule.id);
	const modules = moduleById(contract);
	for (const mod of asArray(contract.modules)) {
		for (const finding of validateDrawingRuleBindings({ drawingRules: mod.drawingRules, registeredRuleIds })) {
			hard(findings, `GP-${finding.rule}`, finding.msg, { module: mod.id, ...finding.where });
		}
	}
	for (const finding of validateDrawingRuleBindings({ drawingRules: manifest.requiredQualityRules, registeredRuleIds })) {
		hard(findings, `GP-${finding.rule}`, finding.msg, { scope: 'manifest.requiredQualityRules', ...finding.where });
	}
	for (const mod of asArray(assembly.modules)) {
		const contractMod = modules.get(mod.id);
		if (!contractMod) continue;
		const manifestCell = cellArray(manifest.cells).find(cell => cell.id === mod.cell) || {};
		const qualityRules = new Set(cellArray(manifestCell.qualityRules));
		const missing = asArray(contractMod.drawingRules).filter(rule => !qualityRules.has(rule));
		if (missing.length) {
			hard(findings, 'GP-PR5-cell-quality-rules-cover-module', `${mod.id} cell qualityRules must cover module drawingRules before generation`, {
				module: mod.id,
				cell: mod.cell,
				missingQualityRules: missing,
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

export function buildGsdPlan({ spec, contract, netlist, assembly, libraryManifest = null, partLibSnapshot = null, model = null, specPath = 'project_spec.json', assemblyPath = '', partLibPath = '', modelPath = '', inputFindings = [] }) {
	const findings = [...asArray(inputFindings)];
	const expectedProjectId = spec?.projectId || contract?.projectId || assembly?.projectId || null;
	const modelEvidence = model ? {
		path: modelPath || null,
		projectId: model.layoutProfile?.projectId || model.projectId || model.project || null,
		used: true,
		skippedReason: null,
	} : {
		path: modelPath || null,
		projectId: null,
		used: false,
		skippedReason: 'missing',
	};
	if (model && expectedProjectId && modelEvidence.projectId && modelEvidence.projectId !== expectedProjectId) {
		modelEvidence.used = false;
		modelEvidence.skippedReason = 'project-id-mismatch';
		modelEvidence.expectedProjectId = expectedProjectId;
	}
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
	if (assembly && pack) findings.push(...validateExecutableCells(assembly, pack, assemblyPath, partLibSnapshot));
	if (contract && assembly) findings.push(...validateExecutableDrawingRules(contract, assembly, assemblyPath));
	findings.push(...validatePartLibrarySnapshot(contract, partLibSnapshot, partLibPath));

	if (contract && netlist && assembly) findings.push(...validateSpecRealization(spec, contract, netlist, assembly, modelEvidence.used ? model : null));

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
		modelEvidence,
		modules: asArray(spec?.modules).map(mod => mod.id),
		interfaces: asArray(spec?.interfaces).length,
		requiredLocalGate: 'node bin/easyeda-gsd.mjs accept',
		requiredFinalGate: `node bin/easyeda-gsd.mjs live-check ${specPath} && node bin/easyeda-gsd.mjs deliver ${specPath}`,
		requiredDeliveryGate: `node bin/easyeda-gsd.mjs deliver ${specPath}`,
		finalApply: `node bin/easyeda-gsd.mjs apply --gated ${specPath}`,
		severity: { hard: findings.length, soft: 0, info: 0 },
		findings,
	};
	return report;
}
