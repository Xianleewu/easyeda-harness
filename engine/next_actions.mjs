import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_NEXT_ACTIONS || DIR + 'next_actions.json';

function readJson(name) {
	const path = DIR + name;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message, path };
	}
}

function status(pass) {
	return pass === true ? 'pass' : pass === false ? 'fail' : 'missing';
}

function pushAction(actions, item) {
	actions.push({
		priority: actions.length + 1,
		...item,
	});
}

const acceptance = readJson('acceptance_report.json');
const spec = readJson('project_spec_report.json');
const contract = readJson('project_contract_report.json');
const projectModel = readJson('project_model_report.json');
const template = readJson('report.json');
const preview = readJson('visual_review_report.json');
const drc = readJson('drc_report.json');
const liveShots = readJson('live_shots_report.json');
const liveDiagnose = readJson('live_diagnose_report.json');

const checks = {
	spec: {
		status: status(spec?.pass),
		severity: spec?.severity || null,
		projectId: spec?.projectId || null,
		modules: spec?.modules ?? null,
		interfaces: spec?.interfaces ?? null,
		firstFinding: spec?.findings?.[0] || null,
		evidence: 'project_spec_report.json',
	},
	contract: {
		status: status(contract?.pass),
		severity: contract?.severity || null,
		projectId: contract?.projectId || null,
		modules: contract?.modules ?? null,
		interfaces: contract?.interfaces ?? null,
		visualEvidenceRegions: contract?.visualEvidenceRegions ?? null,
		firstFinding: contract?.findings?.[0] || null,
		evidence: 'project_contract_report.json',
	},
	template: {
		status: status(template?.pass),
		severity: template?.severity || null,
		evidence: 'report.json',
	},
	projectModel: {
		status: status(projectModel?.pass),
		severity: projectModel?.severity || null,
		projectId: projectModel?.projectId || null,
		modelStats: projectModel?.modelStats || null,
		firstFinding: projectModel?.findings?.[0] || null,
		evidence: 'project_model_report.json',
	},
	preview: {
		status: status(preview?.pass),
		screenshots: preview?.screenshots || 0,
		severity: preview?.severity || null,
		evidence: 'visual_review_report.json',
	},
	acceptance: {
		status: status(acceptance?.pass),
		mode: acceptance?.mode || null,
		severity: acceptance?.severity || null,
		evidence: 'acceptance_report.json',
	},
	drc: {
		status: status(drc?.pass),
		severity: drc?.severity || null,
		counts: drc?.drc ? {
			errors: drc.drc.errors ?? null,
			warnings: drc.drc.warnings ?? null,
			info: drc.drc.info ?? null,
			source: drc.drc.source || null,
		} : null,
		evidence: 'drc_report.json',
	},
	liveShots: {
		status: status(liveShots?.pass),
		screenshots: liveShots?.screenshots || 0,
		captureMode: liveShots?.captureMode || null,
		fallbackDiagnosticOnly: liveShots?.fallbackDiagnosticOnly === true,
		zoomEvidence: liveShots?.zoomEvidence ? {
			requestedRegions: liveShots.zoomEvidence.requestedRegions,
			uniqueRequestedCaptures: liveShots.zoomEvidence.uniqueRequestedCaptures,
		} : null,
		firstFinding: liveShots?.findings?.[0] || null,
		evidence: 'live_shots_report.json',
	},
	liveDiagnose: {
		status: liveDiagnose ? 'available' : 'missing',
		zoomChecks: (liveDiagnose?.zoomChecks || []).map(z => ({
			name: z.name,
			ret: z.ret,
			err: z.err,
			canvasDataUrlSha256: z.canvasDataUrlSha256,
			canvasDataUrlLength: z.canvasDataUrlLength,
		})),
		evidence: 'live_diagnose_report.json',
	},
};

const actions = [];
if (checks.spec.status !== 'pass') {
	pushAction(actions, {
		area: 'project-spec',
		action: 'Create or fix project_spec.json first. The spec is the user-intent input and must be covered by project_contract.json before cells, assembly, or write-back work can be trusted.',
		evidence: ['project_spec.json', 'project_contract.json', 'project_spec_report.json'],
		observed: checks.spec.firstFinding || checks.spec,
	});
}
if (checks.contract.status !== 'pass') {
	pushAction(actions, {
		area: 'project-contract',
		action: 'Create or fix project_contract.json before editing schematic cells or writing back. The contract must define modules, required parts/nets, interfaces, visual evidence regions, and no-free-draw policy.',
		evidence: ['project_contract.json', 'project_contract_report.json'],
		observed: checks.contract.firstFinding || checks.contract,
	});
}
if (checks.template.status !== 'pass') {
	pushAction(actions, {
		area: 'template',
		action: 'Fix deterministic schematic model until report.json has HARD=0 SOFT=0 INFO=0.',
		evidence: ['report.json'],
	});
}
if (checks.projectModel.status !== 'pass') {
	pushAction(actions, {
		area: 'project-model',
		action: 'Make full_model.json satisfy project_contract.json. Fix deterministic cells, assembly, or the contract so required modules, parts, nets, and interfaces match the generated model.',
		evidence: ['project_contract.json', 'full_model.json', 'project_model_report.json'],
		observed: checks.projectModel.firstFinding || checks.projectModel,
	});
}
if (checks.preview.status !== 'pass' || checks.preview.screenshots < 10) {
	pushAction(actions, {
		area: 'offline-preview',
		action: 'Fix offline preview renderer/model until visual_review_report.json passes with at least 10 screenshots.',
		evidence: ['visual_review_report.json', 'visual_crops/'],
	});
}
if (acceptance?.mode === 'full-with-live' && checks.drc.status !== 'pass') {
	pushAction(actions, {
		area: 'drc',
		action: 'Fix EasyEDA DRC until drc_report.json proves 0 errors, 0 warnings, and 0 info.',
		evidence: ['drc_report.json'],
		observed: checks.drc.counts || checks.drc,
	});
}
if (checks.liveShots.status === 'fail') {
	const first = checks.liveShots.firstFinding;
	if (first?.rule === 'LS6-live-crop-diagnostic-only') {
		pushAction(actions, {
			area: 'live-capture',
			action: 'Resolve EasyEDA live region capture: zoom requests currently produce identical canvas images, so module-level live screenshots cannot be accepted.',
			evidence: ['live_shots_report.json', 'live_diagnose_report.json'],
			observed: checks.liveShots.zoomEvidence,
			nextProbe: 'Use npm run live:diagnose after changing EasyEDA client/bridge capture behavior; acceptance requires uniqueRequestedCaptures >= 10 for requestedRegions >= 10.',
		});
	} else {
		pushAction(actions, {
			area: 'live-capture',
			action: 'Fix live module screenshots until live_shots_report.json passes with at least 10 distinct module-level images.',
			evidence: ['live_shots_report.json'],
			observed: first || checks.liveShots,
		});
	}
}
if (checks.acceptance.status === 'fail' && !actions.length) {
	pushAction(actions, {
		area: 'acceptance',
		action: 'Inspect acceptance_report.json for failed required steps.',
		evidence: ['acceptance_report.json'],
	});
}

const result = {
	generatedAt: new Date().toISOString(),
	pass: actions.length === 0,
	checks,
	actions,
};

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
console.log(`next actions ${result.pass ? 'PASS' : 'OPEN'} count=${actions.length}`);
console.log(`report -> ${OUT}`);
process.exit(result.pass ? 0 : 1);
