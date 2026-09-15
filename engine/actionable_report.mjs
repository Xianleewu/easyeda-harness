// Compact, deterministic handoff for agents and humans. The full geometry and
// raw reports remain separate artifacts; this file turns their findings into a
// prioritized queue without inventing circuit-specific repair advice.

const severityOrder = new Map([
	['T-DRC', 0],
	['T-NOCROSS', 1], ['T-NOTHRU', 1], ['T-NOTHRU-TEXT', 1],
	['T-NOOVERLAP', 2], ['T-TEXT-OVERLAP', 2], ['T-LABEL-CROWD', 2], ['T-PAGE', 2],
	['T-CONN-MOUNT', 3], ['T-ADJACENCY', 3], ['T-FLAG-ORIENT', 3],
	['T-PIN-SEMANTICS', 3],
	['T-HIGHSPEED', 3],
	['T-PASSIVE', 3],
	['T-LABEL-ALIGN', 4], ['T-FLAG-ALIGN', 4], ['T-ANNOT-SIDE', 4],
	['T-ORPHAN', 3], ['T-CELL-SPACING', 5], ['T-MODULE-SPACING', 5], ['T-BODY-CLEARANCE', 5], ['T-DENSITY', 5],
]);

const deterministicRecipe = new Map([
	['T-NOCROSS', 'reroute-different-net-contact'],
	['T-NOTHRU', 'reroute-around-visible-objects'],
	['T-NOTHRU-TEXT', 'normalize-visible-net-annotations'],
	['T-NOOVERLAP', 'resolve-bounding-box-overlap'],
	['T-TEXT-OVERLAP', 'reflow-visible-annotations'],
	['T-LABEL-CROWD', 'reflow-signal-label-columns'],
	['T-PAGE', 'move-content-inside-sheet-keepouts'],
	['T-CONN-MOUNT', 'ground-mechanical-connector-pins'],
	['T-PIN-SEMANTICS', 'reconcile-connector-pin-profile'],
	['T-HIGHSPEED', 'reconcile-differential-pair-contract'],
	['T-PASSIVE', 'audit-passive-electrical-and-bound-footprint'],
	['T-ADJACENCY', 'place-support-by-connectivity'],
	['T-FLAG-ORIENT', 'orient-endpoint-away-from-stub'],
	['T-LABEL-ALIGN', 'snap-label-anchor-to-wire-end'],
	['T-FLAG-ALIGN', 'align-same-side-endpoint-axis'],
	['T-ANNOT-SIDE', 'place-part-annotations-on-one-side'],
	['T-ORPHAN', 'assign-every-part-to-module-and-cell'],
	['T-CELL-SPACING', 'repack-functional-cells'],
	['T-MODULE-SPACING', 'repack-modules'],
	['T-BODY-CLEARANCE', 'expand-local-body-clearance'],
	['T-DENSITY', 'compact-within-clearance'],
]);

const deviationRecipe = new Map([
	['missing-authoritative-netlist','reacquire-authoritative-netlist-before-repair'],
	['connector-footprint-live-source-unverified','replace-bound-footprint-from-verified-catalog-device'],
	['connector-footprint-binding-mismatch','restore-declared-footprint-binding'],
	['connector-topology-profile-missing','add-source-cited-connector-topology-review'],
	['connector-topology-review-open','complete-connector-topology-review'],
	['connector-topology-unexpected-short','separate-protocol-pins'],
	['connector-topology-same-net-mismatch','join-required-protocol-pins'],
	['connector-topology-via-mismatch','route-protocol-pins-through-declared-component'],
	['connector-topology-via-bypassed','remove-bypass-around-declared-component'],
	['connector-footprint-source-uuid-mismatch','replace-mismatched-footprint-source'],
	['connector-footprint-pads-missing','replace-empty-footprint'],
	['passive-electrical-profile-missing','complete-per-reference-electrical-review'],
	['passive-electrical-basis-incomplete','complete-per-reference-electrical-review'],
	['passive-electrical-not-approved','resolve-passive-electrical-review'],
	['passive-footprint-nonconform','sanitize-or-rebind-passive-footprint'],
	['passive-footprint-live-source-unverified','resolve-bound-passive-footprint-source'],
	['passive-footprint-library-mismatch','restore-declared-passive-footprint-library'],
]);

function targetOf(d) {
	const target = {};
	for (const key of ['id', 'component', 'designator', 'ref', 'pin', 'net', 'side', 'a', 'b', 'footprintUuid', 'expect', 'got'])
		if (d?.[key] !== undefined && d[key] !== '') target[key] = d[key];
	for (const key of ['segment', 'at', 'textBox', 'examples', 'pairs']) if (d?.[key] !== undefined) target[key] = d[key];
	return target;
}

function deviationVector(queue) {
	return Object.fromEntries(queue.map(q => [q.token, q.magnitude]));
}

export function selectNextBatch(queue) {
	const executable = queue.filter(q => deterministicRecipe.has(q.token));
	if (!executable.length) return null;
	const priority = Math.min(...executable.map(q => q.priority));
	const selected = executable.filter(q => q.priority === priority);
	return {
		mode: 'deterministic-repair',
		priority,
		tokens: selected.map(q => q.token),
		recipes: [...new Set(selected.flatMap(q => q.deviations.length
			? q.deviations.map(d=>deviationRecipe.get(d.kind)||deterministicRecipe.get(q.token))
			: [deterministicRecipe.get(q.token)]))],
		targets: selected.flatMap(q => q.deviations.map(targetOf)).filter(x => Object.keys(x).length),
		writePath: 'wf commit for source edits; wf api only when the official API must instantiate a primitive',
		preconditions: ['complete token coverage', 'fresh native DRC', 'current document identity', 'persisted source snapshot'],
		acceptance: 'Persisted readback must remove this batch or strictly reduce the full deviation vector without a new higher-priority deviation.',
	};
}

