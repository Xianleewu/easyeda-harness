import test from 'node:test';import assert from 'node:assert/strict';
import {groupConnectedWires} from './source_wire_groups.mjs';
test('branches sharing a trunk are serialized in one electrical wire group',()=>{
  const groups=groupConnectedWires([{net:'rail',line:[0,0,100,0]},{net:'rail',line:[50,0,50,30]},{net:'rail',line:[100,0,100,30]}]);
  assert.equal(groups.length,1);assert.equal(groups[0].segments.length,3);
});
test('same-name but physically separate runs remain separate groups',()=>{
  assert.equal(groupConnectedWires([{net:'rail',line:[0,0,10,0]},{net:'rail',line:[20,0,30,0]}]).length,2);
});
test('different nets crossing or touching and malformed geometry are rejected',()=>{
  assert.throws(()=>groupConnectedWires([{net:'first',line:[0,0,10,0]},{net:'second',line:[5,-5,5,5]}]),/Different/);
  assert.throws(()=>groupConnectedWires([{net:'first',line:[0,0,10,10]}]),/Diagonal/);
  assert.throws(()=>groupConnectedWires([{net:'first',line:[0,0,0,0]}]),/Zero/);
});
