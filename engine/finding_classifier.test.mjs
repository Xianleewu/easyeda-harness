// finding_classifier 单测（node:test，零依赖）
// 验证：DRC 原始 item → 逐条分类 auto/resolve/ask/skip，floating-pin 启发式预填建议。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFindings } from './finding_classifier.mjs';

/* 构造一个贴近真实 drc_report.json 的输入 */
function drc(items) {
	return { drc: { items } };
}

test('未连网标 → 每个 auto，解析自动网名，动作=删网标', () => {
	const r = classifyFindings(drc([
		{ level: 'info', msg: '网络标识 $3I165 没有连接导线或总线。' },
		{ level: 'info', msg: '网络标识 $3I166 没有连接导线或总线。' },
	]));
	const nl = r.items.filter(i => i.category === 'unconnectedNetLabel');
	assert.equal(nl.length, 2);
	assert.deepEqual(nl.map(i => i.ref), ['$3I165', '$3I166']);
	assert.ok(nl.every(i => i.disposition === 'auto'));
	assert.ok(nl.every(i => i.kind === 'delete-net-label'));
});

test('器件标准化 → 每个 resolve，解析 设计符($3I) 对照', () => {
	const r = classifyFindings(drc([
		{ level: 'warning', msg: '元件的属性与供应商编号不匹配。，建议使用器件标准化: SW2($3I6),LED6($3I7),Q2($3I72)' },
	]));
	const ds = r.items.filter(i => i.category === 'deviceStandardization');
	assert.equal(ds.length, 3);
	assert.deepEqual(ds.map(i => i.ref), ['SW2', 'LED6', 'Q2']);
	assert.equal(ds[0].detail.edaId, '$3I6');
	assert.ok(ds.every(i => i.disposition === 'resolve'));
	assert.ok(ds.every(i => i.kind === 'standardize-device'));
});

test('悬空引脚 → 每个 ask，且启发式预填建议复现人工分诊', () => {
	const r = classifyFindings(drc([
		{ level: 'warning', msg: '发现元件引脚悬空，建议放置非连接标识在引脚上 : SW2.B,LED6.1,LED6.2,Q2.2,U9.8,C13.1,C13.2,C21.1,C23.2,R11.2,R9.2,R13.2' },
	]));
	const fp = r.items.filter(i => i.category === 'floatingPin');
	assert.equal(fp.length, 12);
	assert.ok(fp.every(i => i.disposition === 'ask'));
	const sug = Object.fromEntries(fp.map(i => [i.ref, i.suggestion]));
	// 电阻单脚悬空 → 疑似漏连 wire
	assert.equal(sug['R9.2'], 'wire');
	assert.equal(sug['R11.2'], 'wire');
	assert.equal(sug['R13.2'], 'wire');
	// 电容两脚都悬空 → 疑似漏连 wire
	assert.equal(sug['C13.1'], 'wire');
	assert.equal(sug['C13.2'], 'wire');
	// 电容单脚悬空 → 可能有意 NC
	assert.equal(sug['C21.1'], 'nc');
	assert.equal(sug['C23.2'], 'nc');
	// 其它多脚器件单脚悬空 / LED 两脚 → NC 候选
	assert.equal(sug['SW2.B'], 'nc');
	assert.equal(sug['Q2.2'], 'nc');
	assert.equal(sug['U9.8'], 'nc');
	assert.equal(sug['LED6.1'], 'nc');
	assert.equal(sug['LED6.2'], 'nc');
});

test('summary 计数正确', () => {
	const r = classifyFindings(drc([
		{ level: 'info', msg: '网络标识 $3I165 没有连接导线或总线。' },
		{ level: 'warning', msg: '建议使用器件标准化: SW2($3I6),LED6($3I7)' },
		{ level: 'warning', msg: '发现元件引脚悬空，建议放置非连接标识在引脚上 : R9.2,SW2.B' },
	]));
	assert.equal(r.summary.auto, 1);
	assert.equal(r.summary.resolve, 2);
	assert.equal(r.summary.ask, 2);
	assert.equal(r.summary.total, 5);
});

test('未识别类别 → skip，不误判', () => {
	const r = classifyFindings(drc([
		{ level: 'warning', msg: '某种未知 DRC 提示，与已知三类都不匹配' },
	]));
	assert.equal(r.items.length, 1);
	assert.equal(r.items[0].disposition, 'skip');
	assert.equal(r.summary.skip, 1);
});

test('空输入安全', () => {
	const r = classifyFindings({});
	assert.deepEqual(r.items, []);
	assert.equal(r.summary.total, 0);
});