export function deviationMagnitude(result) {
	return (result?.deviations || []).reduce((sum, d) => sum +
		(Number.isFinite(d?.n) && d.n >= 0 ? d.n : 1), 0);
}

function compactDeviation(d) {
	const out = { ...d };
	if (Array.isArray(out.examples)) out.examples = out.examples.slice(0, 8);
	return out;
}

export function actionableQueue(live) {
	const rows = [live?.tier1, ...(live?.tier2 || [])].filter(r => r && r.conform !== true);
	return rows.map((r, index) => ({
		priority: severityOrder.get(r.token) ?? 6,
		token: r.token,
		magnitude: deviationMagnitude(r),
		deviations: (r.deviations || []).map(compactDeviation),
		detail: r.detail || {},
		order: index,
	})).sort((a, b) => a.priority - b.priority || a.order - b.order)
		.map(({ order, ...row }) => row);
}

function oneLine(d) {
	const fields = [];
	for (const key of ['kind', 'a', 'b', 'designator', 'ref', 'footprintUuid', 'pin', 'net', 'side', 'gap', 'minGap', 'dist'])
		if (d?.[key] !== undefined && d[key] !== '') fields.push(`${key}=${d[key]}`);
	for (const key of ['designatorSides','valueSides']) if(Array.isArray(d?.[key])) fields.push(`${key}=${d[key].join('|')}`);
	if (Array.isArray(d?.segment)) fields.push(`segment=${d.segment.join(',')}`);
	if (Array.isArray(d?.at)) fields.push(`at=${d.at.join(',')}`);
	if (Array.isArray(d?.examples) && d.examples.length) fields.push(`examples=${d.examples.join(' ; ')}`);
	return fields.join(' ');
}

export function formatActionableQueue(live, { perToken = 8 } = {}) {
	const queue = actionableQueue(live);
	if (!queue.length) return ['修复队列: 0'];
	const lines = [`修复队列: ${queue.length} 类 / ${queue.reduce((n, q) => n + q.magnitude, 0)} 项`];
	for (const q of queue) {
		lines.push(` P${q.priority} ${q.token}: ${q.magnitude}`);
		for (const d of q.deviations.slice(0, perToken)) lines.push(`   ${oneLine(d) || JSON.stringify(d)}`);
	}
	return lines;
}

export function buildWorkflowContext({ document, sourceAudit, live, artifacts = {} }) {
	const queue = actionableQueue(live);
	const nextBatch = selectNextBatch(queue);
	const drcRows = live?.drc?.diagnosticRows || [];
	const currentDrcRows = drcRows.filter(row => row.scope === 'current-page' || row.scope === 'mixed-pages');
	const drcNeedsObjects = queue.some(q => q.token === 'T-DRC' &&
		q.deviations.every(d => !d.id && !d.pin && !d.designator && !d.at && !d.segment)) && !drcRows.length;
	return {
		schema: 'easyeda-harness-context/v2',
		schemaVersion: 2,
		capturedAt: live?.capturedAt || new Date().toISOString(),
		document,
		state: {
			sourcePass: sourceAudit?.sourcePass === true,
			drc: live?.drc ? { error: live.drc.error, warning: live.drc.warn, info: live.drc.info,
				verified: live.drc.evidence?.verified === true } : null,
			tokenCoverage: live?.coverage || null,
			deviationCount: live?.deviationCount ?? null,
			commercialConform: live?.conform === true,
		},
		drcFindings: {
			rawRows: drcRows,
			currentPageRows: currentDrcRows,
			otherPageRows: drcRows.filter(row => row.scope === 'other-page'),
			unknownRows: drcRows.filter(row => row.scope === 'unknown'),
		},
		actionQueue: queue,
		deviationVector: deviationVector(queue),
		nextBatch,
		decisionQueue: currentDrcRows.map(row => ({
			kind: 'native-drc', severity: row.severity, message: row.message,
			targets: row.currentDesignatorPins?.length ? row.currentDesignatorPins : row.currentRefs,
		})),
		evidenceGaps: drcNeedsObjects ? [{ kind:'drc-object-attribution', action:'collect native DRC rows before attempting a DRC repair' }] : [],
		regionEvidence: live?.regionEvidence || null,
		artifacts,
			deterministicResponsibilities: [
			'source identity and persistence', 'authoritative netlist connectivity',
			'orthogonal wires and different-net contact', 'wire/object and visible-text intersections',
			'component, annotation and flag bounding-box overlap', 'label anchors, columns and endpoint attachment',
			'module/cell/body spacing and title-block keepout', 'connector mounting-pin grounding',
			'connector pin semantics, live bound-footprint source and profile coverage', 'differential-pair endpoints and constraints', 'passive adjacency and annotation completeness', 'fresh native DRC and token coverage',
		],
		decisionBoundary: 'Use AI judgment only for circuit intent, part selection and choosing among candidates that satisfy deterministic constraints.',
		repairContract: {
			order: 'Resolve lower priority numbers first; batch all findings in one functional cell.',
			candidateRule: 'Prevalidate against complete geometry and authoritative connectivity before a live write.',
			acceptanceRule: 'A repair batch is accepted only when persisted readback strictly reduces the deviation vector and introduces no new higher-priority finding.',
		},
		turnContract: {
			start: 'Read this context file before proposing or executing a change.',
			progress: 'Only a persisted batch with a better deviation vector counts as progress.',
			visual: 'Use coordinate and connectivity gates during convergence; capture one fresh canvas only after deterministic gates pass.',
		},
	};
}
