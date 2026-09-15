#!/usr/bin/env node
// compile.mjs — 编译器前门（Q15）：写变换的瞬间，秒级出全量缺陷清单。
//   node compile.mjs <transform.mjs> [--artifact-dir <dir>] [--token-evidence <evidence.json>]
// 栈（全离线，零 bridge / 零 DRC / 零写入）：
//   transform → compileSourcePlan → assertSource → candidate twin → judgeTokens → deliveryGate
// 每条输出带规则 / 对象 / 坐标 / 期望 vs 实际；任一阶段失败即打印 FAIL[阶段] 并退出非零。
// 工件默认取 --artifact-dir（或 EASYEDA_ARTIFACT_DIR，再退 ~/.local/share/easyeda-harness/workflow）：
//   last_commit_after.txt            基线源（wf check/commit 自动刷新）
//   last-commit-verification.json    最近一次 commit 的 afterGate（基线几何/网表/DRC 证据）
//   workflow-check.json              componentTypes
//   pin-owners.json                  引脚归属
// 证据：EASYEDA_TOKEN_EVIDENCE 必填（--token-evidence 可覆盖）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readRecords, compileSourcePlan } from './engine/source_transaction.mjs';
import { assertSource } from './assert_source.mjs';
import { runCandidatePreflight } from './engine/candidate_preflight.mjs';
import { loadDeliveryEvidence } from './engine/delivery_gate.mjs';
import { formatActionableQueue } from './engine/actionable_report.mjs';

const args = process.argv.slice(2);
const transformPath = args.find(a => !a.startsWith('--'));
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const artifactDir = path.resolve(flag('--artifact-dir') || process.env.EASYEDA_ARTIFACT_DIR
  || path.join(homedir(), '.local/share/easyeda-harness/workflow'));
const evidenceFile = flag('--token-evidence') || process.env.EASYEDA_TOKEN_EVIDENCE;

if (!transformPath) {
  console.error('用法: node compile.mjs <transform.mjs> [--artifact-dir <dir>] [--token-evidence <evidence.json>]');
  process.exit(2);
}
const t0 = Date.now();
let stage = '启动';
const fail = msg => { console.error(`FAIL[${stage}] (${Date.now() - t0}ms): ${msg}`); process.exit(1); };
try {
  stage = '读取基线源';
  const sourcePath = path.join(artifactDir, 'last_commit_after.txt');
  const baselineSource = readFileSync(sourcePath, 'utf8');

  stage = '读取基线证据';
  const verification = JSON.parse(readFileSync(path.join(artifactDir, 'last-commit-verification.json'), 'utf8'));
  const baselineReport = verification.afterGate || verification.live;
  if (!baselineReport?.geometryArtifact || !baselineReport?.netlistArtifact)
    fail('last-commit-verification.json 缺 afterGate 几何/网表工件——先跑一次 wf check 生成基线');
  const check = JSON.parse(readFileSync(path.join(artifactDir, 'workflow-check.json'), 'utf8'));
  const componentTypes = check.componentTypes || {};
  const pinOwners = JSON.parse(readFileSync(path.join(artifactDir, 'pin-owners.json'), 'utf8'));
  if (!evidenceFile) fail('缺少 token 证据：设 EASYEDA_TOKEN_EVIDENCE=<私有 evidence.json> 或传 --token-evidence');
  const tokenEvidence = loadDeliveryEvidence(evidenceFile);

  stage = '执行变换';
  const transform = (await import(pathToFileURL(path.resolve(transformPath)).href)).default;
  if (typeof transform !== 'function') fail('变换必须导出 default 函数');
  const plan = await transform(readRecords(baselineSource));
  console.log(`✓ 变换 ${plan?.note || ''}：删 ${plan?.drop?.size ?? 0} 改 ${plan?.edit?.size ?? 0} 增 ${plan?.add?.length ?? 0} (${Date.now() - t0}ms)`);

  stage = '编译候选源';
  const compiled = compileSourcePlan(baselineSource, plan, {
    pinOwners, strictPrimitiveIds: true, componentTypes, allowSheetEdit: plan.allowSheetEdit === true,
  });
  console.log(`✓ 编译通过 (${Date.now() - t0}ms)`);

  stage = '源级断言 A1-A10';
  const pre = assertSource(compiled.source, { componentTypes });
  for (const f of pre.findings) console.log(`  [${f.sev}] ${f.rule}: ${f.detail}`);
  if (pre.findings.length) console.log(`✗ 源级断言 ${pre.findings.length} 项（见上，逐条修复后再试）`);

  stage = '候选写前全量裁判（twin + token + delivery）';
  const afterTokenEvidence = plan?.tokenEvidenceAfter ?? tokenEvidence;
  const preflight = await runCandidatePreflight({
    candidateSource: compiled.source, baselineSource, plan, baselineReport, tokenEvidence: afterTokenEvidence, componentTypes, pinOwners,
  });
  for (const line of formatActionableQueue(preflight)) console.log(line);
  const gate = preflight.prewriteGate;
  if (!preflight.pass) {
    console.log(`✗ 写前门禁未过 (${Date.now() - t0}ms)：${gate?.problems?.join('; ')}`);
    process.exit(1);
  }
  console.log(`✓ 写前门禁全绿 (${Date.now() - t0}ms)——候选可提交：wf check → wf commit ${path.resolve(transformPath)}`);
} catch (e) {
  fail(e.message);
}
