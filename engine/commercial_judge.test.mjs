import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeBoard, runLiveJudge } from './commercial_judge.mjs';

test('judgeBoard 组装证据化报告', () => {
	const model = { components: [], wires: [] };
	const rep = judgeBoard(model, { drc: { error: 1, warn: 2, info: 0 }, shots: ['/tmp/a.png'] });
	assert.equal(rep.commercialPass, false);    // CR-01 error=1 → block fail
	assert.ok(rep.rules.find(r => r.id === 'CR-01' && r.pass === false));
	assert.deepEqual(rep.shots, ['/tmp/a.png']);
	assert.match(rep.summary, /block/i);
});

test('runLiveJudge 无桥 → fail-closed(reject,不伪装绿灯)', async () => {
	await assert.rejects(
		() => runLiveJudge({ port: 1, outDir: '/tmp', timeoutMs: 10 }),
		/bridge|not found|fetch|abort|ECONN|timeout/i
	);
});
