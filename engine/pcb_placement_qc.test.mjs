import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFromOutlineSource, judgePcbPlacement, rectangleUnionArea } from './pcb_placement_qc.mjs';

const component = (ref, x, y, box, extra = {}) => ({ id: `id-${ref}`, ref, x, y, rotation: 0, layer: 1, bbox: box, ...extra });
const base = () => ({
	board: { ...boardFromOutlineSource(['R', 0, 0, 600, 400, 0, 39.3701]) },
	components: [
		component('P1', 100, -100, { minX: 70, minY: -120, maxX: 130, maxY: -80 }),
		component('P2', 180, -100, { minX: 150, minY: -120, maxX: 210, maxY: -80 }),
		component('U1', 400, -200, { minX: 350, minY: -250, maxX: 450, maxY: -150 }),
	],
	designators: [
		{ ref: 'P1', parent: 'id-P1', rotation: 0, bbox: { minX: 80, minY: -65, maxX: 110, maxY: -45 } },
		{ ref: 'P2', parent: 'id-P2', rotation: 0, bbox: { minX: 160, minY: -65, maxX: 190, maxY: -45 } },
		{ ref: 'U1', parent: 'id-U1', rotation: 0, bbox: { minX: 385, minY: -140, maxX: 415, maxY: -120 } },
	],
	drc: { findings: [{ errorType: 'Connection Error', errorObjType: 'SMD Pad' }] },
});
const policy = () => ({
	stage: 'placement',
	density: { minComponentUtilization: 0.05 },
	maxOuterMarginMil: 160,
	modules: [
		{ id: 'interface', box: { minX: 40, minY: -140, maxX: 240, maxY: -40 } },
		{ id: 'control', box: { minX: 320, minY: -280, maxX: 480, maxY: -110 } },
	],
	cells: [
		{ id: 'entry', module: 'interface', members: ['P1', 'P2'], box: { minX: 50, minY: -130, maxX: 230, maxY: -70 } },
		{ id: 'logic', module: 'control', members: ['U1'], box: { minX: 340, minY: -260, maxX: 460, maxY: -140 } },
	],
	passiveArrays: [{ id: 'paired-support', members: ['P1', 'P2'], axis: 'x' }],
	alignGroups: [{ id: 'support-row', members: ['P1', 'P2'], axis: 'y' }],
	visualReview: { status: 'pass', artifact: 'synthetic.png' },
});

test('density is explicit and measured from rectangle union area', () => {
	assert.equal(rectangleUnionArea([
		{ minX: 0, minY: 0, maxX: 10, maxY: 10 },
		{ minX: 5, minY: 0, maxX: 15, maxY: 10 },
	]), 150);
	const missing = policy(); delete missing.density;
	let report = judgePcbPlacement(base(), missing);
	assert.ok(report.results.find(result => result.id === 'PCB-DENSITY').deviations.some(item => item.kind === 'missing-density-declaration'));
	const strict = policy(); strict.density.minComponentUtilization = 0.07;
	report = judgePcbPlacement(base(), strict);
	assert.ok(report.results.find(result => result.id === 'PCB-DENSITY').deviations.some(item => item.kind === 'component-utilization'));
});

test('rectangle outline preserves rotation and round in the documented field order', () => {
	const board = boardFromOutlineSource(['R', 10, 20, 600, 400, 0, 39.3701]);
	assert.deepEqual(board.bbox, { minX: 10, minY: -380, maxX: 610, maxY: 20 });
	assert.equal(board.rotation, 0);
	assert.equal(board.cornerRadiusMil, 39.3701);
});

test('commercial placement passes complete geometry, policy and placement-stage DRC', () => {
	const report = judgePcbPlacement(base(), policy());
	assert.equal(report.deterministicPass, true, JSON.stringify(report.results));
	assert.equal(report.pass, true);
});

test('0.5 mm clearance applies only to a declared aligned same-cell passive array', () => {
	const snapshot = base();
	snapshot.components[1].bbox = { minX: 145, minY: -120, maxX: 205, maxY: -80 }; // 15 mil gap
	let report = judgePcbPlacement(snapshot, policy());
	assert.ok(report.results.find(result => result.id === 'PCB-PLACEMENT').deviations.some(item => item.kind === 'component-clearance'));
	snapshot.components[1].bbox = { minX: 150, minY: -120, maxX: 210, maxY: -80 }; // 20 mil > 0.5 mm
	report = judgePcbPlacement(snapshot, policy());
	assert.equal(report.results.find(result => result.id === 'PCB-PLACEMENT').pass, true);
	const withoutException = policy(); withoutException.passiveArrays = [];
	report = judgePcbPlacement(snapshot, withoutException);
	assert.ok(report.results.find(result => result.id === 'PCB-PLACEMENT').deviations.some(item => item.kind === 'component-clearance'));
});

test('passive array relaxation fails when rotations or functional cells differ', () => {
	const snapshot = base(); snapshot.components[1].rotation = 90;
	let report = judgePcbPlacement(snapshot, policy());
	assert.ok(report.results.find(result => result.id === 'PCB-PLACEMENT').deviations.some(item => item.kind === 'passive-array-rotation'));
	const split = policy(); split.cells[0].members = ['P1']; split.cells.push({ id: 'other', module: 'interface', members: ['P2'], box: { minX: 140, minY: -130, maxX: 230, maxY: -70 } });
	report = judgePcbPlacement(base(), split);
	assert.ok(report.results.find(result => result.id === 'PCB-PLACEMENT').deviations.some(item => item.kind === 'passive-array-cell'));
});

test('repeated channel geometry compares role-relative offsets', () => {
	const snapshot = base();
	snapshot.components.push(component('P3', 100, -300, { minX: 70, minY: -320, maxX: 130, maxY: -280 }));
	snapshot.components.push(component('P4', 180, -290, { minX: 150, minY: -310, maxX: 210, maxY: -270 }));
	snapshot.designators.push({ ref: 'P3', parent: 'id-P3', rotation: 0, bbox: { minX: 80, minY: -265, maxX: 110, maxY: -245 } });
	snapshot.designators.push({ ref: 'P4', parent: 'id-P4', rotation: 0, bbox: { minX: 160, minY: -255, maxX: 190, maxY: -235 } });
	const p = policy(); p.modules[0].box.minY = -340; p.cells[0].box.minY = -330; p.cells[0].members.push('P3', 'P4');
	p.repeatedGroups = [{ id: 'paired-channels', anchorRole: 'input', instances: [{ input: 'P1', output: 'P2' }, { input: 'P3', output: 'P4' }] }];
	const report = judgePcbPlacement(snapshot, p);
	assert.ok(report.results.find(result => result.id === 'PCB-ALIGNMENT').deviations.some(item => item.kind === 'repeated-geometry'));
});

test('routed stage does not waive connection findings and visual review remains separate', () => {
	const p = policy(); p.stage = 'routed'; delete p.visualReview;
	const report = judgePcbPlacement(base(), p);
	assert.equal(report.deterministicPass, false);
	assert.equal(report.pass, false);
	assert.equal(report.visualReview.status, 'required');
});

test('policy references fail closed when a passive-array member is absent', () => {
	const p = policy();
	p.passiveArrays[0].members.push('P9');
	const report = judgePcbPlacement(base(), p);
	assert.ok(report.results.find(result => result.id === 'PCB-COVERAGE').deviations.some(item => item.kind === 'unknown-passive-array-member'));
});
