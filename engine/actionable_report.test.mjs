import test from 'node:test';
import assert from 'node:assert/strict';
import { actionableQueue, buildWorkflowContext, deviationMagnitude, formatActionableQueue, selectNextBatch } from './actionable_report.mjs';

const live = {
	tier1: { token: 'T-DRC', conform: false, deviations: [{ kind: 'drc-error', got: 1 }], detail: { error: 1 } },
	tier2: [
		{ token: 'T-DENSITY', conform: false, deviations: [{ kind: 'too-sparse' }], detail: {} },
		{ token: 'T-NOCROSS', conform: false, deviations: [{ kind: 'crossing', n: 2, examples: ['AxB@(1,2)'] }], detail: {} },
	],
	drc: { error: 1, warn: 0, info: 0, evidence: { verified: true } },
	coverage: { complete: true, expected: 2, checked: 2 }, deviationCount: 4, conform: false,
};

test('action queue preserves aggregate magnitude and prioritizes electrical geometry', () => {
	assert.equal(deviationMagnitude(live.tier2[1]), 2);
	const q = actionableQueue(live);
	assert.deepEqual(q.map(x => x.token), ['T-DRC', 'T-NOCROSS', 'T-DENSITY']);
	assert.equal(q[1].magnitude, 2);
});

test('console report includes directly actionable examples', () => {
	assert.match(formatActionableQueue(live).join('\n'), /examples=AxB@\(1,2\)/);
});

test('context pack records evidence paths and deterministic decision boundary', () => {
	const c = buildWorkflowContext({ document: { uuid: 'doc' }, sourceAudit: { sourcePass: true }, live,
		artifacts: { geometry: '/outside/complete_geometry.json' } });
	assert.equal(c.schema, 'easyeda-harness-context/v2');
	assert.equal(c.schemaVersion, 2);
	assert.equal(c.state.drc.verified, true);
	assert.equal(c.artifacts.geometry, '/outside/complete_geometry.json');
	assert.ok(c.deterministicResponsibilities.length >= 8);
	assert.match(c.repairContract.acceptanceRule, /persisted readback/);
	assert.deepEqual(c.nextBatch.tokens, ['T-NOCROSS']);
	assert.equal(c.nextBatch.targets[0].examples[0], 'AxB@(1,2)');
	assert.deepEqual(c.deviationVector, {'T-DRC':1,'T-NOCROSS':2,'T-DENSITY':1});
	assert.equal(c.evidenceGaps[0].kind, 'drc-object-attribution');
});

test('next batch never asks AI to guess deterministic geometry', () => {
	const batch=selectNextBatch(actionableQueue(live));
	assert.equal(batch.mode,'deterministic-repair');
	assert.match(batch.writePath,/wf commit/);
	assert.match(batch.recipes[0],/reroute/);
});

test('footprint root causes produce a catalog-binding recipe and retain the UUID target',()=>{
	const footprintLive={...live,tier1:{token:'T-DRC',conform:true,deviations:[],detail:{error:0}},tier2:[{
		token:'T-PIN-SEMANTICS',conform:false,deviations:[{kind:'connector-footprint-live-source-unverified',designator:'J3',footprintUuid:'fp3'}],detail:{},
	}]};
	const batch=selectNextBatch(actionableQueue(footprintLive));
	assert.deepEqual(batch.recipes,['replace-bound-footprint-from-verified-catalog-device']);
	assert.equal(batch.targets[0].footprintUuid,'fp3');
});

test('missing live netlist produces an evidence reacquisition recipe instead of geometry guesses',()=>{
	const batch=selectNextBatch([{priority:3,token:'T-ADJACENCY',magnitude:1,deviations:[{kind:'missing-authoritative-netlist'}]}]);
	assert.deepEqual(batch.recipes,['reacquire-authoritative-netlist-before-repair']);
});
