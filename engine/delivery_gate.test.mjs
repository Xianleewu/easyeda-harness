import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateDeliveryGate, loadDeliveryEvidence, summarizeCommitVerification } from './delivery_gate.mjs';

const result = (token, count = 0) => ({ token, conform: count === 0, deviations: Array.from({ length: count }, () => ({})) });
const report = ({ count = 0, shots = ['fresh.png'], verified = true } = {}) => ({
	conform: count === 0, deviationCount: count, coverage: { complete: true },
	tier1: {...result('T-DRC', 0),detail:{error:0,warn:0,info:0}}, tier2: [result('T-GRID', count)], shots,
	drc: { evidence: { verified } },
});

test('delivery evidence fails closed without declared module and cell geometry', () => {
	const dir = mkdtempSync(join(tmpdir(), 'delivery-evidence-'));
	const file = join(dir, 'evidence.json');
	writeFileSync(file, JSON.stringify({ moduleRegions: [], cellRegions: [] }));
	assert.throws(() => loadDeliveryEvidence(file), /nonempty moduleRegions/);
});

test('delivery evidence fails closed without sheet and title-block geometry', () => {
	const dir = mkdtempSync(join(tmpdir(), 'delivery-page-evidence-'));
	const file = join(dir, 'evidence.json');
	writeFileSync(file, JSON.stringify({ moduleRegions: [{id:'m'}], cellRegions: [{id:'c'}] }));
	assert.throws(() => loadDeliveryEvidence(file), /sheetBounds/);
});

test('normal delivery accepts only a complete all-green live report', () => {
	assert.equal(evaluateDeliveryGate(report()).accepted, true);
	assert.equal(evaluateDeliveryGate(report({ count: 1 })).pass, false);
	assert.equal(evaluateDeliveryGate(report({ shots: [] })).pass, false);
});

test('repair is a monotonic ratchet and remains unaccepted while red', () => {
	const improved = evaluateDeliveryGate(report({ count: 2, shots: [] }), { before: report({ count: 3, shots: [] }), repair: true });
	assert.equal(improved.pass, true);
	assert.equal(improved.accepted, false);
	assert.equal(evaluateDeliveryGate(report({ count: 3, shots: [] }), { before: report({ count: 3, shots: [] }), repair: true }).pass, false);
	assert.equal(evaluateDeliveryGate(report({ count: 4, shots: [] }), { before: report({ count: 3, shots: [] }), repair: true }).pass, false);
});

test('repair rejects an increased aggregate magnitude inside one deviation row', () => {
	const withCrossings=n=>({
		conform:false,deviationCount:n,coverage:{complete:true},shots:[],drc:{evidence:{verified:true}},
		tier1:{...result('T-DRC',0),detail:{error:0,warn:0,info:0}},
		tier2:[{token:'T-NOCROSS',conform:false,deviations:[{kind:'crossing',n}]}],
	});
	const gate=evaluateDeliveryGate(withCrossings(2),{before:withCrossings(1),repair:true});
	assert.equal(gate.pass,false);
	assert.ok(gate.problems.some(x=>x.includes('T-NOCROSS regressed 1 -> 2')));
});

test('repair can converge current-page DRC while a retained backup keeps raw categories red', () => {
	const red=n=>({
		conform:false,deviationCount:2,coverage:{complete:true},shots:[],
		drc:{evidence:{verified:true},currentPageMagnitude:n},
		tier1:{token:'T-DRC',conform:false,deviations:[{kind:'drc-error'},{kind:'drc-warn'}],detail:{error:1,warn:6,info:0}},
		tier2:[result('T-GRID',0)],
	});
	const improved=evaluateDeliveryGate(red(7),{before:red(12),repair:true});
	assert.equal(improved.pass,true);
	assert.equal(improved.accepted,false);
	assert.equal(improved.beforeCurrentPageDrc,12);
	assert.equal(improved.afterCurrentPageDrc,7);
	assert.equal(evaluateDeliveryGate(red(12),{before:red(12),repair:true}).pass,false);
});

test('commit verification reports the attributed current page independently of a red backup page', () => {
	const after=report();
	const gate=evaluateDeliveryGate(after);
	const status=summarizeCommitVerification({
		persistence:{pass:true},
		sourceAudit:{sourcePass:true,drc:{verified:true,pass:false,counts:{error:1,warning:4,info:0}}},
		afterReport:after,
		deliveryGate:gate,
	});
	assert.equal(status.pass,true);
	assert.equal(status.deliveryVerified,true);
	assert.equal(status.currentPageDrc.pass,true);
	assert.deepEqual(status.currentPageDrc.counts,{error:0,warning:0,info:0});
	assert.equal(status.projectDrc.pass,false);
});

test('commit verification never upgrades an unverified or red current page', () => {
	const red=report({count:1});
	const status=summarizeCommitVerification({
		persistence:{pass:true},sourceAudit:{sourcePass:true,drc:{verified:true,pass:true}},
		afterReport:red,deliveryGate:evaluateDeliveryGate(red),
	});
	assert.equal(status.pass,false);
	assert.equal(status.deliveryVerified,false);
});
