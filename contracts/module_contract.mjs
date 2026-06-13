export function asArray(value) {
	return Array.isArray(value) ? value : [];
}

export const REQUIRED_DRAWING_RULES = [
	'orthogonal-wiring',
	'real-net-labels',
	'text-clearance',
	'module-box-isolation',
	'no-fake-net-text',
	'no-unnecessary-net-ports',
];

function hard(findings, rule, msg, where = {}, category = 'project-contract') {
	findings.push({ rule, severity: 'hard', category, msg, where });
}

export function validateModuleContract(contract, options = {}) {
	const category = options.category || 'project-contract';
	const findings = [];
	if (!contract || typeof contract !== 'object') {
		hard(findings, 'PC1-contract-object', 'project contract must be a JSON object', {}, category);
		return findings;
	}
	if (contract.schemaVersion !== 1) hard(findings, 'PC2-schema-version', 'project contract schemaVersion must be 1', { schemaVersion: contract.schemaVersion }, category);
	if (!contract.projectId || typeof contract.projectId !== 'string') hard(findings, 'PC3-project-id', 'project contract needs a stable projectId', {}, category);
	if (!contract.intent || typeof contract.intent !== 'string') hard(findings, 'PC4-intent', 'project contract needs a concise design intent', {}, category);

	const workflow = contract.agentWorkflow || {};
	if (workflow.freeDrawAllowed !== false) hard(findings, 'PC5-no-free-draw', 'agentWorkflow.freeDrawAllowed must be false', {}, category);
	const editPath = String(workflow.authoritativeEditPath || '');
	for (const token of ['project contract', 'deterministic', 'gates', 'gated write-back']) {
		if (!editPath.toLowerCase().includes(token)) hard(findings, 'PC6-edit-path', `authoritativeEditPath must include "${token}"`, { authoritativeEditPath: editPath }, category);
	}
	const entrypoints = new Set(asArray(workflow.requiredEntrypoints));
	for (const entrypoint of ['accept', 'accept:live', 'apply:gated']) {
		if (!entrypoints.has(entrypoint)) hard(findings, 'PC7-required-entrypoints', `requiredEntrypoints must include ${entrypoint}`, { requiredEntrypoints: [...entrypoints] }, category);
	}

	const modules = asArray(contract.modules);
	if (!modules.length) hard(findings, 'PC8-modules-present', 'project contract must define at least one functional module', {}, category);
	const moduleIds = new Set();
	const partOwners = new Map();
	for (const [index, mod] of modules.entries()) {
		if (!mod?.id) hard(findings, 'PC9-module-id', 'module needs id', { index }, category);
		else if (moduleIds.has(mod.id)) hard(findings, 'PC10-module-id-unique', `duplicate module id: ${mod.id}`, { id: mod.id }, category);
		else moduleIds.add(mod.id);
		if (!mod?.title) hard(findings, 'PC11-module-title', 'module needs readable title', { module: mod?.id || index }, category);
		if (!asArray(mod?.requiredParts).length) hard(findings, 'PC12-module-parts', 'module needs requiredParts', { module: mod?.id || index }, category);
		for (const ref of asArray(mod?.requiredParts)) {
			if (partOwners.has(ref)) {
				hard(findings, 'PC28-required-part-owned-once', 'each physical designator in requiredParts must belong to exactly one contract module', {
					designator: ref,
					firstModule: partOwners.get(ref),
					duplicateModule: mod?.id || index,
				}, category);
			} else {
				partOwners.set(ref, mod?.id || index);
			}
		}
		if (!asArray(mod?.requiredNets).length) hard(findings, 'PC13-module-nets', 'module needs requiredNets', { module: mod?.id || index }, category);
		if (!mod?.visualEvidence) hard(findings, 'PC14-module-evidence', 'module needs visualEvidence region id', { module: mod?.id || index }, category);
		const drawingRules = new Set(asArray(mod?.drawingRules));
		const missingDrawingRules = REQUIRED_DRAWING_RULES.filter(rule => !drawingRules.has(rule));
		if (missingDrawingRules.length) {
			hard(findings, 'PC27-module-drawing-rules', 'module drawingRules must declare the reusable schematic-quality rules it is designed to satisfy before deterministic cells are trusted', {
				module: mod?.id || index,
				missingDrawingRules,
			}, category);
		}
	}

	const evidence = new Set(asArray(contract.visualEvidenceRegions));
	if (evidence.size < Math.min(10, Math.max(1, modules.length))) hard(findings, 'PC15-evidence-count', 'visualEvidenceRegions must cover global and module-level proof regions', { count: evidence.size, modules: modules.length }, category);
	for (const mod of modules) {
		if (mod?.visualEvidence && !evidence.has(mod.visualEvidence)) hard(findings, 'PC16-module-evidence-region', `${mod.id} visualEvidence is not listed in visualEvidenceRegions`, { module: mod.id, visualEvidence: mod.visualEvidence }, category);
	}

	const interfaces = asArray(contract.interfaces);
	const ifaceKeys = new Set();
	for (const [index, iface] of interfaces.entries()) {
		if (!iface?.net || !iface?.from || !iface?.to) hard(findings, 'PC17-interface-shape', 'interface needs net/from/to', { index, interface: iface }, category);
		if (iface?.from && !moduleIds.has(iface.from)) hard(findings, 'PC18-interface-from-module', `${iface.net} from module is not defined`, { interface: iface }, category);
		if (iface?.to && !moduleIds.has(iface.to)) hard(findings, 'PC19-interface-to-module', `${iface.net} to module is not defined`, { interface: iface }, category);
		if (!iface?.policy) hard(findings, 'PC20-interface-policy', `${iface?.net || index} needs a visual/electrical policy`, { interface: iface }, category);
		const key = `${iface?.net || ''}:${iface?.from || ''}:${iface?.to || ''}`;
		if (ifaceKeys.has(key)) hard(findings, 'PC21-interface-unique', `duplicate interface ${key}`, { interface: iface }, category);
		else ifaceKeys.add(key);
	}

	const quality = contract.qualityPolicy || {};
	if (quality.severityMustBeZero !== true) hard(findings, 'PC22-zero-severity-policy', 'qualityPolicy.severityMustBeZero must be true', {}, category);
	for (const [key, expected] of Object.entries({ drcErrors: 0, drcWarnings: 0, drcInfo: 0 })) {
		if (quality[key] !== expected) hard(findings, 'PC23-drc-zero-policy', `qualityPolicy.${key} must be ${expected}`, { [key]: quality[key] }, category);
	}
	if (quality.fakeTextNetLabelsAllowed !== false) hard(findings, 'PC24-no-fake-net-text', 'fake text net labels must be forbidden', {}, category);
	if (quality.singleSheetNoNetPortsByDefault !== true) hard(findings, 'PC25-no-net-port-default', 'single-sheet schematics must forbid unnecessary NET PORT symbols by default', {}, category);
	if (quality.wireNameLeftAlignMode !== 6 || quality.wireNameRightAlignMode !== 8) {
		hard(findings, 'PC26-wire-name-origin', 'wire Name origin policy must encode left-bottom=6 and right-bottom=8', {
			wireNameLeftAlignMode: quality.wireNameLeftAlignMode,
			wireNameRightAlignMode: quality.wireNameRightAlignMode,
		}, category);
	}
	return findings;
}
