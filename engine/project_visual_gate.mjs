import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const VISUAL = process.env.EASYEDA_VISUAL_REPORT || DIR + 'visual_review_report.json';
const REPORT = process.env.EASYEDA_PROJECT_VISUAL_REPORT || DIR + 'project_visual_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-visual', msg, where });
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizeId(value) {
	return String(value || '').replace(/^\d+_/, '').replace(/_/g, '-');
}

const findings = [];
let contract = null;
let visual = null;
if (!existsSync(CONTRACT)) hard(findings, 'PV0-contract-file', 'project_contract.json is required before visual evidence audit', { path: CONTRACT });
if (!existsSync(VISUAL)) hard(findings, 'PV0-visual-file', 'visual_review_report.json is required before visual evidence audit', { path: VISUAL });
if (!findings.length) {
	try { contract = readJson(CONTRACT); } catch (e) { hard(findings, 'PV0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
	try { visual = readJson(VISUAL); } catch (e) { hard(findings, 'PV0-visual-parse', 'visual_review_report.json must parse as JSON', { error: e.message }); }
}

if (contract && visual) {
	if (visual.pass !== true) hard(findings, 'PV1-visual-pass', 'visual_review_report.json must pass before contract visual evidence can pass', { severity: visual.severity || null });
	const crops = asArray(visual.regions);
	const byEvidence = new Map();
	for (const crop of crops) {
		const id = normalizeId(crop.evidenceId || crop.region);
		if (id) byEvidence.set(id, crop);
	}
	for (const required of asArray(contract.visualEvidenceRegions)) {
		const id = normalizeId(required);
		const crop = byEvidence.get(id);
		if (!crop) {
			hard(findings, 'PV2-required-region-present', `contract visual evidence region is missing from preview: ${required}`, { required, available: [...byEvidence.keys()].sort() });
			continue;
		}
		if (crop.pass !== true) hard(findings, 'PV3-required-region-pass', `contract visual evidence region did not pass image inspection: ${required}`, { required, crop });
	}
	for (const mod of asArray(contract.modules)) {
		const id = normalizeId(mod.visualEvidence);
		if (id && !byEvidence.has(id)) hard(findings, 'PV4-module-evidence-present', `${mod.id} module visualEvidence is missing from preview`, { module: mod.id, visualEvidence: mod.visualEvidence });
	}
}

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: contract?.projectId || null,
	requiredRegions: asArray(contract?.visualEvidenceRegions),
	availableRegions: asArray(visual?.regions).map(r => normalizeId(r.evidenceId || r.region)).filter(Boolean),
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project visual ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
