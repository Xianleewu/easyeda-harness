import test from 'node:test';
import assert from 'node:assert/strict';
import { activateTabAndPoll, materializeEmptyPcbSource, verifyPcbImport } from './pcb_sync_transaction.mjs';

test('PCB import verification requires a nonempty footprint and pad coverage for every symbol pin', () => {
	const expected = [{ ref:'J1', footprint:{uuid:'f1',name:'EDGE'}, pins:['1','2'], nets:{1:'GND',2:'SIG'} }];
	const empty = verifyPcbImport(expected,[{ref:'J1',footprint:{uuid:'f1',name:'EDGE'},pads:[]}]);
	assert.equal(empty.pass,false);
	assert.ok(empty.deviations.some(x=>x.kind==='pcb-footprint-empty'));
	assert.ok(empty.deviations.some(x=>x.kind==='pcb-pad-missing-for-symbol-pin'&&x.pin==='1'));
	const wrong=verifyPcbImport(expected,[{ref:'J1',footprint:{uuid:'f1',name:'EDGE'},pads:[{number:'1',net:'GND'},{number:'2',net:'OTHER'}]}]);
	assert.ok(wrong.deviations.some(x=>x.kind==='pcb-pad-net-mismatch'&&x.pin==='2'));
	assert.equal(verifyPcbImport(expected,[{ref:'J1',footprint:{uuid:'f1',name:'EDGE'},pads:[{number:'1',net:'GND'},{number:'2',net:'SIG'},{number:'3',net:''}]}]).pass,true);
});

test('empty PCB materialization emits catalog-bound components and authoritative pad nets',()=>{
	const source='{"type":"DOCHEAD"}||{"docType":"PCB"}|\n{"type":"CANVAS","ticket":1,"id":"CANVAS"}||{}|\n';
	const out=materializeEmptyPcbSource(source,[{ref:'J1',name:'EDGE',uniqueId:'u1',footprintOverride:{uuid:'fp',deviceUuid:'dev'},nets:{1:'N',2:''}}]);
	assert.match(out,/"type":"COMPONENT"/);
	assert.match(out,/"key":"Footprint","value":"fp"/);
	assert.match(out,/"key":"Device","value":"dev"/);
	assert.match(out,/"padNet":"N"/);
	assert.doesNotMatch(out,/"padNet":""/);
});

test('PCB activation opens the document after a cold application restart', async()=>{
	const calls=[];
	const execute=async code=>{
		calls.push(code);
		if(code.includes('activateDocument'))return {result:false};
		if(code.includes('openDocument'))return {result:'pcb@project'};
		return {result:{uuid:'pcb',documentType:3}};
	};
	const doc=await activateTabAndPoll('pcb@project','pcb',3,{execute,wait:async()=>{},timeoutMs:100});
	assert.equal(doc.uuid,'pcb');
	assert.ok(calls.some(code=>code.includes('openDocument("pcb")')));
});
