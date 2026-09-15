import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { netsFromEasyEdaNetlist, runCandidatePreflight, applyVerifiedPinStateChanges, applyVerifiedPinNetChanges } from './candidate_preflight.mjs';

const L=(type,id,atom)=>JSON.stringify({type,id})+'||'+JSON.stringify(atom);

test('raw EasyEDA netlist is normalized to designator/pin/net evidence',()=>{
  assert.deepEqual(netsFromEasyEdaNetlist({components:{x:{props:{Designator:'U1'},pinInfoMap:{'1':{net:'N'}}}}}),{U1:{'1':'N'}});
  assert.throws(()=>netsFromEasyEdaNetlist({components:{}}),/no component pin map/);
});

test('full prewrite gate requires complete baseline evidence before any write',async()=>{
  await assert.rejects(runCandidatePreflight({candidateSource:'x',baselineSource:'x',plan:{},baselineReport:{},tokenEvidence:{}}),/Baseline live evidence is incomplete/);
});

test('candidate pin-state changes require matching source state and verified ownership',()=>{
  const source=JSON.stringify({type:'ATTR',id:'nc'})+'||'+JSON.stringify({parentId:'virtual-pin',key:'NO_CONNECT',value:'yes'});
  const model={components:[{id:'part',designator:'J1',pins:[{num:'7',noConnected:false}]}]};
  applyVerifiedPinStateChanges(model,source,[{componentId:'part',ref:'J1',pin:'7',parentId:'virtual-pin',noConnected:true}],{pinOwners:{'virtual-pin':'part'}});
  assert.equal(model.components[0].pins[0].noConnected,true);
  assert.throws(()=>applyVerifiedPinStateChanges(model,source,[{componentId:'part',ref:'J1',pin:'7',parentId:'wrong',noConnected:true}],{pinOwners:{}}),/Unverified pin owner/);
});

test('candidate pin-net changes require an exact before value and produce the declared target netlist',()=>{
  const before={J1:{'1':'OLD','2':'GND'}};
  assert.deepEqual(applyVerifiedPinNetChanges(before,[{ref:'J1',pin:'1',before:'OLD',after:'NEW'}]),{J1:{'1':'NEW','2':'GND'}});
  assert.equal(before.J1['1'],'OLD');
  assert.throws(()=>applyVerifiedPinNetChanges(before,[{ref:'J1',pin:'1',before:'WRONG',after:'NEW'}]),/baseline mismatch/);
});

test('candidate source/model coverage rejects a missing placed object',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'candidate-preflight-'));
  const geom=path.join(dir,'g.json'),netlist=path.join(dir,'n.json');
  writeFileSync(geom,JSON.stringify({components:[],netflags:[],wires:[],texts:[],rectangles:[]}));
  writeFileSync(netlist,JSON.stringify({components:{x:{props:{Designator:'P1'},pinInfoMap:{'1':{net:'N'}}}}}));
  const source=[L('COMPONENT','p',{x:0,y:0}),L('ATTR','d',{parentId:'p',key:'Designator',value:'P1'})].join('|\n');
  const baseline={geometryArtifact:geom,netlistArtifact:netlist,tier1:{conform:true},drc:{error:0,warn:0,info:0,evidence:{verified:true}},tier2:[],coverage:{complete:true},deviationCount:0};
  const plan={predictCandidate:async()=>({model:{components:[],netflags:[],wires:[],texts:[],rectangles:[]},nets:{P1:{'1':'N'}}})};
  await assert.rejects(runCandidatePreflight({candidateSource:source,baselineSource:source,plan,baselineReport:baseline,
    tokenEvidence:{moduleRegions:[{id:'m',members:['P1']}],cellRegions:[{id:'c',members:['P1']}],sheetBounds:{minX:0,minY:0,maxX:100,maxY:100},titleBlockKeepout:{minX:90,minY:90,maxX:100,maxY:100}},componentTypes:{p:'part'}}),/coverage failed/);
});
