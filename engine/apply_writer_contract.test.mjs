// apply_writer_contract 单测:bundled aihwdebugger 的 apply writer 用「源式投递」适配器
// (apply_source_run.mjs,setDocumentSource 原子加载),替代旧 create 式 apply_run.mjs。
// 锁住官方门控路径(apply --gated)的 writer 集成不被改坏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolveApplyWriter } from '../contracts/apply_writer_contract.mjs';

test('bundled aihwdebugger writer:run 用源式投递适配器(apply_source_run.mjs),入口存在', () => {
	const w = resolveApplyWriter({ assembly: { circuitPack: 'aihwdebugger' }, pack: null, root: process.cwd() });
	assert.equal(w.pass, true, 'bundled writer 应 pass');
	assert.equal(w.mode, 'bundled-aihwdebugger');
	assert.equal(w.writer.run, 'engine/apply_source_run.mjs', 'run 入口应是源式适配器');
	assert.equal(w.writer.id, 'aihwdebugger-source-writer');
	assert.equal(w.writer.generate, 'engine/apply_full.mjs', 'generate 仍产 full_model.json/af_*');
	assert.ok(existsSync(w.writer.run), 'run 入口文件存在(AW5 门要求)');
	assert.ok(existsSync(w.writer.generate), 'generate 入口文件存在');
	assert.equal(w.severity.hard, 0);
});

test('外部 pack 未声明 writer → AW1 hard(回归:bundled 改动不影响外部 pack 校验)', () => {
	const w = resolveApplyWriter({ assembly: { circuitPack: 'some-external' }, pack: null, root: process.cwd() });
	assert.equal(w.pass, false);
	assert.ok(w.findings.some(f => f.rule === 'AW1-pack-writer-declared' && f.severity === 'hard'));
});
