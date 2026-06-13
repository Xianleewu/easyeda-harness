export const SPEC_SCHEMA_VERSION = 1;

export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'spec-schema', msg, where });
}

function stringSet(values) {
	return new Set(asArray(values).filter(v => typeof v === 'string' && v.length > 0));
}

export function validateSpecSchema(spec) {
	const findings = [];
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
		hard(findings, 'SS1-object', 'project spec must be a JSON object');
		return findings;
	}
	if (spec.schemaVersion !== SPEC_SCHEMA_VERSION) hard(findings, 'SS2-schema-version', 'project spec schemaVersion must be 1', { schemaVersion: spec.schemaVersion });
	if (!spec.projectId || typeof spec.projectId !== 'string') hard(findings, 'SS3-project-id', 'project spec needs a stable projectId');
	if (!spec.intent || typeof spec.intent !== 'string') hard(findings, 'SS4-intent', 'project spec needs a concise design intent');

	const modules = asArray(spec.modules);
	if (!modules.length) hard(findings, 'SS5-modules-present', 'project spec must define functional modules');
	const moduleIds = new Set();
	for (const [index, mod] of modules.entries()) {
		if (!mod || typeof mod !== 'object') {
			hard(findings, 'SS6-module-object', 'each spec module must be an object', { index });
			continue;
		}
		if (!mod.id || typeof mod.id !== 'string') hard(findings, 'SS7-module-id', 'each spec module needs id', { index });
		else if (moduleIds.has(mod.id)) hard(findings, 'SS8-module-id-unique', `duplicate spec module id: ${mod.id}`, { id: mod.id });
		else moduleIds.add(mod.id);
		if (!mod.title || typeof mod.title !== 'string') hard(findings, 'SS9-module-title', `${mod.id || index} module needs title`, { module: mod.id || index });
		if (!asArray(mod.requiredNets).length) hard(findings, 'SS10-module-nets', `${mod.id || index} module needs requiredNets`, { module: mod.id || index });
		for (const net of asArray(mod.requiredNets)) {
			if (!net || typeof net !== 'string') hard(findings, 'SS11-module-net-string', `${mod.id || index} requiredNets entries must be strings`, { module: mod.id || index, net });
		}
	}

	const allNets = stringSet(modules.flatMap(mod => asArray(mod?.requiredNets)));
	const ifaceKeys = new Set();
	for (const [index, iface] of asArray(spec.interfaces).entries()) {
		if (!iface || typeof iface !== 'object') {
			hard(findings, 'SS12-interface-object', 'each spec interface must be an object', { index });
			continue;
		}
		if (!iface.net || typeof iface.net !== 'string') hard(findings, 'SS13-interface-net', 'interface needs net', { index, interface: iface });
		if (!iface.from || typeof iface.from !== 'string') hard(findings, 'SS14-interface-from', 'interface needs from module id', { index, interface: iface });
		if (!iface.to || typeof iface.to !== 'string') hard(findings, 'SS15-interface-to', 'interface needs to module id', { index, interface: iface });
		if (iface.from && !moduleIds.has(iface.from)) hard(findings, 'SS16-interface-from-module', `${iface.net || index} from module is not in spec modules`, { interface: iface });
		if (iface.to && !moduleIds.has(iface.to)) hard(findings, 'SS17-interface-to-module', `${iface.net || index} to module is not in spec modules`, { interface: iface });
		if (iface.net && !allNets.has(iface.net)) hard(findings, 'SS18-interface-net-declared', `${iface.net} interface net is not declared by any spec module`, { interface: iface });
		const key = `${iface.net || ''}:${iface.from || ''}:${iface.to || ''}`;
		if (ifaceKeys.has(key)) hard(findings, 'SS19-interface-unique', `duplicate spec interface ${key}`, { interface: iface });
		else ifaceKeys.add(key);
	}

	const quality = spec.qualityPolicy || {};
	for (const key of ['severityMustBeZero', 'singleSheetNoNetPortsByDefault', 'fakeTextNetLabelsAllowed']) {
		if (quality[key] !== undefined && typeof quality[key] !== 'boolean') hard(findings, 'SS20-quality-boolean', `qualityPolicy.${key} must be boolean`, { key, value: quality[key] });
	}
	for (const key of ['drcErrors', 'drcWarnings', 'drcInfo']) {
		if (quality[key] !== undefined && !Number.isInteger(quality[key])) hard(findings, 'SS21-quality-drc-integer', `qualityPolicy.${key} must be integer`, { key, value: quality[key] });
	}
	return findings;
}
