import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRuleDocs, scanSpecificContent } from './rubric_audit.mjs';

test('扫描命中具体器件/网名指纹', () => {
	const hits = scanSpecificContent('device ZXQ9876 and net BOARD_PRIVATE_SIG');
	assert.ok(hits.includes('ZXQ9876'));
	assert.ok(hits.includes('BOARD_PRIVATE_SIG'));
});

test('通用文本无命中', () => {
	assert.deepEqual(scanSpecificContent('去耦电容贴近电源脚,标签贴线对齐'), []);
});

test('公共规则与工作流文档零项目字面量', async () => {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const rows = await auditRuleDocs([
		path.join(root, 'AGENTS.md'),
		path.join(root, 'docs/schematic-design-rules.md'),
		path.join(root, 'docs/schematic_design_rulebook.md'),
		path.join(root, 'commercialization_workflow.md'),
	]);
	assert.deepEqual(rows.filter(r => r.hits.length), []);
});
