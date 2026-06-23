import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, tokenById } from './design_tokens.mjs';

test('TOKENS 含核心 token 且字段完整', () => {
	const ids = TOKENS.map(t => t.id);
	for (const id of ['T-DRC','T-ORTHO','T-GRID','T-NOCROSS','T-NOTHRU','T-NOOVERLAP','T-DENSITY','T-ANNOT-PLACE','T-ANNOT-FULL','T-VISUAL']) {
		assert.ok(ids.includes(id), `缺 ${id}`);
	}
	for (const t of TOKENS) {
		assert.ok(t.category && t.desc && t.source, `${t.id} 缺字段`);
		assert.ok(['drc','geom','vision'].includes(t.evidence), `${t.id} evidence 非法`);
		assert.ok([1,2,3].includes(t.tier), `${t.id} tier 非法`);
	}
});

test('严标不放水:T-ORTHO=100、T-GRID=100、T-DRC 全0', () => {
	assert.equal(tokenById('T-ORTHO').value.minPct, 100);
	assert.equal(tokenById('T-GRID').value.minPct, 100);
	assert.deepEqual(tokenById('T-DRC').value, { error: 0, warn: 0, info: 0 });
});

test('能机械判的不归 vision:仅整体残余 T-VISUAL 是 vision/tier3', () => {
	for (const t of TOKENS) if (t.evidence === 'vision') assert.equal(t.tier, 3, `${t.id} vision 必 tier3`);
	assert.equal(tokenById('T-DENSITY').evidence, 'geom');
	assert.equal(tokenById('T-ANNOT-FULL').evidence, 'geom');
});

test('零特定电路字面量', () => {
	const src = TOKENS.map(t => t.desc + ' ' + t.source).join(' ');
	assert.doesNotMatch(src, /AMS1117|AO3400|ESP32|RK3576|RK806|VCC3V3_|VDD_CPU|vibe.?buddy/i);
});
