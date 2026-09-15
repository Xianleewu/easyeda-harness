import test from 'node:test';
import assert from 'node:assert/strict';
import {predictSourceCandidate} from './source_candidate_twin.mjs';

const L=(type,id,atom)=>JSON.stringify({type,id})+'||'+JSON.stringify(atom);
const source=(x=10)=>[
  L('COMPONENT','p',{partId:'generic.1',x,y:-10,rotation:0,isMirror:false}),
  L('ATTR','d',{parentId:'p',key:'Designator',value:'P1',x:0,y:0,valueVisible:true}),
  L('ATTR','v',{parentId:'p',key:'Name',value:'part',x:0,y:-10,valueVisible:true}),
  L('WIRE','w',{}),L('LINE','l',{lineGroup:'w',startX:x,startY:-10,endX:x+20,endY:-10}),
].join('|\n');
const geometry={components:[{id:'p',designator:'P1',x:10,y:10,rotation:0,mirror:false,bbox:{minX:5,minY:5,maxX:15,maxY:15},
  pins:[{num:'1',x:10,y:10,noConnected:false}],attrs:[{key:'Designator',value:'P1',valueVisible:true,x:0,y:0,bbox:{minX:0,minY:0,maxX:8,maxY:8}}]}],netflags:[],
  wires:[{id:'w#0',net:'N',line:[10,10,30,10]}],texts:[],rectangles:[],sheetEvidence:{id:'s'}};

