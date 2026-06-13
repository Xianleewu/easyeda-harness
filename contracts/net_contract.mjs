import { buildNetlist } from '../engine/netlist.mjs';
import { asArray } from './module_contract.mjs';

function hard(findings, rule, msg, where = {}, category = 'project-netlist') {
	findings.push({ rule, severity: 'hard', category, msg, where });
}

export function pinNetMap(model) {
	const nets = buildNetlist(model);
	const pinToNet = new Map();
	for (const net of nets) for (const pin of net.pins) pinToNet.set(pin.ref, net.name);
	return { nets, pinToNet };
}

export function validateNetContract(contract, projectNetlist, model, options = {}) {
	const category = options.category || 'project-netlist';
	const findings = [];
	const contractNets = new Set(asArray(contract.modules).flatMap(mod => asArray(mod.requiredNets)));
	const contractModules = new Set(asArray(contract.modules).map(mod => mod.id));
	const modelPins = new Set(asArray(model.components).flatMap(c => asArray(c.pins).map(p => `${c.designator}.${p.num}`)));
	const netEntries = new Map(asArray(projectNetlist.nets).map(net => [net.name, net]));
	const { nets, pinToNet } = pinNetMap(model);
	const allowedAnonymous = new Set(asArray(projectNetlist.allowedAnonymousNets));

	if (projectNetlist.projectId !== contract.projectId) {
		hard(findings, 'PN1-project-id-match', 'project_netlist.json projectId must match project_contract.json', {
			contractProjectId: contract.projectId,
			netlistProjectId: projectNetlist.projectId,
		}, category);
	}

	for (const net of contractNets) {
		if (!netEntries.has(net)) hard(findings, 'PN2-contract-net-covered', `${net} required by project_contract.json is missing from project_netlist.json`, { net }, category);
	}

	for (const entry of asArray(projectNetlist.nets)) {
		if (!entry.name) {
			hard(findings, 'PN3-net-name-required', 'each project netlist entry needs a name', { entry }, category);
			continue;
		}
		const pins = asArray(entry.requiredPins);
		if (!pins.length) hard(findings, 'PN4-required-pins', `${entry.name} must declare requiredPins`, { net: entry.name }, category);
		for (const [moduleId, modulePins] of Object.entries(entry.modulePins || {})) {
			if (!contractModules.has(moduleId)) hard(findings, 'PN5-module-known', `${entry.name} references unknown module ${moduleId}`, { net: entry.name, module: moduleId }, category);
			for (const pin of asArray(modulePins)) {
				if (!pins.includes(pin)) hard(findings, 'PN6-module-pins-in-required-pins', `${entry.name} modulePins contains pin not listed in requiredPins`, { net: entry.name, module: moduleId, pin }, category);
			}
		}
		for (const pin of pins) {
			if (!modelPins.has(pin)) hard(findings, 'PN7-pin-exists-in-model', `${entry.name} required pin is missing from generated model`, { net: entry.name, pin }, category);
		}
		const groups = new Map();
		for (const pin of pins) {
			const actual = pinToNet.get(pin);
			if (!actual) {
				hard(findings, 'PN8-pin-connected', `${entry.name} required pin is not connected in generated model`, { net: entry.name, pin }, category);
				continue;
			}
			if (!groups.has(actual)) groups.set(actual, []);
			groups.get(actual).push(pin);
		}
		if (groups.size > 1) {
			hard(findings, 'PN9-net-not-split', `${entry.name} required pins are split across multiple generated nets`, {
				net: entry.name,
				groups: Object.fromEntries(groups),
			}, category);
		} else if (groups.size === 1) {
			const actual = [...groups.keys()][0];
			if (actual !== entry.name && !actual.includes(entry.name)) {
				hard(findings, 'PN10-net-name-match', `${entry.name} required pins resolve to unexpected generated net ${actual}`, {
					expected: entry.name,
					actual,
					pins,
				}, category);
			}
		}
	}

	const namedEntries = new Set(asArray(projectNetlist.nets).map(net => net.name).filter(Boolean));
	const declaredInternal = new Set(asArray(projectNetlist.nets)
		.filter(net => ['internal', 'local', 'derived'].includes(net.scope))
		.map(net => net.name)
		.filter(Boolean));
	const staleNetlist = [...namedEntries].filter(net => !contractNets.has(net) && !allowedAnonymous.has(net) && !declaredInternal.has(net));
	if (staleNetlist.length) hard(findings, 'PN11-no-stale-netlist-nets', 'project_netlist.json contains nets not required by project_contract.json and not declared as internal/local/derived', { staleNetlist }, category);

	const anonymous = nets.filter(net => net.name?.startsWith('N$') && net.pins.length > 1 && !allowedAnonymous.has(net.name));
	if (anonymous.length) {
		hard(findings, 'PN12-no-anonymous-multipin-nets', 'generated model contains multi-pin anonymous nets not declared in project_netlist.json', {
			anonymous: anonymous.map(net => ({ name: net.name, pins: net.pins.map(p => p.ref) })),
		}, category);
	}

	return { findings, modelNetCount: nets.length, modelPins: modelPins.size, contractNets: contractNets.size, projectNets: namedEntries.size };
}

