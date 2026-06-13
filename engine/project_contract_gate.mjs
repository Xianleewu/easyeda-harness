import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const REPORT = process.env.EASYEDA_PROJECT_CONTRACT_REPORT || DIR + 'project_contract_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-contract', msg, where });
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function validateContract(contract) {
	const findings = [];
	if (!contract || typeof contract !== 'object') {
		hard(findings, 'PC1-contract-object', 'project contract must be a JSON object');
		return findings;
	}
	if (contract.schemaVersion !== 1) hard(findings, 'PC2-schema-version', 'project contract schemaVersion must be 1', { schemaVersion: contract.schemaVersion });
	if (!contract.projectId || typeof contract.projectId !== 'string') hard(findings, 'PC3-project-id', 'project contract needs a stable projectId');
	if (!contract.intent || typeof contract.intent !== 'string') hard(findings, 'PC4-intent', 'project contract needs a concise design intent');

	const workflow = contract.agentWorkflow || {};
	if (workflow.freeDrawAllowed !== false) hard(findings, 'PC5-no-free-draw', 'agentWorkflow.freeDrawAllowed must be false');
	const editPath = String(workflow.authoritativeEditPath || '');
	for (const token of ['project contract', 'deterministic', 'gates', 'gated write-back']) {
		if (!editPath.toLowerCase().includes(token)) hard(findings, 'PC6-edit-path', `authoritativeEditPath must include "${token}"`, { authoritativeEditPath: editPath });
	}
	const entrypoints = new Set(asArray(workflow.requiredEntrypoints));
	for (const entrypoint of ['accept', 'accept:live', 'apply:gated']) {
		if (!entrypoints.has(entrypoint)) hard(findings, 'PC7-required-entrypoints', `requiredEntrypoints must include ${entrypoint}`, { requiredEntrypoints: [...entrypoints] });
	}

	const modules = asArray(contract.modules);
	if (!modules.length) hard(findings, 'PC8-modules-present', 'project contract must define at least one functional module');
	const moduleIds = new Set();
	for (const [index, mod] of modules.entries()) {
		if (!mod?.id) hard(findings, 'PC9-module-id', 'module needs id', { index });
		else if (moduleIds.has(mod.id)) hard(findings, 'PC10-module-id-unique', `duplicate module id: ${mod.id}`, { id: mod.id });
		else moduleIds.add(mod.id);
		if (!mod?.title) hard(findings, 'PC11-module-title', 'module needs readable title', { module: mod?.id || index });
		if (!asArray(mod?.requiredParts).length) hard(findings, 'PC12-module-parts', 'module needs requiredParts', { module: mod?.id || index });
		if (!asArray(mod?.requiredNets).length) hard(findings, 'PC13-module-nets', 'module needs requiredNets', { module: mod?.id || index });
		if (!mod?.visualEvidence) hard(findings, 'PC14-module-evidence', 'module needs visualEvidence region id', { module: mod?.id || index });
	}

	const evidence = new Set(asArray(contract.visualEvidenceRegions));
	if (evidence.size < Math.min(10, Math.max(1, modules.length))) hard(findings, 'PC15-evidence-count', 'visualEvidenceRegions must cover global and module-level proof regions', { count: evidence.size, modules: modules.length });
	for (const mod of modules) {
		if (mod?.visualEvidence && !evidence.has(mod.visualEvidence)) hard(findings, 'PC16-module-evidence-region', `${mod.id} visualEvidence is not listed in visualEvidenceRegions`, { module: mod.id, visualEvidence: mod.visualEvidence });
	}

	const interfaces = asArray(contract.interfaces);
	const ifaceKeys = new Set();
	for (const [index, iface] of interfaces.entries()) {
		if (!iface?.net || !iface?.from || !iface?.to) hard(findings, 'PC17-interface-shape', 'interface needs net/from/to', { index, interface: iface });
		if (iface?.from && !moduleIds.has(iface.from)) hard(findings, 'PC18-interface-from-module', `${iface.net} from module is not defined`, { interface: iface });
		if (iface?.to && !moduleIds.has(iface.to)) hard(findings, 'PC19-interface-to-module', `${iface.net} to module is not defined`, { interface: iface });
		if (!iface?.policy) hard(findings, 'PC20-interface-policy', `${iface?.net || index} needs a visual/electrical policy`, { interface: iface });
		const key = `${iface?.net || ''}:${iface?.from || ''}:${iface?.to || ''}`;
		if (ifaceKeys.has(key)) hard(findings, 'PC21-interface-unique', `duplicate interface ${key}`, { interface: iface });
		else ifaceKeys.add(key);
	}

	const quality = contract.qualityPolicy || {};
	if (quality.severityMustBeZero !== true) hard(findings, 'PC22-zero-severity-policy', 'qualityPolicy.severityMustBeZero must be true');
	for (const [key, expected] of Object.entries({ drcErrors: 0, drcWarnings: 0, drcInfo: 0 })) {
		if (quality[key] !== expected) hard(findings, 'PC23-drc-zero-policy', `qualityPolicy.${key} must be ${expected}`, { [key]: quality[key] });
	}
	if (quality.fakeTextNetLabelsAllowed !== false) hard(findings, 'PC24-no-fake-net-text', 'fake text net labels must be forbidden');
	if (quality.singleSheetNoNetPortsByDefault !== true) hard(findings, 'PC25-no-net-port-default', 'single-sheet schematics must forbid unnecessary NET PORT symbols by default');
	if (quality.wireNameLeftAlignMode !== 6 || quality.wireNameRightAlignMode !== 8) {
		hard(findings, 'PC26-wire-name-origin', 'wire Name origin policy must encode left-bottom=6 and right-bottom=8', {
			wireNameLeftAlignMode: quality.wireNameLeftAlignMode,
			wireNameRightAlignMode: quality.wireNameRightAlignMode,
		});
	}
	return findings;
}

let findings = [];
let contract = null;
if (!existsSync(CONTRACT)) {
	hard(findings, 'PC0-contract-file', 'project_contract.json is required before any agent can claim this harness applies to a project', { path: CONTRACT });
} else {
	try {
		contract = readJson(CONTRACT);
		findings = validateContract(contract);
	} catch (e) {
		hard(findings, 'PC0-contract-parse', 'project contract must parse as JSON', { path: CONTRACT, error: e.message });
	}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	modules: asArray(contract?.modules).length,
	interfaces: asArray(contract?.interfaces).length,
	visualEvidenceRegions: asArray(contract?.visualEvidenceRegions).length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project contract ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
