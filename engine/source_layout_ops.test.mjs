import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSourceCells, placeSourceAttributes, reanchorSourceWireEndpoint, branchSourceWireLabel, replaceSingleSegmentSourceWire, findSourceLineSegment, mergeSourcePlans } from './source_layout_ops.mjs';

const R=(type,id,atom)=>({head:{type,id},atom});
const records=[
  R('COMPONENT','part',{x:10,y:-20,rotation:90}),
  R('ATTR','name',{parentId:'part',key:'Name',x:5,y:-10,value:'part'}),
  R('WIRE','wire',{}),
  R('LINE','line',{lineGroup:'wire',startX:0,startY:-5,endX:20,endY:-5}),
  R('ATTR','net',{parentId:'wire',key:'NET',x:0,y:-5,value:'N'}),
];

test('translateSourceCells rigidly moves roots and descendants in visual coordinates',()=>{
  const p=translateSourceCells(records,[{id:'power',roots:['part','wire'],dx:15,dy:30}]);
  assert.deepEqual(p.edit.get('part'),{x:25,y:-50,rotation:90});
  assert.deepEqual(p.edit.get('name'),{parentId:'part',key:'Name',x:20,y:-40,value:'part'});
  assert.deepEqual(p.edit.get('line'),{lineGroup:'wire',startX:15,startY:-35,endX:35,endY:-35});
  assert.deepEqual(p.edit.get('net'),{parentId:'wire',key:'NET',x:15,y:-35,value:'N'});
});

test('translateSourceCells rejects off-grid, missing and multiply owned roots',()=>{
  assert.throws(()=>translateSourceCells(records,[{id:'a',roots:['part'],dx:1,dy:0}]),/off the 5-unit grid/);
  assert.throws(()=>translateSourceCells(records,[{id:'a',roots:['missing'],dx:5,dy:0}]),/Unknown source root/);
  assert.throws(()=>translateSourceCells(records,[{id:'a',roots:['part'],dx:5,dy:0},{id:'b',roots:['part'],dx:10,dy:0}]),/belongs to both/);
});

test('mergeSourcePlans rejects ambiguous edit/drop combinations',()=>{
  assert.throws(()=>mergeSourcePlans({edit:new Map([['x',{}]])},{drop:new Set(['x'])}),/both edits and drops/);
  assert.deepEqual(mergeSourcePlans({edit:new Map([['x',{x:1}]])},{roots:['r']}).roots,['r']);
});

test('placeSourceAttributes uses absolute visual coordinates after a cell translation',()=>{
	const visible=records.map(r=>r.head.id==='name'?{...r,atom:{...r.atom,valueVisible:true}}:r);
	const p=translateSourceCells(visible,[{id:'a',roots:['part'],dx:15,dy:30}]);
	placeSourceAttributes(visible,p.edit,[{rootId:'part',key:'Name',x:100,y:200,align:'LEFT_BOTTOM'}]);
	assert.deepEqual(p.edit.get('name'),{parentId:'part',key:'Name',x:100,y:-200,value:'part',valueVisible:true,align:'LEFT_BOTTOM'});
});

test('reanchorSourceWireEndpoint keeps the wire orthogonal and moves its visible NET label',()=>{
  const visible=records.map(r=>r.head.id==='net'?{...r,atom:{...r.atom,valueVisible:true,align:'LEFT_BOTTOM'}}:r);
  const edit=new Map();
  reanchorSourceWireEndpoint(visible,edit,{rootId:'wire',from:[0,5],to:[-10,5],align:'RIGHT_BOTTOM'});
  assert.deepEqual(edit.get('line'),{lineGroup:'wire',startX:-10,startY:-5,endX:20,endY:-5});
  assert.deepEqual(edit.get('net'),{parentId:'wire',key:'NET',x:-10,y:-5,value:'N',valueVisible:true,align:'RIGHT_BOTTOM'});
  assert.throws(()=>reanchorSourceWireEndpoint(visible,new Map(),{rootId:'wire',from:[0,5],to:[-10,10]}),/diagonal/);
});

test('branchSourceWireLabel relocates a real label to a continuous orthogonal branch',()=>{
  const visible=records.map(r=>r.head.id==='net'?{...r,atom:{...r.atom,valueVisible:true,align:'LEFT_BOTTOM'}}:r);
  const edit=new Map();
  const add=branchSourceWireLabel(visible,edit,{rootId:'wire',from:[0,5],to:[-10,20],segments:[[10,5,10,20],[10,20,-10,20]],align:'RIGHT_BOTTOM'});
  assert.equal(add.length,2);assert.equal(add[1].atom.endX,-10);assert.equal(add[1].atom.endY,-20);
  assert.deepEqual(edit.get('net'),{parentId:'wire',key:'NET',x:-10,y:-20,value:'N',valueVisible:true,align:'RIGHT_BOTTOM'});
  assert.throws(()=>branchSourceWireLabel(visible,new Map(),{rootId:'wire',from:[0,5],to:[0,20],segments:[[50,5,50,20]]}),/start on/);
});

test('single-segment source wire replacement and exact segment lookup fail closed',()=>{
  const edit=new Map();replaceSingleSegmentSourceWire(records,edit,{rootId:'wire',line:[1,2,1,12]});
  assert.equal(edit.get('line').startX,1);assert.equal(edit.get('line').endY,-12);
  assert.equal(findSourceLineSegment(records,{rootId:'wire',line:[0,5,20,5]}),'line');
  assert.throws(()=>findSourceLineSegment(records,{rootId:'wire',line:[0,0,1,0]}),/0 matches/);
});
