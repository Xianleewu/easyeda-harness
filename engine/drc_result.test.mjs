import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDrcResult, evaluateDrcEvidence, parseDrcCompletionText, evaluateSourceAudit,
  parseDrcDiagnosticRows, attributeDrcRows,
  currentPageDrcMagnitude,
  deriveCurrentPageDrc,
} from './drc_result.mjs';

test('omitted informational findings are unknown, including an empty API result', () => {
  for (const raw of [[], [{ type: 'warn', count: 9 }]]) {
    const r = evaluateDrcResult(raw);
    assert.equal(r.counts.info, null);
    assert.equal(r.verified, false);
    assert.equal(r.pass, false);
    assert.deepEqual(r.missingSeverities, ['info']);
  }
});

test('project-wide DRC is scoped to the active page only with complete row attribution', () => {
  const evidence={verified:true,counts:{error:1,warning:2,info:0}};
  const rows=[
    {severity:'error',scope:'other-page'},
    {severity:'warning',scope:'other-page'},
    {severity:'warning',scope:'current-page'},
  ];
  const scoped=deriveCurrentPageDrc(evidence,rows);
  assert.equal(scoped.verified,true);
  assert.deepEqual(scoped.counts,{error:0,warning:1,info:0});
});

test('DRC page scoping fails closed when native totals and diagnostics differ', () => {
  const scoped=deriveCurrentPageDrc({verified:true,counts:{error:1,warning:2,info:0}},[
    {severity:'error',scope:'other-page'}, {severity:'warning',scope:'other-page'},
  ]);
  assert.equal(scoped.verified,false);
  assert.equal(scoped.reason,'diagnostic-count-mismatch');
});
test('explicit informational coverage can verify a fully empty result', () => {
  const r = evaluateDrcResult([{ type: 'info', count: 0 }]);
  assert.deepEqual(r.counts, { error: 0, warning: 0, info: 0 });
  assert.equal(r.pass, true);
});
test('every nonzero severity blocks passing, including warnings and info', () => {
  for (const type of ['fatalError', 'error', 'warn', 'warning', 'info']) {
    const r = evaluateDrcResult([{ type, count: 2 }, { type: 'info', count: 0 }]);
    assert.equal(r.verified, true);
    assert.equal(r.pass, false);
  }
});
test('aggregate rows accumulate rather than hiding later violations', () => {
  assert.deepEqual(evaluateDrcResult([
    { type: 'fatalError', count: 1 }, { type: 'error', count: 2 },
    { type: 'warn', count: 0 }, { type: 'warn', count: 3 },
  ]).counts, { error: 3, warning: 3, info: null });
});
test('absent, malformed and unrecognized results fail closed', () => {
  for (const raw of [null, undefined, true, false, {}, [null], ['failure'],
    [{ type: 'warn' }], [{ type: 'warn', count: '0' }],
    [{ type: 'warn', count: -1 }], [{ type: 'warn', count: 0.5 }],
    [{ type: 'other', count: 0 }], [{ type: 'toString', count: 0 }]]) {
    assert.equal(evaluateDrcResult(raw).verified, false);
    assert.equal(evaluateDrcResult(raw).pass, false);
  }
});
test('any source finding blocks audit; audit never proves delivery', () => {
  assert.equal(evaluateSourceAudit({ findings: [{ sev: 'soft' }], hard: 0 }, []).pass, false);
  assert.equal(evaluateSourceAudit({ hard: 0 }, []).pass, false);
  assert.equal(evaluateSourceAudit({ findings: [] }, [{ type: 'warn', count: 23 }]).pass, false);
  assert.equal(evaluateSourceAudit({ findings: [] }, []).pass, false);
  const r = evaluateSourceAudit({ findings: [] }, [{ type: 'info', count: 0 }]);
  assert.equal(r.pass, true);
  assert.equal(r.deliveryVerified, false);
});

test('fresh native completion line supplies all four severities on older clients', () => {
  const line='[信息] : 完成设计规则检查。 致命错误： 0, 错误：0，警告：2，信息：0。';
  assert.deepEqual(parseDrcCompletionText(line),{fatal:0,error:0,warning:2,info:0,line:'完成设计规则检查。 致命错误： 0, 错误：0，警告：2，信息：0'});
  const r=evaluateDrcEvidence([{type:'warn',count:2}],{completion:line,fresh:true});
  assert.equal(r.verified,true);assert.equal(r.pass,false);assert.deepEqual(r.counts,{error:0,warning:2,info:0});assert.equal(r.source,'native-completion');
});

test('stale or malformed native text cannot upgrade incomplete API evidence', () => {
  const line='完成设计规则检查。 致命错误： 0, 错误：0，警告：0，信息：0。';
  assert.equal(evaluateDrcEvidence([],{completion:line,fresh:false}).verified,false);
  assert.equal(evaluateDrcEvidence([],{completion:'not a DRC result',fresh:true}).verified,false);
});

test('an awaited repeated DRC may reuse the DOM when API and UI totals agree', () => {
  const completion='[信息] : 完成设计规则检查。 致命错误： 0, 错误：1，警告：7，信息：9。';
  const result=evaluateDrcEvidence([{type:'error',count:1},{type:'warn',count:7}],{completion,invoked:true,fresh:false});
  assert.equal(result.verified,true);
  assert.deepEqual(result.counts,{error:1,warning:7,info:9});
});

test('an awaited repeated DRC rejects stale UI totals that disagree with the API', () => {
  const completion='完成设计规则检查。 致命错误：0，错误：0，警告：0，信息：0';
  const result=evaluateDrcEvidence([{type:'error',count:1},{type:'warn',count:7}],{completion,invoked:true,fresh:false});
  assert.equal(result.verified,false);
  assert.equal(result.source,'api-ui-mismatch');
});

test('native DRC diagnostics retain concrete pins and separate current-page rows', () => {
  const text = `[警告] : 元件的属性与供应商编号不匹配。，建议使用器件标准化: P1($1I1),R1($1I2)
[警告] : 发现元件引脚悬空，建议放置非连接标识在引脚上 : P1.A1,U9.2
[错误] : 元件 OLD-CONN 的引脚与焊盘未对应: $2I403
[信息] : 完成设计规则检查。 致命错误： 0, 错误：1，警告：2，信息：0。`;
  const rows = parseDrcDiagnosticRows(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].designatorPins, [
    { designator: 'P1', pin: 'A1' }, { designator: 'U9', pin: '2' },
  ]);
  const attributed = attributeDrcRows(rows, {
    designators: ['P1', 'R1'], componentNames: ['NEW-CONN'],
  });
  assert.equal(attributed[0].scope, 'current-page');
  assert.equal(attributed[1].scope, 'mixed-pages');
  assert.equal(attributed[2].scope, 'other-page');
  assert.equal(currentPageDrcMagnitude(attributed), 3);
});
