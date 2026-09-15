import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFootprintSource, auditPassiveFootprints, passiveKind } from './passive_footprint_audit.mjs';

const rec = (type, id, atom) => `${JSON.stringify({ type, id })}||${JSON.stringify(atom)}|`;
const pad = (num, x) => rec('PAD', `p${num}`, { layerId: 1, num: String(num), centerX: x, centerY: 0,
	defaultPad: { padType: 'RECT', width: 31.5, height: 35.4 }, hole: null, padAngle: 0 });
const source = silk => [pad(1, -28), pad(2, 28), ...silk].join('\n');
const centralSilk = [rec('POLY', 's1', { layerId: 3, width: 5, path: [-6, 13, 'L', 6, 13] })];
const outerSilk = [
	rec('POLY', 's1', { layerId: 3, width: 6, path: [17, -26, 'L', 55, -26] }),
	rec('POLY', 's2', { layerId: 3, width: 6, path: [55, -26, 'L', 55, 26] }),
];

test('footprint title is irrelevant: actual outer top silk fails', () => {
	const r = analyzeFootprintSource(source(outerSilk));
	assert.equal(r.conform, false);
	assert.ok(r.deviations.some(d => d.kind === 'outer-top-silkscreen'));
});

test('two small SMD pads with only a central top-silk mark pass', () => {
	const r = analyzeFootprintSource(source(centralSilk));
	assert.equal(r.conform, true);
	assert.equal(r.detail.pads, 2);
});

test('missing source and oversize copper fail closed', () => {
	assert.equal(analyzeFootprintSource('').conform, false);
	const huge = [
		rec('PAD', 'p1', { layerId: 1, num: '1', centerX: -80, centerY: 0, defaultPad: { width: 70, height: 70 }, hole: null }),
		rec('PAD', 'p2', { layerId: 1, num: '2', centerX: 80, centerY: 0, defaultPad: { width: 70, height: 70 }, hole: null }),
	].join('\n');
	assert.ok(analyzeFootprintSource(huge).deviations.some(d => d.kind === 'copper-envelope-too-large'));
});

test('every placed passive gets its own row even when the footprint is shared', () => {
	const components = ['R1', 'R2', 'C1'].map(designator => ({ designator, value: '1', attrs: [{ key: 'Footprint', value: 'fp' }] }));
	const electricalByRef = Object.fromEntries(components.map(c => [c.designator, { status: 'PASS', note: 'verified' }]));
	const r = auditPassiveFootprints(components, { sourcesByFootprint: { fp: source(centralSilk) }, electricalByRef });
	assert.equal(r.rows.length, 3);
	assert.equal(r.conform, true);
	assert.deepEqual(r.rows.map(x => x.ref), ['R1', 'R2', 'C1']);
});

test('per-item electrical evidence is mandatory and REVIEW does not become PASS', () => {
	const components = [{ designator: 'C1', attrs: [{ key: 'Footprint', value: 'fp' }] }];
	const missing = auditPassiveFootprints(components, { sourcesByFootprint: { fp: source(centralSilk) } });
	assert.equal(missing.footprintConform, true);
	assert.equal(missing.electricalConform, false);
	const review = auditPassiveFootprints(components, { sourcesByFootprint: { fp: source(centralSilk) }, electricalByRef: { C1: { status: 'REVIEW' } } });
	assert.equal(review.conform, false);
});

test('passive classification stays generic', () => {
	assert.equal(passiveKind({ designator: 'R27' }), 'resistor');
	assert.equal(passiveKind({ designator: 'C12' }), 'capacitor');
	assert.equal(passiveKind({ designator: 'U1' }), null);
});
