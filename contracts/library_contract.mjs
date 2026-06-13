import { asArray } from './module_contract.mjs';

const DEFAULT_BINDING_KEYS = ['Symbol', 'Device', 'Footprint'];

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'library-contract', msg, where });
}

export function requiredPartsFromContract(contract) {
	return [...new Set(asArray(contract?.modules).flatMap(mod => asArray(mod.requiredParts)))].sort();
}

export function validateLibraryContract(contract, manifest, options = {}) {
	const findings = [];
	const bindingKeys = asArray(manifest?.bindingKeys).length ? manifest.bindingKeys : DEFAULT_BINDING_KEYS;
	const approved = manifest?.parts || {};
	const requiredParts = requiredPartsFromContract(contract);

	if (!manifest || typeof manifest !== 'object') {
		hard(findings, 'LC1-manifest-object', 'approved library manifest must be a JSON object');
		return { findings, stats: { requiredParts: requiredParts.length, approvedParts: 0, bindingKeys } };
	}
	if (!manifest.purpose || typeof manifest.purpose !== 'string') hard(findings, 'LC2-purpose', 'approved library manifest needs a purpose string');
	if (!Object.keys(approved).length) hard(findings, 'LC3-approved-parts', 'approved library manifest must declare approved parts');

	for (const ref of requiredParts) {
		const entry = approved[ref];
		if (!entry) {
			hard(findings, 'LC4-required-part-approved', `${ref} from project_contract.json is missing from approved_library_manifest.json`, { designator: ref });
			continue;
		}
		for (const key of ['name', 'value']) {
			if (!entry[key] || typeof entry[key] !== 'string') hard(findings, 'LC5-name-value', `${ref} approved library entry needs ${key}`, { designator: ref, key, value: entry[key] });
		}
		for (const key of ['addIntoBom', 'addIntoPcb']) {
			if (typeof entry[key] !== 'boolean') hard(findings, 'LC6-bom-pcb-bool', `${ref} approved library entry needs boolean ${key}`, { designator: ref, key, value: entry[key] });
			else if (options.requireBomPcb !== false && entry[key] !== true) hard(findings, 'LC7-bom-pcb-enabled', `${ref} must be enabled for ${key}`, { designator: ref, key, value: entry[key] });
		}
		for (const key of bindingKeys) {
			if (!entry[key] || typeof entry[key] !== 'string') hard(findings, 'LC8-binding-present', `${ref} approved library entry needs ${key} binding`, { designator: ref, key, value: entry[key] });
		}
	}

	if (options.failOnExtraParts !== false) {
		const required = new Set(requiredParts);
		for (const ref of Object.keys(approved)) {
			if (!required.has(ref)) hard(findings, 'LC9-no-extra-approved-parts', `${ref} is approved but not required by project_contract.json`, { designator: ref });
		}
	}

	return {
		findings,
		stats: {
			requiredParts: requiredParts.length,
			approvedParts: Object.keys(approved).length,
			bindingKeys,
		},
	};
}

