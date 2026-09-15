import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkflowReceipt, verifyWorkflowReceipt, resolveTokenEvidencePath, REQUIRED_RULE_FILES } from './workflow_receipt.mjs';

function fixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'wf-receipt-'));
  for (const file of REQUIRED_RULE_FILES) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), `rule:${file}`);
  }
  const tokenEvidencePath = path.join(repo, 'private-evidence.json');
  writeFileSync(tokenEvidencePath, '{"moduleRegions":[]}');
  const state = { repo, documentUuid: 'doc', source: '{"type":"DOCHEAD"}||{"client":1,"uuid":"doc"}', contextText: '{"queue":[]}', tokenEvidenceText: '{"moduleRegions":[]}', tokenEvidencePath };
  return { state, receipt: createWorkflowReceipt({ ...state, createdAt: '2026-09-15T00:00:00.000Z' }) };
}

test('receipt binds document, stable source, context, token evidence and all rule files', () => {
  const { state, receipt } = fixture();
  const now = Date.parse('2026-09-15T00:10:00.000Z');
  assert.equal(verifyWorkflowReceipt(receipt, { ...state, now }).pass, true);
  assert.match(verifyWorkflowReceipt(receipt, { ...state, source: state.source + '\nchanged', now }).problems.join(';'), /source changed/);
  assert.match(verifyWorkflowReceipt(receipt, { ...state, contextText: '{}', now }).problems.join(';'), /context changed/);
  writeFileSync(path.join(state.repo, REQUIRED_RULE_FILES[0]), 'new rule');
  assert.match(verifyWorkflowReceipt(receipt, { ...state, now }).problems.join(';'), /rule changed/);
});

test('evidence path is recovered only when receipt, context and active document agree', () => {
  const { state, receipt } = fixture();
  const receiptPath = path.join(state.repo, 'receipt.json');
  const contextPath = path.join(state.repo, 'context.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(contextPath, JSON.stringify({ document: { uuid: 'doc' }, artifacts: { tokenEvidence: state.tokenEvidencePath } }));
  assert.equal(resolveTokenEvidencePath({ receiptPath, contextPath, documentUuid: 'doc' }), state.tokenEvidencePath);
  assert.throws(() => resolveTokenEvidencePath({ receiptPath, contextPath, documentUuid: 'other' }), /different document/);
  writeFileSync(contextPath, JSON.stringify({ document: { uuid: 'doc' }, artifacts: { tokenEvidence: path.join(state.repo, 'other.json') } }));
  assert.throws(() => resolveTokenEvidencePath({ receiptPath, contextPath, documentUuid: 'doc' }), /paths disagree/);
});

test('explicit evidence path is usable before any workflow receipt exists', () => {
  const relative = './evidence.json';
  assert.equal(resolveTokenEvidencePath({ explicitPath: relative }), path.resolve(relative));
});

test('receipt expires and cannot be reused across a later work turn', () => {
  const { state, receipt } = fixture();
  const now = Date.parse('2026-09-15T02:00:00.000Z');
  assert.match(verifyWorkflowReceipt(receipt, { ...state, now }).problems.join(';'), /older than 60 minutes/);
});
