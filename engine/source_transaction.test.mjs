import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSourcePlan, readRecords, checkSourceIdentity, verifyPersistedSource, planRollbackResidueCleanup, auditRepairScope, stableSourceContent } from './source_transaction.mjs';
const line = (type, id, atom) => JSON.stringify({type, ...(id ? {id} : {})}) + '||' + JSON.stringify(atom);
const header = line('DOCHEAD', null, {docType:'SCH_PAGE',uuid:'test-document',version:1});
const source = [header,
  line('COMPONENT','part',{x:10,y:20}),
  line('ATTR','binding',{parentId:'part',key:'Footprint',value:'original-binding'}),
  line('WIRE','wire',{}),
  line('LINE','segment',{lineGroup:'wire',startX:0,startY:0,endX:10,endY:0}),
  line('ATTR','label',{parentId:'wire',key:'NET',value:'signal'})].join('|\n');

test('source plans remove wire descendants and reject edits of removed children', () => {
  const result = compileSourcePlan(source, {drop:new Set(['wire'])});
  assert.deepEqual(result.removed, ['wire','segment','label']);
  assert.equal(readRecords(result.source).length, 3);
  assert.equal(result.source.endsWith('|'), false);
  assert.throws(() => compileSourcePlan(source, {drop:new Set(['wire']),edit:new Map([['label',{}]])}), /removed/);
});
test('source plans reject missing targets, duplicate IDs, orphan additions and malformed lines', () => {
  assert.throws(() => compileSourcePlan(source, {edit:new Map([['absent',{}]])}), /Unknown/);
  assert.throws(() => compileSourcePlan(source, {add:[{head:{type:'WIRE',id:'wire'},atom:{}}]}), /new primitive/);
  assert.throws(() => compileSourcePlan(source, {add:[{head:{type:'ATTR',id:'new'},atom:{parentId:'absent'}}]}), /Orphan/);
  assert.throws(() => readRecords(source+'\ncorrupt'), /Malformed/);
  assert.throws(() => readRecords(source+'\n'+line('WIRE','wire',{})), /Duplicate/);
});
test('ordinary source plans cannot move or edit the sheet/title block', () => {
  const types={part:'sheet'};
  assert.throws(()=>compileSourcePlan(source,{edit:new Map([['part',{x:0,y:0}]])},{componentTypes:types}),/write-protected/);
  assert.throws(()=>compileSourcePlan(source,{drop:new Set(['part'])},{componentTypes:types}),/write-protected/);
  assert.doesNotThrow(()=>compileSourcePlan(source,{edit:new Map([['part',{x:0,y:0}]])},{componentTypes:types,allowSheetEdit:true}));
});
test('new attribute overrides cannot duplicate an existing or newly added parent/key', () => {
  const add = [{head:{type:'ATTR',id:'second-binding'},atom:{parentId:'part',key:'Footprint',value:'other'}}];
  assert.throws(() => compileSourcePlan(source,{add}), /Duplicate attribute/);
  assert.doesNotThrow(() => compileSourcePlan(source,{drop:new Set(['binding']),add}));
  const nc = source+'|\n'+line('ATTR','state',{parentId:'virtual-pin',key:'NO_CONNECT',value:'no'});
  const options = {pinOwners:{'virtual-pin':'part'}};
  assert.throws(() => compileSourcePlan(nc,{add:[{head:{type:'ATTR',id:'new-state'},atom:{parentId:'virtual-pin',key:'NO_CONNECT',value:'yes'}}]},options), /Duplicate attribute/);
  assert.doesNotThrow(() => compileSourcePlan(nc,{edit:new Map([['state',{parentId:'virtual-pin',key:'NO_CONNECT',value:'yes'}]])},options));
  assert.throws(() => compileSourcePlan(source,{add:[...add,{...add[0],head:{type:'ATTR',id:'third-binding'}}],drop:new Set(['binding'])}), /Duplicate attribute/);
});
test('persistent verification catches lost edits and changed footprint bindings', () => {
  const candidate = compileSourcePlan(source, {edit:new Map([['part',{x:30,y:40}]])}).source;
  assert.deepEqual(verifyPersistedSource(candidate, source, 'test-document').findings, [{id:'part',kind:'changed'}]);
  const wrong = candidate.replace('original-binding','wrong-binding');
  assert.deepEqual(verifyPersistedSource(candidate, wrong, 'test-document').findings, [{id:'binding',kind:'changed'}]);
  assert.equal(verifyPersistedSource(candidate, candidate.replace('"version":1','"version":2'), 'test-document').pass, true);
});
test('persistent verification requires intended document and all additions to survive', () => {
  assert.throws(() => checkSourceIdentity(source,'other-document'), /identity/);
  const candidate = compileSourcePlan(source, {add:[{head:{type:'TEXT',id:'annotation'},atom:{text:'Note',x:1,y:2}}]}).source;
  assert.deepEqual(verifyPersistedSource(candidate, source, 'test-document').findings, [{id:'annotation',kind:'missing'}]);
});
test('pin overrides use verified ownership and disappear with their component', () => {
  const withPin = source + '|\n' + line('ATTR','pin-state',{parentId:'virtual-pin',key:'NO_CONNECT',value:'yes'});
  const options = {pinOwners:{'virtual-pin':'part'}};
  assert.throws(() => compileSourcePlan(withPin, {}), /Orphan/);
  assert.equal(compileSourcePlan(withPin, {}, options).removed.length, 0);
  assert.deepEqual(compileSourcePlan(withPin, {drop:new Set(['part'])}, options).removed, ['part','binding','pin-state']);
});
test('one transaction can add a component and state on its virtual symbol pin', () => {
  const plan={
    add:[
      {head:{type:'COMPONENT',id:'new-part'},atom:{partId:'GENERIC.1',x:30,y:40}},
      {head:{type:'ATTR',id:'new-state'},atom:{parentId:'new-virtual-pin',key:'NO_CONNECT',value:'yes'}},
    ],
    pinOwners:{'new-virtual-pin':'new-part'},
  };
  assert.match(compileSourcePlan(source,plan).source,/new-virtual-pin/);
  assert.throws(()=>compileSourcePlan(source,{...plan,pinOwners:{'new-virtual-pin':'absent'}}),/Orphan/);
});
test('live transaction mode rejects primitive IDs the EasyEDA runtime cannot instantiate', () => {
  assert.throws(()=>compileSourcePlan(source,{add:[{head:{type:'COMPONENT',id:'not-hex'},atom:{x:1,y:2}}]},{strictPrimitiveIds:true}),/16-digit hexadecimal/);
  assert.doesNotThrow(()=>compileSourcePlan(source,{add:[{head:{type:'COMPONENT',id:'abcdef0123456789'},atom:{x:1,y:2}}]},{strictPrimitiveIds:true}));
});
test('incremental repair cannot touch records outside the declared module', () => {
  const candidate=compileSourcePlan(source,{edit:new Map([['part',{x:30,y:40}]])}).source;
  const result=auditRepairScope(source,candidate,['part']);
  assert.equal(result.outsideUnchanged,true);
  assert.equal(result.deliveryVerified,false);
  assert.equal(readRecords(result.scopedSource).length,2);
  assert.throws(()=>auditRepairScope(source,candidate,['wire']),/outside/);
  assert.equal(readRecords(auditRepairScope(source,source,['wire']).scopedSource).length,3);
});
test('write guard ignores regenerated source header fields but preserves edits and identity', () => {
  assert.equal(stableSourceContent(source),stableSourceContent(source.replace('"version":1','"version":2,"client":"read-session","updateTime":100')));
  assert.notEqual(stableSourceContent(source),stableSourceContent(source.replace('"x":10','"x":11')));
  assert.notEqual(stableSourceContent(source),stableSourceContent(source.replace('test-document','wrong-document')));
  assert.notEqual(stableSourceContent(source),stableSourceContent(source.replace('original-binding','changed-binding')));
});
test('readback tolerates measured importer defaults but rejects visible labels and binding changes', () => {
  const normalized=source.replace('"x":10','"x":10.00000000000002')+'|\n'+line('ATTR','cache',{parentId:'wire',key:'Relevance',value:'[]'});
  assert.equal(verifyPersistedSource(source,normalized,'test-document').pass,true);
  const hidden=source.replace('"key":"NET"','"valueVisible":false,"key":"NET"');
  assert.equal(verifyPersistedSource(hidden,hidden.replace('"valueVisible":false','"valueVisible":true'),'test-document').pass,false);
  assert.equal(verifyPersistedSource(source,source.replace('original-binding','replacement'),'test-document').pass,false);
});
test('readback ignores importer materialized style on hidden bindings', () => {
  const before=source.replace('"key":"Footprint","value":"original-binding"','"key":"Symbol","value":"sym","rotation":null,"fontWeight":null,"italic":null,"underline":null,"valueVisible":null,"keyVisible":null');
  const after=before.replace('"rotation":null,"fontWeight":null,"italic":null,"underline":null','"rotation":0,"fontWeight":false,"italic":false,"underline":false');
  assert.equal(verifyPersistedSource(before,after,'test-document').pass,true);
  assert.equal(verifyPersistedSource(before,after.replace('"value":"sym"','"value":"other"'),'test-document').pass,false);
});
test('readback treats absent and explicit false visibility as the same hidden binding', () => {
  const before=source.replace('"key":"Footprint"','"keyVisible":false,"valueVisible":false,"key":"Footprint"');
  const after=before.replace('"keyVisible":false,"valueVisible":false,','');
  assert.equal(verifyPersistedSource(before,after,'test-document').pass,true);
});
test('derived pin number annotation coordinates do not hide changed pin numbering', () => {
  const pin=source+'|\n'+line('ATTR','pin-text',{parentId:'virtual-pin',key:'Pin Number',value:'1',x:2,y:3});
  assert.equal(verifyPersistedSource(pin,pin.replace('"x":2,"y":3','"x":20,"y":30'),'test-document').pass,true);
  assert.equal(verifyPersistedSource(pin,pin.replace('"value":"1"','"value":"2"'),'test-document').pass,false);
});
test('readback ignores importer geometry for an empty unnamed-wire NET placeholder', () => {
  const before=source+'|\n'+line('ATTR','empty-net',{parentId:'wire',key:'NET',value:'',valueVisible:false,x:null,y:null});
  const after=source+'|\n'+line('ATTR','empty-net',{parentId:'wire',key:'NET',value:'',valueVisible:true,x:25,y:30,zIndex:9});
  assert.equal(verifyPersistedSource(before,after,'test-document').pass,true);
});

test('rollback residue cleanup accepts only hidden importer-added 3D cache attributes',()=>{
  const residue=source+'|\n'+line('ATTR','model-cache',{parentId:'part',key:'3D Model',value:'resolved-model',valueVisible:null,keyVisible:null});
  const plan=planRollbackResidueCleanup(source,residue,'test-document');
  assert.equal(plan.pass,true);assert.deepEqual([...plan.drop],['model-cache']);
  assert.equal(verifyPersistedSource(source,compileSourcePlan(residue,plan).source,'test-document').pass,true);
  const visible=residue.replace('"valueVisible":null','"valueVisible":true');
  assert.equal(planRollbackResidueCleanup(source,visible,'test-document').pass,false);
  const electrical=source+'|\n'+line('ATTR','extra-binding',{parentId:'part',key:'Device',value:'other'});
  assert.equal(planRollbackResidueCleanup(source,electrical,'test-document').pass,false);
});