test('source candidate twin replays component and wire coordinates from compiled source',()=>{
  const out=predictSourceCandidate(source(20),{baselineSource:source(10),baselineGeometry:geometry,baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part'}});
  assert.equal(out.model.components[0].x,20);
  assert.deepEqual(out.model.wires[0].line,[20,10,40,10]);
  assert.equal(out.nets.P1['1'],'N');
  assert.equal(out.evidence.sourceDerived,true);
});

test('source candidate twin preserves live-resolved footprint when source omits it',()=>{
  const enriched={...geometry,components:[{...geometry.components[0],attrs:[
    ...geometry.components[0].attrs,{key:'Footprint',value:'fp-resolved',valueVisible:false,bbox:null},
  ]}]};
  const out=predictSourceCandidate(source(20),{baselineSource:source(10),baselineGeometry:enriched,
    baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part'}});
  assert.equal(out.model.components[0].attrs.find(a=>a.key==='Footprint')?.value,'fp-resolved');
});

test('source candidate twin resolves a stable null footprint placeholder from live geometry',()=>{
  const nullFootprint=source(10)+'|\n'+L('ATTR','fp',{parentId:'p',key:'Footprint',value:null});
  const enriched={...geometry,components:[{...geometry.components[0],attrs:[
    ...geometry.components[0].attrs,{key:'Footprint',value:'fp-resolved',valueVisible:false,bbox:null},
  ]}]};
  const out=predictSourceCandidate(nullFootprint,{baselineSource:nullFootprint,baselineGeometry:enriched,
    baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part'}});
  assert.equal(out.model.components[0].attrs.find(a=>a.key==='Footprint')?.value,'fp-resolved');
});

test('source candidate twin does not resurrect a source footprint intentionally removed',()=>{
  const withFootprint=source(10)+'|\n'+L('ATTR','fp',{parentId:'p',key:'Footprint',value:'fp-source'});
  const enriched={...geometry,components:[{...geometry.components[0],attrs:[
    ...geometry.components[0].attrs,{key:'Footprint',value:'fp-source',valueVisible:false,bbox:null},
  ]}]};
  const out=predictSourceCandidate(source(10),{baselineSource:withFootprint,baselineGeometry:enriched,
    baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part'}});
  assert.equal(out.model.components[0].attrs.some(a=>a.key==='Footprint'),false);
});

test('a current net flag replaces the preserved wire root name instead of creating a false dual identity',()=>{
	const flag=(x)=>[
		L('COMPONENT','g',{partId:'ground.1',x,y:-10,rotation:0,isMirror:false}),
		L('ATTR','gg',{parentId:'g',key:'Global Net Name',value:'GND',x,y:-10,valueVisible:false}),
	];
	const baseline=[source(10),L('ATTR','wn',{parentId:'w',key:'NET',value:'OLD',x:30,y:-10,valueVisible:true}),...flag(50)].join('|\n');
	const candidate=[source(10),...flag(10)].join('|\n');
	const withFlag={...geometry,netflags:[{id:'g',kind:'ground',net:'GND',x:50,y:10,rotation:0,bbox:{minX:45,minY:5,maxX:55,maxY:15}}],
		wires:[{id:'w#0',net:'OLD',line:[10,10,30,10]}]};
	const out=predictSourceCandidate(candidate,{baselineSource:baseline,baselineGeometry:withFlag,baselineNets:{P1:{'1':'GND'}},componentTypes:{p:'part',g:'netflag'}});
	assert.equal(out.nets.P1['1'],'GND');
	assert.equal(out.model.wires[0].net,'GND');
});

test('source candidate twin fails closed when an added component has no proven geometry donor',()=>{
  const candidate=source(10)+'|\n'+L('COMPONENT','q',{partId:'unknown.1',x:40,y:-10,rotation:0,isMirror:false})+'|\n'+L('ATTR','qd',{parentId:'q',key:'Designator',value:'P2'});
  assert.throws(()=>predictSourceCandidate(candidate,{baselineSource:source(10),baselineGeometry:geometry,baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part',q:'part'}}),/geometry-donor-missing/);
});

test('added donor matching includes library identity and object role, not shared partId alone',()=>{
  const candidate=source(10)+'|\n'+L('COMPONENT','q',{partId:'generic.1',x:40,y:-10,rotation:0,isMirror:false})+'|\n'+L('ATTR','qd',{parentId:'q',key:'Global Net Name',value:'GND'});
  assert.throws(()=>predictSourceCandidate(candidate,{baselineSource:source(10),baselineGeometry:geometry,baselineNets:{P1:{'1':'N'}},componentTypes:{p:'part',q:'netflag'}}),/geometry-donor-missing/);
});

test('unnamed recovered local component inherits its one authoritative baseline net name',()=>{
  const unnamed={...geometry,components:[{...geometry.components[0],pins:[{num:'1',x:10,y:10,noConnected:false},{num:'2',x:30,y:10,noConnected:false}]}],wires:[{id:'w#0',net:'',line:[10,10,30,10]}]};
  const out=predictSourceCandidate(source(10),{baselineSource:source(10),baselineGeometry:unnamed,baselineNets:{P1:{'1':'INTERNAL','2':'INTERNAL'}},componentTypes:{p:'part'}});
  assert.equal(out.nets.P1['1'],'INTERNAL');
});

test('different touching WIRE roots cannot inherit a NET name geometrically',()=>{
  const part=(id,ref,x)=>[
    L('COMPONENT',id,{partId:'generic.1',x,y:-10,rotation:0,isMirror:false}),
    L('ATTR',`${id}d`,{parentId:id,key:'Designator',value:ref,x,y:-10,valueVisible:true}),
    L('ATTR',`${id}v`,{parentId:id,key:'Name',value:'part',x,y:-20,valueVisible:true}),
  ];
  const base=[...part('p1','P1',10),...part('p2','P2',50),
    L('WIRE','w',{}),L('ATTR','wn',{parentId:'w',key:'NET',value:'N',x:10,y:-10,valueVisible:true}),
    L('LINE','wl',{lineGroup:'w',startX:10,startY:-10,endX:30,endY:-10}),
    L('WIRE','old2',{}),L('LINE','old2l',{lineGroup:'old2',startX:30,startY:-10,endX:50,endY:-10}),
  ].join('|\n');
  const candidate=[...part('p1','P1',10),...part('p2','P2',50),
    L('WIRE','w',{}),L('ATTR','wn',{parentId:'w',key:'NET',value:'N',x:10,y:-10,valueVisible:true}),
    L('LINE','wl',{lineGroup:'w',startX:10,startY:-10,endX:30,endY:-10}),
    L('WIRE','new2',{}),L('LINE','new2l',{lineGroup:'new2',startX:30,startY:-10,endX:50,endY:-10}),
  ].join('|\n');
  const p1={...geometry.components[0],id:'p1',designator:'P1'};
  const p2={...geometry.components[0],id:'p2',designator:'P2',x:50,bbox:{minX:45,minY:5,maxX:55,maxY:15},
    pins:[{num:'1',x:50,y:10,noConnected:false}]};
  const baselineGeometry={...geometry,components:[p1,p2],wires:[
    {id:'w#0',net:'N',line:[10,10,30,10]},
    {id:'old2#0',net:'N',line:[30,10,50,10]},
  ]};
  assert.throws(()=>predictSourceCandidate(candidate,{baselineSource:base,baselineGeometry,
    baselineNets:{P1:{'1':'N'},P2:{'1':'N'}},componentTypes:{p1:'part',p2:'part'}}),/WIRE-root connectivity mismatch/);
});
