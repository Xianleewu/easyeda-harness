import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBridgeWriteAuthorized, bridgeMutationSignatures, encodeBridgePayload} from './bridge_client.mjs';

test('bridge JSON survives independent decoding at every possible byte boundary', () => {
  const payload = {code: 'return "中文 ±10% 😀 \\u4e2d \\n";', windowId: 'example'};
  const bytes = Buffer.from(encodeBridgePayload(payload));
  for (let split = 0; split <= bytes.length; split++) {
    const received = bytes.subarray(0, split).toString() + bytes.subarray(split).toString();
    assert.deepEqual(JSON.parse(received), payload);
  }
  const raw = Buffer.from(JSON.stringify(payload));
  const boundary = raw.indexOf(Buffer.from('±')) + 1;
  assert.notDeepEqual(JSON.parse(raw.subarray(0, boundary).toString() + raw.subarray(boundary).toString()), payload);
});

test('read-only bridge calls need no write context', () => {
  assert.deepEqual(bridgeMutationSignatures('return await eda.sch_PrimitiveWire.getAll();'), []);
  assert.equal(assertBridgeWriteAuthorized('return await eda.sch_Drc.check(true,true,true);').mutating, false);
});

test('direct live mutation is blocked unless a workflow transaction authorizes it', () => {
  const code = 'await eda.sch_PrimitiveWire.create([0,0,10,0],"N");await eda.sch_Document.save();';
  assert.throws(() => assertBridgeWriteAuthorized(code), /LIVE_WRITE_BLOCKED/);
  assert.equal(assertBridgeWriteAuthorized(code, 'api-transaction').mutating, true);
  assert.throws(() => assertBridgeWriteAuthorized(code, 'ad-hoc-script'), /LIVE_WRITE_BLOCKED/);
});
