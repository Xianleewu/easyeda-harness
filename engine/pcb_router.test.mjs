import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPcbRouteAngles, auditPcbRouteBends, planPcbRoutes } from './pcb_router.mjs';

test('generic PCB router emits only straight or 45-degree segments and ignores declared nets', () => {
	const snapshot = {
		board: { bbox: { minX: 0, minY: -300, maxX: 500, maxY: 0 } },
		components: [
			{ ref: 'P1', pads: [{ number: '1', net: 'SIG', x: 50, y: -50, layer: 1, bbox: { minX: 40, minY: -60, maxX: 60, maxY: -40 } }, { number: '2', net: 'REF', x: 50, y: -100, layer: 1, bbox: { minX: 40, minY: -110, maxX: 60, maxY: -90 } }] },
			{ ref: 'P2', pads: [{ number: '1', net: 'SIG', x: 450, y: -250, layer: 1, bbox: { minX: 440, minY: -260, maxX: 460, maxY: -240 } }, { number: '2', net: 'REF', x: 450, y: -200, layer: 1, bbox: { minX: 440, minY: -210, maxX: 460, maxY: -190 } }] },
		],
	};
	const plan = planPcbRoutes(snapshot, { ignoreNets: ['REF'], gridMil: 10, edgeClearanceMil: 10 });
	assert.equal(plan.failed.length, 0);
	assert.deepEqual(plan.nets.map(item => item.net), ['SIG']);
	assert.equal(auditPcbRouteAngles(plan).length, 0);
	assert.equal(auditPcbRouteBends(plan).length, 0);
});

test('bend audit rejects a right angle even when every individual segment is orthogonal', () => {
	const plan = { segments: [
		{ net: 'N', layer: 1, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
		{ net: 'N', layer: 1, a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
	] };
	assert.equal(auditPcbRouteAngles(plan).length, 0);
	assert.equal(auditPcbRouteBends(plan).length, 1);
});

test('bend audit accepts a 45-degree chamfer', () => {
	const plan = { segments: [
		{ net: 'N', layer: 1, a: { x: 0, y: 0 }, b: { x: 80, y: 0 } },
		{ net: 'N', layer: 1, a: { x: 80, y: 0 }, b: { x: 100, y: 20 } },
		{ net: 'N', layer: 1, a: { x: 100, y: 20 }, b: { x: 100, y: 100 } },
	] };
	assert.equal(auditPcbRouteBends(plan).length, 0);
});
