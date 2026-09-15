import test from 'node:test';
import assert from 'node:assert/strict';
import {pointOnOrthogonalSegment as on} from './orthogonal_point.mjs';
test('rotated native pin roundoff does not turn a connected wire into an orphan',()=>{
  assert.equal(on(249.99999999999994,284.99999999999994,215,285,250,285),true);
  assert.equal(on(420.00000000000006,315,420,300,420,330),true);
});
test('tolerance does not invent nearby, out-of-range, or diagonal connections',()=>{
  assert.equal(on(250,285.001,215,285,250,285),false);
  assert.equal(on(250.001,285,215,285,250,285),false);
  assert.equal(on(230,280,215,265,250,300),false);
  assert.equal(on(NaN,285,215,285,250,285),false);
});
