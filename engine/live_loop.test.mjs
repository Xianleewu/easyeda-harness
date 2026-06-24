import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightGuard, runLoop } from './live_loop.mjs';

test('preflightGuard:无 confirmOverwrite → 抛(防误投毁板)', () => {
	assert.throws(() => preflightGuard({}), /confirmOverwrite/);
	assert.doesNotThrow(() => preflightGuard({ confirmOverwrite: true }));
});

test('runLoop:deliver 之前必先写备份', async () => {
	const calls = [];
	const deps = {
		readSnapshot: async () => { calls.push('backup'); return { components: [] }; },
		deliver: async () => { calls.push('deliver'); },
		observe: async () => { calls.push('observe'); return { conform: false }; },
		writeBackup: (snap) => { calls.push('writeBackup'); return '/tmp/backup.json'; },
	};
	const r = await runLoop({ components: [] }, deps, { confirmOverwrite: true });
	assert.equal(calls.indexOf('writeBackup') < calls.indexOf('deliver'), true, '备份必在投递前');
	assert.ok(r.backupPath);
});

test('runLoop:无 confirmOverwrite 直接拒(不投递)', async () => {
	const deps = { readSnapshot: async () => ({}), deliver: async () => { throw new Error('不该投'); }, observe: async () => ({}), writeBackup: () => '/x' };
	await assert.rejects(() => runLoop({}, deps, {}), /confirmOverwrite/);
});

test('runLoop:restore 校验失败 → 大声抛(含备份路径)', async () => {
	let call = 0;
	const deps = {
		readSnapshot: async () => (call++ === 0 ? { components: [1, 2] } : { components: [] }), /* 还原后长度不一致 */
		deliver: async () => {},
		observe: async () => ({}),
		writeBackup: () => '/tmp/bak.json',
		restore: async () => {},
	};
	await assert.rejects(
		() => runLoop({}, deps, { confirmOverwrite: true, restore: true }),
		/还原校验不过|备份/
	);
});
