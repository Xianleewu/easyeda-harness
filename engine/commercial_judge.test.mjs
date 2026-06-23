import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeBoard, judgeBoardTokens, runLiveJudge, judgeSnapshot } from './commercial_judge.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('judgeSnapshot 读 JSON 离线评分', () => {
	const dir = mkdtempSync(join(tmpdir(), 'judge-'));
	const f = join(dir, 's.json');
	writeFileSync(f, JSON.stringify({ components: [], wires: [] }));
	const rep = judgeSnapshot(f, { drc: { error: 0, warn: 0, info: 0 } });
	assert.equal(rep.rules.length, 10);
	assert.equal(rep.commercialPass, true);
});

test('judgeBoardTokens 三层 + shots 透传,DRC脏→不符合', () => {
	const rep = judgeBoardTokens({ components: [], wires: [] }, { drc: { error: 1, warn: 0, info: 0 }, shots: ['/tmp/x.png'] });
	assert.equal(rep.conform, false);
	assert.equal(rep.tier1.conform, false);
	assert.deepEqual(rep.shots, ['/tmp/x.png']);
	assert.equal(rep.score, undefined);
});
