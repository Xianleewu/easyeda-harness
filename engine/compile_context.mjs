import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAndVerifyWorkflowReceipt } from './workflow_receipt.mjs';

const readUtf8 = file => readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const readJson = (file, label) => {
	try { return JSON.parse(readUtf8(file)); }
	catch (error) { throw new Error(`Cannot read ${label}: ${error.message}`); }
};

// The context emitted by wf lint/check is the manifest for one coherent live
// capture. Compile must follow that manifest instead of guessing a fixed report
// filename, otherwise a newer lint can be paired with an older check.
export function loadCompileContext({ artifactDir, repo }) {
	const contextPath = path.join(artifactDir, 'workflow-context.json');
	const receiptPath = path.join(artifactDir, 'workflow-preflight-receipt.json');
	const contextText = readUtf8(contextPath), context = JSON.parse(contextText);
	const sourcePath = String(context?.artifacts?.source || '').trim();
	const reportPath = String(context?.artifacts?.report || '').trim();
	const pinOwnersPath = String(context?.artifacts?.pinOwners || '').trim();
	const boundEvidencePath = String(context?.artifacts?.tokenEvidence || '').trim();
	const documentUuid = String(context?.document?.uuid || '').trim();
	if (![sourcePath, reportPath, pinOwnersPath, boundEvidencePath, documentUuid].every(Boolean))
		throw new Error('Workflow context is incomplete; rerun wf lint');
	const source = readUtf8(sourcePath);
	loadAndVerifyWorkflowReceipt({ receiptPath, contextPath, tokenEvidencePath:boundEvidencePath,
		repo, documentUuid, source });
	const report = readJson(reportPath, 'workflow report');
	if (String(report?.document?.uuid || '') !== documentUuid)
		throw new Error('Workflow report belongs to a different document');
	const baselineReport = report.live || report.afterGate;
	if (!baselineReport?.geometryArtifact || !baselineReport?.netlistArtifact)
		throw new Error('Workflow report lacks live geometry/netlist evidence');
	const componentTypes = report.componentTypes;
	if (!componentTypes || typeof componentTypes !== 'object' || Array.isArray(componentTypes))
		throw new Error('Workflow report lacks component type evidence');
	const pinOwners = readJson(pinOwnersPath, 'pin-owner evidence');
	return { source, baselineReport, componentTypes, pinOwners, context, boundEvidencePath,
		paths:{ contextPath, receiptPath, sourcePath, reportPath, pinOwnersPath } };
}
