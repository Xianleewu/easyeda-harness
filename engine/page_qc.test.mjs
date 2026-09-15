import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageQC, spatialBalanceQC } from './page_qc.mjs';
const bounds = { sheetBounds: { minX:0,minY:0,maxX:1000,maxY:700 },
	titleBlock: { minX:700,minY:0,maxX:1000,maxY:150 } };
test('page preflight blocks unknown sheet or information-block bounds', () => {
	assert.equal(pageQC({}).pass, false);
	assert.equal(pageQC({}, { sheetBounds:bounds.sheetBounds }).pass, false);
});
test('live sheet metadata disproves an inverted or undersized title-block keepout', () => {
	const model={sheetEvidence:{bbox:{minX:0,minY:0,maxX:1000,maxY:700},attrs:[
		{key:'Project',valueVisible:true,bbox:{minX:650,minY:20,maxX:730,maxY:35}},
	]}};
	const wrong=pageQC(model,{sheetBounds:{minX:0,minY:0,maxX:1000,maxY:700},titleBlock:{minX:700,minY:560,maxX:1000,maxY:700}});
	assert.ok(wrong.findings.some(f=>f.kind==='title-block-evidence-outside-keepout'));
	const right=pageQC(model,{sheetBounds:{minX:0,minY:0,maxX:1000,maxY:700},titleBlock:{minX:600,minY:0,maxX:1000,maxY:150}});
	assert.equal(right.pass,true);
});
test('blank title-block cells are unavailable to wires and parts', () => {
	const r=pageQC({ components:[{designator:'U1',bbox:{minX:800,minY:50,maxX:820,maxY:70}}],
		wires:[{net:'SIG',line:[650,80,750,80]}] },bounds);
	assert.equal(r.findings.filter(f=>f.kind==='title-block-intrusion').length,2);
});
test('off-sheet decorations fail even when the circuit is inside', () => {
	assert.equal(pageQC({rectangles:[{id:'frame',bbox:{minX:1010,minY:200,maxX:1100,maxY:300}}]},bounds).pass,false);
	assert.equal(pageQC({components:[{designator:'U1',bbox:{minX:100,minY:300,maxX:140,maxY:340}}]},bounds).pass,true);
});

test('spatialBalanceQC grids usable page and rejects a spacious off-centre module group', () => {
	const r=spatialBalanceQC([
		{name:'a',contentBox:{minX:600,minY:300,maxX:700,maxY:500}},
		{name:'b',contentBox:{minX:760,minY:300,maxX:860,maxY:500}},
	],{usable:{minX:0,minY:0,maxX:1000,maxY:800},keepout:{minX:700,minY:650,maxX:1000,maxY:800}});
	assert.equal(r.findings[0].kind,'layout-content-centroid-off-center');
	assert.deepEqual(r.findings[0].suggestedShift,[-250,-20]);
	assert.equal(r.detail.cells.length,12);
	assert.equal(r.detail.loose,true);
});

test('spatialBalanceQC accepts a spacious module group centred in the actual L-shaped usable area', () => {
	const opts={usable:{minX:0,minY:0,maxX:1000,maxY:800},keepout:{minX:700,minY:650,maxX:1000,maxY:800}};
	const [x,y]=spatialBalanceQC([],opts).detail.usableCentroid;
	const r=spatialBalanceQC([
		{name:'a',contentBox:{minX:x-110,minY:y-80,maxX:x-10,maxY:y+80}},
		{name:'b',contentBox:{minX:x+10,minY:y-80,maxX:x+110,maxY:y+80}},
	],opts);
	assert.equal(r.findings.length,0,JSON.stringify(r.findings));
});
