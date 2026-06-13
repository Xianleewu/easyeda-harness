import { asArray } from './module_contract.mjs';

function hard(findings, rule, msg, where = {}, category = 'project-layout') {
	findings.push({ rule, severity: 'hard', category, msg, where });
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function validateLayoutContract(assembly, layout, structure, options = {}) {
	const category = options.category || 'project-layout';
	const findings = [];
	const policy = assembly.layoutPolicy || {};
	const modules = asArray(assembly.modules);
	const anchors = assembly.anchors || {};
	const base = policy.baseAnchors || {};

	if (!policy.candidateSource) hard(findings, 'PL1-candidate-source-declared', 'layoutPolicy.candidateSource must be declared', {}, category);
	if (layout.candidateSource !== policy.candidateSource) {
		hard(findings, 'PL2-planner-uses-assembly-policy', 'layout planner report must prove candidates came from project_assembly.json layoutPolicy', {
			expected: policy.candidateSource,
			actual: layout.candidateSource,
		}, category);
	}

	for (const mod of modules) {
		if (!mod.anchor || !finitePoint(anchors[mod.anchor])) {
			hard(findings, 'PL3-module-anchor-defined', `${mod.id} module must reference a finite project anchor`, { module: mod.id, anchor: mod.anchor }, category);
		}
		if (!mod.registryModule) {
			hard(findings, 'PL4-registry-module-defined', `${mod.id} module must name its registry module for layout metrics`, { module: mod.id }, category);
		}
	}

	const expectedAnchors = new Set(modules.map(mod => mod.anchor).filter(Boolean));
	const missingBase = [...expectedAnchors].filter(anchor => !finitePoint(base[anchor]));
	if (missingBase.length) {
		hard(findings, 'PL5-base-anchors-cover-modules', 'layoutPolicy.baseAnchors must cover every module anchor', { missingBase }, category);
	}

	const stats = layout.policyStats || {};
	if ((stats.baseAnchors ?? 0) < expectedAnchors.size) hard(findings, 'PL6-policy-stats-base-anchors', 'planner policy stats show incomplete base anchor coverage', { stats, expectedAnchors: expectedAnchors.size }, category);
	if ((stats.inputRows ?? 0) < 1 || (stats.outputRows ?? 0) < 1 || (stats.xProfiles ?? 0) < 1) {
		hard(findings, 'PL7-policy-search-space', 'layoutPolicy must define inputRows, outputRows, and xProfiles so layout search is project-driven', { stats }, category);
	}
	if ((layout.totalCandidates ?? 0) < 10) {
		hard(findings, 'PL8-candidate-count', 'layout planner must evaluate multiple project-policy candidates, not a single fixed coordinate set', {
			totalCandidates: layout.totalCandidates,
			availableCandidates: layout.availableCandidates,
		}, category);
	}

	const best = layout.best || {};
	if (best.pass !== true) hard(findings, 'PL9-best-layout-pass', 'layout planner best candidate must pass all local layout audits', { bestPass: best.pass, score: best.score }, category);

	const minGapRequired = policy.minModuleGap ?? 90;
	if ((structure.minModuleGap ?? 0) < minGapRequired) {
		hard(findings, 'PL10-min-module-gap', 'final layout must keep module rectangles separated by the project minimum gap', {
			minModuleGap: structure.minModuleGap,
			required: minGapRequired,
			gaps: structure.gaps,
		}, category);
	}

	if (policy.requireNoLaneInterlocks !== false && asArray(structure.laneInterlocks).length > 0) {
		hard(findings, 'PL11-no-lane-interlocks', 'final layout must not use interlocking module lanes', {
			laneInterlocks: structure.laneInterlocks,
		}, category);
	}

	const maxIntrusions = policy.maxModuleWireIntrusions ?? 0;
	const intrusionCount = structure.stats?.moduleWireIntrusions ?? asArray(structure.moduleWireIntrusions).length;
	if (intrusionCount > maxIntrusions) {
		hard(findings, 'PL12-no-wire-intrusions', 'final layout must not route wires through unrelated module spaces', {
			moduleWireIntrusions: intrusionCount,
			maxModuleWireIntrusions: maxIntrusions,
			intrusions: structure.moduleWireIntrusions,
		}, category);
	}

	if (structure.pass !== true) {
		hard(findings, 'PL13-structure-pass', 'structure_metrics report must pass for the final model', {
			severity: structure.severity,
			firstFinding: structure.findings?.[0] || null,
		}, category);
	}

	return findings;
}

