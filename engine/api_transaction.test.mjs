import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('wf exposes the guarded API transaction and no ad-hoc mutation command',()=>{
  const source=fs.readFileSync(new URL('../wf.mjs',import.meta.url),'utf8');
  assert.match(source,/cmd === 'api'/);
  assert.match(source,/runApiTransaction/);
  assert.doesNotMatch(source,/EASYEDA_ALLOW_AD_HOC/);
});

test('wf exposes lint as the read-only root-cause queue entry point',()=>{
	const source=fs.readFileSync(new URL('../wf.mjs',import.meta.url),'utf8');
	assert.match(source,/cmd === 'lint'/);
	assert.match(source,/workflow-lint\.json/);
});
