import { parentPort, workerData } from 'node:worker_threads';
import { loadPartLib, assemble } from './assemble.mjs';
import { evaluateLayout } from './layout_planner.mjs';

const { partLib, anchorsList } = workerData;
const { snap, byDes } = loadPartLib(partLib);

function summarizeEvaluation(evaluation) {
	return {
		score: evaluation.score,
		pass: evaluation.pass,
		template: {
			pass: evaluation.template.pass,
			severity: evaluation.template.bySev,
			byRule: Object.fromEntries(evaluation.template.findings.map(f => [f.rule, (evaluation.template.findings.filter(x => x.rule === f.rule).length)])),
		},
		structure: {
			pass: evaluation.structure.pass,
			severity: evaluation.structure.severity,
			minModuleGap: evaluation.structure.minModuleGap,
			moduleWireIntrusions: evaluation.structure.stats?.moduleWireIntrusions ?? 0,
			findings: (evaluation.structure.findings || []).map(f => ({ rule: f.rule, msg: f.msg })),
		},
		architecture: { pass: evaluation.architecture.pass, severity: evaluation.architecture.severity, stats: evaluation.architecture.stats, findings: evaluation.architecture.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		pageComposition: { pass: evaluation.pageComposition.pass, severity: evaluation.pageComposition.severity, stats: evaluation.pageComposition.stats, findings: evaluation.pageComposition.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		systemIntent: { pass: evaluation.systemIntent.pass, severity: evaluation.systemIntent.severity, stats: evaluation.systemIntent.stats, findings: evaluation.systemIntent.findings.map(f => ({ rule: f.rule, msg: f.msg })) },
		sheetOutput: {
			pass: evaluation.sheetOutput.pass,
			severity: evaluation.sheetOutput.severity,
			evidence: evaluation.sheetOutput.render?.evidence,
			findings: evaluation.sheetOutput.findings.map(f => ({ rule: f.rule, msg: f.msg, where: f.where })),
		},
		design: { pass: evaluation.design.pass, score: evaluation.design.score, stats: evaluation.design.stats, dimensions: evaluation.design.dimensions.map(d => ({ id: d.id, pass: d.pass, score: d.score })) },
		internalPacking: evaluation.internalPacking,
	};
}

const results = anchorsList.map(anchors => {
	const model = assemble(byDes, anchors);
	const evaluation = evaluateLayout(model, snap, {
		structureReport: null,
		quickSheet: true,
		earlyExitHard: true,
	});
	return {
		anchors,
		...summarizeEvaluation(evaluation),
	};
});

parentPort.postMessage(results);
