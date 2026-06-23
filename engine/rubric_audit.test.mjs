import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSpecificContent } from './rubric_audit.mjs';

test('扫描命中具体器件/网名指纹', () => {
	const hits = scanSpecificContent('AMS1117 and ESP32 net VDD_CPU');
	assert.ok(hits.includes('AMS1117'));
	assert.ok(hits.includes('ESP32'));
});

test('通用文本无命中', () => {
	assert.deepEqual(scanSpecificContent('去耦电容贴近电源脚,标签贴线对齐'), []);
});
