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

test('guarded API source writes run full candidate preflight first',()=>{
	const source=fs.readFileSync(new URL('./api_transaction.mjs',import.meta.url),'utf8');
	const preflight=source.indexOf('runCandidatePreflight({candidateSource:compiled.source');
	const write=source.indexOf("setDocumentSource(${JSON.stringify(compiled.source)})");
	assert.ok(preflight>=0&&write>preflight);
});

test('API transactions pin every bridge call to the selected EasyEDA window',()=>{
	const source=fs.readFileSync(new URL('./api_transaction.mjs',import.meta.url),'utf8');
	assert.match(source,/executeCode\(code,\{\.\.\.options,windowId\}\)/);
	assert.doesNotMatch(source,/await executeCode\(`/);
});

test('API transactions restore the original schematic after temporary library tabs',()=>{
	const source=fs.readFileSync(new URL('./api_transaction.mjs',import.meta.url),'utf8');
	assert.match(source,/const originalTab=d\.tabId/);
	assert.match(source,/API stage did not restore original schematic/);
	assert.match(source,/ensureOriginalActive/);
});

test('API failures persist their stage and window before rollback',()=>{
	const source=fs.readFileSync(new URL('./api_transaction.mjs',import.meta.url),'utf8');
	assert.match(source,/last-api-failure\.json/);
	assert.match(source,/artifactPrefix:prefix/);
	assert.ok(source.indexOf('last-api-failure.json')<source.lastIndexOf('await restore'));
});

test('wf locks the first successful bridge window for the whole command',()=>{
	const source=fs.readFileSync(new URL('../wf.mjs',import.meta.url),'utf8');
	assert.match(source,/workflowWindowId = actual/);
	assert.match(source,/windowId:workflowWindowId/);
});
