import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceWireLabelsWithClonedFlags } from './source_cells.mjs';

const rec=(type,id,atom,ticket=1)=>({head:{type,id,ticket},atom});
test('replaceWireLabelsWithClonedFlags removes real NET labels, clones verified flags and joins adjacent endpoints',()=>{
  const records=[
    rec('COMPONENT','1111111111111111',{partId:'g',x:0,y:0,rotation:0,isMirror:false}),
    rec('ATTR','1111111111111112',{parentId:'1111111111111111',key:'Global Net Name',value:'GND',x:0,y:0,valueVisible:false}),
    rec('ATTR','1111111111111113',{parentId:'1111111111111111',key:'Name',value:'GND',x:0,y:0,valueVisible:false}),
    rec('WIRE','2222222222222222',{}),rec('LINE','2222222222222223',{lineGroup:'2222222222222222',startX:10,startY:-20,endX:30,endY:-20}),
    rec('ATTR','2222222222222224',{parentId:'2222222222222222',key:'NET',value:'GND',x:10,y:-20,valueVisible:true}),
    rec('WIRE','3333333333333333',{}),rec('LINE','3333333333333334',{lineGroup:'3333333333333333',startX:10,startY:-30,endX:30,endY:-30}),
    rec('ATTR','3333333333333335',{parentId:'3333333333333333',key:'NET',value:'GND',x:10,y:-30,valueVisible:true}),
  ];
  const p=replaceWireLabelsWithClonedFlags(records,{flagTemplateId:'1111111111111111',idPrefix:'aa',labels:[
    {wireRootId:'2222222222222222',net:'GND',anchor:{x:10,y:20}},
    {wireRootId:'3333333333333333',net:'GND',anchor:{x:10,y:30}},
  ],flags:[{wireRootId:'2222222222222222',net:'GND',x:10,y:20,rotation:270}],
  joinSegments:[{wireRootId:'2222222222222222',line:[10,20,10,30]}]});
  assert.deepEqual([...p.drop].sort(),['2222222222222224','3333333333333335']);
  assert.equal(Object.values(p.componentTypes)[0],'netflag');
  assert.ok(p.add.some(r=>r.head.type==='LINE'&&r.atom.startY===-20&&r.atom.endY===-30));
  assert.ok(p.add.some(r=>r.head.type==='ATTR'&&r.atom.key==='Global Net Name'&&r.atom.value==='GND'));
});

test('replaceWireLabelsWithClonedFlags fails closed on a guessed label anchor',()=>{
  const records=[rec('COMPONENT','1111111111111111',{x:0,y:0}),rec('ATTR','1111111111111112',{parentId:'1111111111111111',key:'Global Net Name',value:'GND'}),
    rec('WIRE','2222222222222222',{}),rec('LINE','2222222222222223',{lineGroup:'2222222222222222',startX:10,startY:-20,endX:30,endY:-20}),
    rec('ATTR','2222222222222224',{parentId:'2222222222222222',key:'NET',value:'GND',x:10,y:-20,valueVisible:true})];
  assert.throws(()=>replaceWireLabelsWithClonedFlags(records,{flagTemplateId:'1111111111111111',labels:[{wireRootId:'2222222222222222',net:'GND',anchor:{x:15,y:20}}]}),/anchor mismatch/);
});

test('replaceWireLabelsWithClonedFlags absorbs secondary wire roots instead of relying on geometric contact',()=>{
  const records=[
    rec('COMPONENT','1111111111111111',{partId:'g',x:0,y:0,rotation:0,isMirror:false}),
    rec('ATTR','1111111111111112',{parentId:'1111111111111111',key:'Global Net Name',value:'GND'}),
    rec('WIRE','2222222222222222',{}),rec('LINE','2222222222222223',{lineGroup:'2222222222222222',startX:10,startY:-20,endX:30,endY:-20}),
    rec('ATTR','2222222222222224',{parentId:'2222222222222222',key:'NET',value:'GND',x:10,y:-20,valueVisible:true}),
    rec('WIRE','3333333333333333',{}),rec('LINE','3333333333333334',{lineGroup:'3333333333333333',startX:10,startY:-30,endX:30,endY:-30}),
    rec('ATTR','3333333333333335',{parentId:'3333333333333333',key:'NET',value:'GND',x:10,y:-30,valueVisible:true}),
  ];
  const p=replaceWireLabelsWithClonedFlags(records,{flagTemplateId:'1111111111111111',labels:[
    {wireRootId:'2222222222222222',net:'GND',anchor:{x:10,y:20}},{wireRootId:'3333333333333333',net:'GND',anchor:{x:10,y:30}},
  ],mergeWireRoots:[{into:'2222222222222222',from:['3333333333333333'],dx:5,dy:10}]});
  assert.ok(p.drop.has('3333333333333333'));assert.ok(p.removedRecordIds.has('3333333333333334'));
  const copied=p.add.find(r=>r.head.type==='LINE');assert.equal(copied.atom.lineGroup,'2222222222222222');
  assert.deepEqual([copied.atom.startX,copied.atom.startY,copied.atom.endX,copied.atom.endY],[15,-40,35,-40]);
});
