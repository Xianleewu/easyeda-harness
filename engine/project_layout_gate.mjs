import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const LAYOUT_REPORT = process.env.EASYEDA_LAYOUT_REPORT_OUT || DIR + 'layout_planner_report.json';
const STRUCTURE_REPORT = process.env.EASYEDA_LAYOUT_PLANNER_STRUCTURE || DIR + 'layout_planner_structure.json';
const REPORT = process.env.EASYEDA_PROJECT_LAYOUT_REPORT || DIR + 'project_layout_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'project-layout', msg, where });
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validateLayoutPolicy(assembly, layout, structure) {
	const findings = [];
	const policy = assembly.layoutPolicy || {};
	const modules = asArray(assembly.modules);
	const anchors = assembly.anchors || {};
	const base = policy.baseAnchors || {};

	if (!policy.candidateSource) hard(findings, 'PL1-candidate-source-declared', 'layoutPolicy.candidateSource must be declared', {});
	if (layout.candidateSource !== policy.candidateSource) {
		hard(findings, 'PL2-planner-uses-assembly-policy', 'layout planner report must prove candidates came from project_assembly.json layoutPolicy', {
			expected: policy.candidateSource,
			actual: layout.candidateSource,
		});
	}

	for (const mod of modules) {
		if (!mod.anchor || !finitePoint(anchors[mod.anchor])) {
			hard(findings, 'PL3-module-anchor-defined', `${mod.id} module must reference a finite project anchor`, { module: mod.id, anchor: mod.anchor });
		}
		if (!mod.registryModule) {
			hard(findings, 'PL4-registry-module-defined', `${mod.id} module must name its registry module for layout metrics`, { module: mod.id });
		}
	}

	const expectedAnchors = new Set(modules.map(mod => mod.anchor).filter(Boolean));
	const missingBase = [...expectedAnchors].filter(anchor => !finitePoint(base[anchor]));
	if (missingBase.length) {
		hard(findings, 'PL5-base-anchors-cover-modules', 'layoutPolicy.baseAnchors must cover every module anchor', { missingBase });
	}

	const stats = layout.policyStats || {};
	if ((stats.baseAnchors ?? 0) < expectedAnchors.size) hard(findings, 'PL6-policy-stats-base-anchors', 'planner policy stats show incomplete base anchor coverage', { stats, expectedAnchors: expectedAnchors.size });
	if ((stats.inputRows ?? 0) < 1 || (stats.outputRows ?? 0) < 1 || (stats.xProfiles ?? 0) < 1) {
		hard(findings, 'PL7-policy-search-space', 'layoutPolicy must define inputRows, outputRows, and xProfiles so layout search is project-driven', { stats });
	}
	if ((layout.totalCandidates ?? 0) < 10) {
		hard(findings, 'PL8-candidate-count', 'layout planner must evaluate multiple project-policy candidates, not a single fixed coordinate set', {
			totalCandidates: layout.totalCandidates,
			availableCandidates: layout.availableCandidates,
		});
	}

	const best = layout.best || {};
	if (best.pass !== true) hard(findings, 'PL9-best-layout-pass', 'layout planner best candidate must pass all local layout audits', { bestPass: best.pass, score: best.score });

	const minGapRequired = policy.minModuleGap ?? 90;
	if ((structure.minModuleGap ?? 0) < minGapRequired) {
		hard(findings, 'PL10-min-module-gap', 'final layout must keep module rectangles separated by the project minimum gap', {
			minModuleGap: structure.minModuleGap,
			required: minGapRequired,
			gaps: structure.gaps,
		});
	}

	if (policy.requireNoLaneInterlocks !== false && asArray(structure.laneInterlocks).length > 0) {
		hard(findings, 'PL11-no-lane-interlocks', 'final layout must not use interlocking module lanes', {
			laneInterlocks: structure.laneInterlocks,
		});
	}

	const maxIntrusions = policy.maxModuleWireIntrusions ?? 0;
	const intrusionCount = structure.stats?.moduleWireIntrusions ?? asArray(structure.moduleWireIntrusions).length;
	if (intrusionCount > maxIntrusions) {
		hard(findings, 'PL12-no-wire-intrusions', 'final layout must not route wires through unrelated module spaces', {
			moduleWireIntrusions: intrusionCount,
			maxModuleWireIntrusions: maxIntrusions,
			intrusions: structure.moduleWireIntrusions,
		});
	}

	if (structure.pass !== true) {
		hard(findings, 'PL13-structure-pass', 'structure_metrics report must pass for the final model', {
			severity: structure.severity,
			firstFinding: structure.findings?.[0] || null,
		});
	}

	return findings;
}

const findings = [];
let assembly = null;
let layout = null;
let structure = null;
if (!existsSync(ASSEMBLY)) hard(findings, 'PL0-assembly-file', 'project_assembly.json is required before layout contract audit', { path: ASSEMBLY });
if (!existsSync(LAYOUT_REPORT)) hard(findings, 'PL0-layout-report-file', 'layout_planner_report.json is required before layout contract audit; run npm run pipeline first', { path: LAYOUT_REPORT });
if (!existsSync(STRUCTURE_REPORT)) hard(findings, 'PL0-structure-report-file', 'layout_planner_structure.json is required before layout contract audit; run npm run pipeline first', { path: STRUCTURE_REPORT });
if (!findings.length) {
	try { assembly = readJson(ASSEMBLY); } catch (e) { hard(findings, 'PL0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
	try { layout = readJson(LAYOUT_REPORT); } catch (e) { hard(findings, 'PL0-layout-report-parse', 'layout_planner_report.json must parse as JSON', { error: e.message }); }
	try { structure = readJson(STRUCTURE_REPORT); } catch (e) { hard(findings, 'PL0-structure-report-parse', 'layout_planner_structure.json must parse as JSON', { error: e.message }); }
}
if (assembly && layout && structure) findings.push(...validateLayoutPolicy(assembly, layout, structure));

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	projectId: assembly?.projectId || null,
	candidateSource: layout?.candidateSource || null,
	totalCandidates: layout?.totalCandidates ?? null,
	availableCandidates: layout?.availableCandidates ?? null,
	policyStats: layout?.policyStats || null,
	minModuleGap: structure?.minModuleGap ?? null,
	moduleWireIntrusions: structure?.stats?.moduleWireIntrusions ?? null,
	laneInterlocks: asArray(structure?.laneInterlocks).length,
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`project layout ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
