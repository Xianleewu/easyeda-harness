import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stableSourceContent } from './source_transaction.mjs';

export const REQUIRED_RULE_FILES = Object.freeze([
  'AGENTS.md',
  'commercialization_workflow.md',
  'docs/workflow-review-2026-09-15.md',
  'docs/collab-queue.md',
  'docs/schematic-design-rules.md',
  'docs/schematic_design_rulebook.md',
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');
const readUtf8 = file => readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

export function ruleHashes(repo, files = REQUIRED_RULE_FILES) {
  return Object.fromEntries(files.map(file => [file, sha256(readUtf8(path.join(repo, file)))]));
}

export function createWorkflowReceipt({ repo, documentUuid, source, contextText, tokenEvidenceText, tokenEvidencePath, createdAt = new Date().toISOString() }) {
  if (!documentUuid || typeof source !== 'string' || !source.trim()) throw new Error('Receipt needs a document UUID and source');
  if (typeof contextText !== 'string' || !contextText.trim()) throw new Error('Receipt needs the emitted workflow context');
  if (typeof tokenEvidenceText !== 'string' || !tokenEvidenceText.trim()) throw new Error('Receipt needs token evidence');
  if (!String(tokenEvidencePath || '').trim()) throw new Error('Receipt needs the token evidence path');
  return {
    schema: 2,
    createdAt,
    documentUuid,
    tokenEvidencePath: path.resolve(tokenEvidencePath),
    sourceSha256: sha256(stableSourceContent(source)),
    contextSha256: sha256(contextText),
    tokenEvidenceSha256: sha256(tokenEvidenceText),
    ruleSha256: ruleHashes(repo),
  };
}

export function verifyWorkflowReceipt(receipt, { repo, documentUuid, source, contextText, tokenEvidenceText, now = Date.now(), maxAgeMs = 60 * 60 * 1000 }) {
  const problems = [];
  if (!receipt || receipt.schema !== 2) problems.push('missing or unsupported receipt');
  if (receipt?.documentUuid !== documentUuid) problems.push('document UUID changed since wf check');
  if (receipt?.sourceSha256 !== sha256(stableSourceContent(source || ''))) problems.push('source changed since wf check');
  if (receipt?.contextSha256 !== sha256(contextText || '')) problems.push('workflow context changed since wf check');
  if (receipt?.tokenEvidenceSha256 !== sha256(tokenEvidenceText || '')) problems.push('token evidence changed since wf check');
  const currentRules = ruleHashes(repo);
  for (const [file, hash] of Object.entries(currentRules)) {
    if (receipt?.ruleSha256?.[file] !== hash) problems.push(`rule changed since wf check: ${file}`);
  }
  const created = Date.parse(receipt?.createdAt || '');
  if (!Number.isFinite(created)) problems.push('receipt timestamp is invalid');
  else if (now - created > maxAgeMs) problems.push('wf check receipt is older than 60 minutes');
  else if (created - now > 60_000) problems.push('receipt timestamp is in the future');
  return { pass: problems.length === 0, problems };
}

// The evidence file is circuit-specific and therefore remains outside this
// public repository.  Once a successful lint binds it to the active document,
// later workflow commands may recover the path from the external receipt and
// context.  The content is still re-read and re-hashed on every command.
export function resolveTokenEvidencePath({ explicitPath = '', receiptPath = '', contextPath = '', documentUuid = '' } = {}) {
  if (String(explicitPath).trim()) return path.resolve(explicitPath);
  if (!receiptPath || !contextPath)
    throw new Error('EASYEDA_TOKEN_EVIDENCE is required until wf lint records evidence for this document');
  let receipt, context;
  try {
    receipt = JSON.parse(readUtf8(receiptPath));
    context = JSON.parse(readUtf8(contextPath));
  } catch (error) {
    throw new Error(`Cannot recover token evidence path: ${error.message}`);
  }
  if (!documentUuid || receipt?.documentUuid !== documentUuid || context?.document?.uuid !== documentUuid)
    throw new Error('Recorded token evidence belongs to a different document; set EASYEDA_TOKEN_EVIDENCE explicitly');
  const fromReceipt = String(receipt?.tokenEvidencePath || '').trim();
  const fromContext = String(context?.artifacts?.tokenEvidence || '').trim();
  if (!fromReceipt || !fromContext)
    throw new Error('Recorded workflow state predates evidence-path binding; set EASYEDA_TOKEN_EVIDENCE once and rerun wf lint');
  const receiptResolved = path.resolve(fromReceipt), contextResolved = path.resolve(fromContext);
  if (receiptResolved !== contextResolved)
    throw new Error('Recorded token evidence paths disagree; set EASYEDA_TOKEN_EVIDENCE explicitly');
  return receiptResolved;
}

export function loadAndVerifyWorkflowReceipt({ receiptPath, contextPath, tokenEvidencePath, ...state }) {
  if (!receiptPath) throw new Error('EASYEDA_PREFLIGHT_RECEIPT is required; run wf check before any write');
  if (!contextPath) throw new Error('EASYEDA_WORKFLOW_CONTEXT is required; run wf check before any write');
  if (!tokenEvidencePath) throw new Error('EASYEDA_TOKEN_EVIDENCE is required for a live source transaction');
  let receipt, contextText, tokenEvidenceText;
  try {
    receipt = JSON.parse(readUtf8(receiptPath));
    contextText = readUtf8(contextPath);
    tokenEvidenceText = readUtf8(tokenEvidencePath);
  } catch (error) {
    throw new Error(`Cannot read workflow preflight evidence: ${error.message}`);
  }
  const result = verifyWorkflowReceipt(receipt, { ...state, contextText, tokenEvidenceText });
  if (!result.pass) throw new Error(`wf check receipt is stale: ${result.problems.join('; ')}`);
  return result;
}
