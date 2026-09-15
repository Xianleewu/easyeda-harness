import { readFileSync } from 'node:fs';

function asObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	return value;
}

// Circuit-specific declarations are runtime evidence. They are supplied by the
// caller and never compiled into this public, circuit-agnostic repository.
export function loadDeliveryEvidence(file) {
	if (!file) throw new Error('EASYEDA_TOKEN_EVIDENCE is required for a live source transaction');
	let evidence;
	try { evidence = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
	catch (error) { throw new Error(`Cannot read token evidence: ${error.message}`); }
	asObject(evidence, 'Token evidence');
	for (const key of ['moduleRegions', 'cellRegions']) {
		if (!Array.isArray(evidence[key]) || evidence[key].length === 0)
			throw new Error(`Token evidence needs nonempty ${key}`);
	}
	for (const key of ['sheetBounds', 'titleBlockKeepout']) asObject(evidence[key], `Token evidence ${key}`);
	for (const profile of evidence.connectorFootprintProfiles || []) {
		if (!String(profile?.sourceFile || '').trim()) continue;
		try { profile.sourceText = readFileSync(profile.sourceFile, 'utf8').replace(/^\uFEFF/, ''); }
		catch (error) { throw new Error(`Cannot read connector footprint evidence for ${profile?.ref || '?'}: ${error.message}`); }
	}
	return evidence;
}

function deviationsByToken(report) {
	return new Map([report?.tier1, ...(report?.tier2 || [])]
		.filter(Boolean).map(result => {
			/* Several geometry tokens aggregate identical findings as one
			 * deviation object with an `n` magnitude.  Counting array entries
			 * alone lets crossing 1 -> 2 slip through the repair ratchet. */
			const deviations = Array.isArray(result.deviations) ? result.deviations : [];
			const magnitude = deviations.reduce((sum, d) => sum +
				(Number.isFinite(d?.n) && d.n >= 0 ? d.n : 1), 0);
			return [result.token, deviations.length ? magnitude : (result.conform ? 0 : 1)];
		}));
}

function evidenceProblems(report, { requireCanvas = true } = {}) {
	const problems = [];
	if (report?.coverage?.complete !== true) problems.push('token coverage is incomplete');
	if (report?.drc?.evidence?.verified !== true) problems.push('native DRC evidence is not fresh and verified');
	if (requireCanvas && (!Array.isArray(report?.shots) || report.shots.length === 0)) problems.push('fresh canvas evidence is missing');
	if (!report?.tier1 || !Array.isArray(report?.tier2)) problems.push('token report is incomplete');
	return problems;
}

// Normal commits need an all-green report. A repair may start from an already
// red page, but it cannot create or enlarge any token deviation and must make
// strict measurable progress. This lets the workflow converge without calling
// an intermediate red page commercially accepted.
export function evaluateDeliveryGate(after, { before = null, repair = false } = {}) {
	// Repair batches are governed entirely by deterministic source/netlist/bbox,
	// token and DRC evidence. Canvas capture is reserved for final acceptance.
	const problems = evidenceProblems(after, { requireCanvas: !repair });
	if (problems.length) return { pass: false, accepted: false, problems };
	if (!repair) {
		if (after.conform !== true) problems.push(`commercial token gate has ${after.deviationCount ?? '?'} deviations`);
		return { pass: problems.length === 0, accepted: problems.length === 0, problems };
	}
	const beforeProblems = evidenceProblems(before, { requireCanvas: false });
	if (beforeProblems.length) return { pass: false, accepted: false, problems: beforeProblems.map(x => `baseline ${x}`) };
	const oldCounts = deviationsByToken(before), newCounts = deviationsByToken(after);
	for (const [token, oldCount] of oldCounts) {
		const newCount = newCounts.get(token);
		if (newCount == null) problems.push(`${token} disappeared from the post-write report`);
		else if (newCount > oldCount) problems.push(`${token} regressed ${oldCount} -> ${newCount}`);
	}
	for (const key of ['error', 'warn', 'info']) {
		const oldValue = before?.tier1?.detail?.[key], newValue = after?.tier1?.detail?.[key];
		if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) problems.push(`DRC ${key} count is unavailable`);
		else if (newValue > oldValue) problems.push(`DRC ${key} regressed ${oldValue} -> ${newValue}`);
	}
	const oldTotal = Number(before?.deviationCount), newTotal = Number(after?.deviationCount);
	if (!Number.isFinite(oldTotal) || !Number.isFinite(newTotal)) problems.push('deviation totals are unavailable');
	else if (after.conform !== true && newTotal >= oldTotal) {
		const oldCurrentDrc=before?.drc?.currentPageMagnitude,newCurrentDrc=after?.drc?.currentPageMagnitude;
		if (!Number.isFinite(oldCurrentDrc) || !Number.isFinite(newCurrentDrc) || newCurrentDrc >= oldCurrentDrc)
			problems.push(`repair made no strict progress (${oldTotal} -> ${newTotal})`);
	}
	return { pass: problems.length === 0, accepted: problems.length === 0 && after.conform === true,
		problems, beforeDeviationCount: oldTotal, afterDeviationCount: newTotal,
		beforeCurrentPageDrc:before?.drc?.currentPageMagnitude,afterCurrentPageDrc:after?.drc?.currentPageMagnitude };
}

// A native EasyEDA DRC invocation returns project-wide totals.  A retained
// backup page can therefore keep those totals red even when every diagnostic
// has been attributed away from the active page.  Commit status must follow
// the same scoped report that the delivery gate actually judged, while still
// preserving the project-wide result as separate evidence.
export function summarizeCommitVerification({
	persistence,
	sourceAudit,
	afterReport,
	deliveryGate,
	repair = false,
	stagePost = null,
} = {}) {
	const counts = {
		error: afterReport?.tier1?.detail?.error,
		warning: afterReport?.tier1?.detail?.warn,
		info: afterReport?.tier1?.detail?.info,
	};
	const currentPageDrc = {
		verified: afterReport?.drc?.evidence?.verified === true,
		pass: afterReport?.tier1?.conform === true,
		counts,
		source: 'attributed-current-page',
	};
	const stagePass = !repair || (Array.isArray(stagePost?.findings) && stagePost.findings.length === 0);
	const pass = persistence?.pass === true && sourceAudit?.sourcePass === true && stagePass &&
		currentPageDrc.verified && deliveryGate?.pass === true;
	return {
		pass,
		sourcePass: sourceAudit?.sourcePass === true,
		deliveryVerified: pass && deliveryGate?.accepted === true,
		currentPageDrc,
		projectDrc: sourceAudit?.drc ?? null,
	};
}
