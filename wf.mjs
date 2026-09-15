#!/usr/bin/env node
// wf.mjs — 原理图商业化工作流唯一入口(源级管线)。
//   node wf.mjs lint               读源 → 完整确定性 token + DRC + 根因队列（不截图）
//   node wf.mjs check              lint 的兼容名称
//   node wf.mjs audit              最终取证：确定性门禁 + 一次整图截图
//   node wf.mjs render [out.png]   源→模型→渲染(对齐感知真标签)
//   node wf.mjs commit <t.mjs>     srccommit(写前/复读双断言已内建)
//   node wf.mjs api <p.mjs>        API 图元事务(同样备份/重载/棘轮/回滚)
//   node wf.mjs quick <t.mjs>      ≤25件板 lint→compile→单次提交→单次最终截图
//   node wf.mjs runbook            打印 SOP
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeCode } from './engine/bridge_client.mjs';
import { assertSource, parseSource } from './assert_source.mjs';
import { evaluateSourceAudit, parseDrcDiagnosticRows, attributeDrcRows, currentPageDrcMagnitude } from './engine/drc_result.mjs';
import { runLiveJudge } from './engine/commercial_judge.mjs';
import { evaluateDeliveryGate, loadDeliveryEvidence } from './engine/delivery_gate.mjs';
import { buildWorkflowContext, formatActionableQueue } from './engine/actionable_report.mjs';
import { createWorkflowReceipt, resolveTokenEvidencePath } from './engine/workflow_receipt.mjs';

const repo = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(process.env.EASYEDA_ARTIFACT_DIR || path.join(homedir(), '.local/share/easyeda-harness/workflow'));
const receiptPath = path.join(outDir, 'workflow-preflight-receipt.json');
const contextPath = path.join(outDir, 'workflow-context.json');
let workflowWindowId = process.env.EASYEDA_WINDOW_ID || '';
async function runCode(code, options = {}) {
  const response = await executeCode(code, { ...options, windowId: workflowWindowId });
  const actual = String(response.body?.windowId || '');
  if (!workflowWindowId) {
    if (!actual) throw new Error('bridge 回包缺少 windowId，无法锁定 EasyEDA 窗口');
    workflowWindowId = actual;
    process.env.EASYEDA_WINDOW_ID = actual;
  } else if (actual !== workflowWindowId) throw new Error(`EasyEDA 窗口漂移: ${workflowWindowId} -> ${actual || '<missing>'}`);
  return response;
}
function prepareArtifacts() {
  const guard = dir => {
    const rel = path.relative(realpathSync(repo), dir);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)))
      throw new Error('EASYEDA_ARTIFACT_DIR 必须位于公共仓库之外');
  };
  guard(outDir);
  mkdirSync(outDir, { recursive: true });
  guard(realpathSync(outDir));
}

async function activate() {
  const d = await runCode('return await eda.dmt_SelectControl.getCurrentDocumentInfo();', { timeoutMs: 15000 });
  if (!d.result?.uuid || d.result.documentType !== 1) throw new Error(`活动文档非原理图(窗口 ${workflowWindowId || '<unknown>'}，先在 EDA 打开原理图页): ${JSON.stringify(d.result ?? null)}`);
  if (process.env.EASYEDA_DOCUMENT_UUID && d.result.uuid !== process.env.EASYEDA_DOCUMENT_UUID)
    throw new Error('活动文档与指定 EASYEDA_DOCUMENT_UUID 不一致');
  return d.result;
}
async function readSrc() {
  const doc = await activate();
  const r = await runCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 25000 });
  const head = typeof r.result === 'string' && parseSource(r.result).find(x => x.head.type === 'DOCHEAD')?.atom;
  if (head?.docType !== 'SCH_PAGE' || head.uuid !== doc.uuid) throw new Error('原理图源与活动文档身份不一致');
  if ((await activate()).uuid !== doc.uuid) throw new Error('读取过程中活动文档改变');
  const { result: componentEvidence } = await runCode('const components=await eda.sch_PrimitiveComponent.getAll();const owners=[];for(const c of components){if(c.componentType==="sheet")continue;for(const p of await c.getAllPins()||[])owners.push([p.primitiveId,c.primitiveId]);}return {components:components.map(c=>({id:c.primitiveId,type:c.componentType})),owners};', { timeoutMs: 25000 });
  const components=componentEvidence?.components;
  if (!Array.isArray(components)) throw new Error('无法核验组件类型');
  if (!Array.isArray(componentEvidence.owners)) throw new Error('无法核验虚拟引脚归属');
  return { src: r.result, doc, componentTypes: Object.fromEntries(components.map(c => [c.id, c.type])),pinOwners:Object.fromEntries(componentEvidence.owners) };
}

const RUNBOOK = `原理图商业化工作流 SOP(源级管线)
================================
0. 铁律: 已有电路修改走 \`wf commit\`。未载入库的新器件仅经 \`wf seed\` 添加；仅当源格式不能实例化图元时走 \`wf api\`。直接 bridge 写入被程序阻断。
1. 首次对一个文档运行时设置 \`EASYEDA_TOKEN_EVIDENCE=/绝对路径/evidence.json\`；成功 lint 后路径绑定到外部回执和上下文，后续命令自动恢复。证据必须声明完整模块、子区、图框和标题栏几何。
2. 一次完整取证后按模块批量形成修复计划；同一批内不重复运行全套检查，修复提交只跑确定性源码/网表/bbox/token/DRC。
3. 定位缺陷 → 调用通用参数化单元生成变换；写前门从编译后的完整候选源自动构造 source twin，裸 recs/私有 pass:true 不能绕过裁判。
4. \`node wf.mjs render\`    —— 源模型预览；live 硬门禁仍以完整真实几何为准。
5. \`node wf.mjs commit t_xxx.mjs\` —— 写盘前先核对候选源/几何/网表覆盖并跑完整 token 棘轮；红候选不碰 live。写后只做 save/reload、原生 DRC 和最终验收；失败自动回滚并复读。
6. \`node wf.mjs lint\`      —— 每个修复批次读完整实时几何、权威网表、实时绑定封装并运行 DRC；只输出根因队列，不截图（\`check\` 为兼容名称）。
7. \`node wf.mjs audit\`     —— 确定性项全绿后只截一次整图做残余视觉复核；任一失败即状态“未完成”，必须返回修复队列继续收敛。
8. 新教训 → 通用断言或 token 检查加一条测试(棘轮,只增不减)。
9. \`node wf.mjs quick t.mjs\` —— ≤25 件小板的一键轨道；允许红 lint 作为修复基线，compile 红则零写入，提交后只在最终 audit 截一次图。
布局语法基线: 10 间距信号列=同侧单列标签(文字贴线下);连接器双侧各自线下;电源密集列=支线+轨名,轨源端用旗标。`;

const [cmd, ...args] = process.argv.slice(2);
try {
  if (['lint', 'check', 'audit', 'render', 'commit', 'seed', 'api', 'pcb-sync', 'quick'].includes(cmd)) prepareArtifacts();
  if (cmd === 'lint' || cmd === 'check' || cmd === 'audit') {
    const { src, doc, componentTypes, pinOwners } = await readSrc();
    const tokenEvidencePath = resolveTokenEvidencePath({ explicitPath:process.env.EASYEDA_TOKEN_EVIDENCE,
      receiptPath, contextPath, documentUuid:doc.uuid });
    const tokenEvidence = loadDeliveryEvidence(tokenEvidencePath);
    writeFileSync(path.join(outDir, 'last_commit_after.txt'), src);
    const pinOwnersPath=path.join(outDir,'pin-owners.json');
    writeFileSync(pinOwnersPath,JSON.stringify(pinOwners,null,2));
    const r = assertSource(src, { componentTypes });
    console.log(r.summary);
    for (const f of r.findings.slice(0, 15)) console.log(` [${f.sev}] ${f.rule}: ${f.detail}`);
    const drc = await runCode(`const text=()=>((document.body&&document.body.innerText)||''); const lines=()=>text().split('\\n').filter(x=>/完成设计规则检查|design rule check/i.test(x)); let changed=false; const observer=new MutationObserver(()=>{changed=true}); observer.observe(document.body,{childList:true,subtree:true,characterData:true}); const raw=await eda.sch_Drc.check(true,true,true); let now=lines(); for(let i=0;i<20&&!now.length;i++){await new Promise(r=>setTimeout(r,100));now=lines();} const diagnosticText=text().split('\\n').filter(x=>/^\\s*\\[(?:致命错误|错误|警告|信息|fatal error|error|warning|info)\\]\\s*:/i.test(x)).join('\\n'); observer.disconnect(); return {raw,completion:now.at(-1)||'',diagnosticText,fresh:changed&&now.length>0,invoked:true};`, { timeoutMs: 25000 });
    if ((await activate()).uuid !== doc.uuid) throw new Error('DRC 检查期间活动文档改变');
    const report = evaluateSourceAudit(r, drc.result?.raw, drc.result);
    const finalAudit = cmd === 'audit';
    const live = await runLiveJudge({windowId:workflowWindowId,outDir:path.join(outDir,finalAudit?'audit-live':'check-live'),captureCanvas:finalAudit,
      verifiedDrc:{...report.drc,diagnosticText:drc.result?.diagnosticText||''},...tokenEvidence});
    const diagnosticText = drc.result?.diagnosticText || live.drc?.diagnosticText || '';
    const completeGeometry = JSON.parse(readFileSync(live.geometryArtifact, 'utf8'));
    const componentNames = (completeGeometry.components || []).map(c => c.name).filter(Boolean);
    const designators = (completeGeometry.components || []).map(c => c.designator).filter(Boolean);
    if (live.drc) {
      live.drc.diagnosticText = diagnosticText;
      live.drc.diagnosticRows = attributeDrcRows(parseDrcDiagnosticRows(diagnosticText), { designators, componentNames });
      live.drc.currentPageMagnitude = currentPageDrcMagnitude(live.drc.diagnosticRows);
    }
    const geometryPass = live.coverage?.complete === true && live.tier2?.every(x=>x.conform===true);
    const deterministicPass = report.sourcePass && geometryPass && live.tier1?.conform === true;
    const deliveryGate = finalAudit ? evaluateDeliveryGate(live) : null;
    const pass = finalAudit ? report.sourcePass && deliveryGate.pass : deterministicPass;
    const outputName = finalAudit ? 'workflow-audit.json' : cmd === 'lint' ? 'workflow-lint.json' : 'workflow-check.json';
    const outputPath = path.join(outDir, outputName);
    const auditRecord = { time: new Date().toISOString(), windowId:workflowWindowId, document: doc, componentTypes, pinOwners, source: r, rawDrc: drc.result?.raw, drcEvidence:drc.result, ...report,live,geometryPass,deterministicPass,deliveryGate,pass };
    writeFileSync(outputPath, JSON.stringify(auditRecord, null, 2));
    // A clean read-only check is the authoritative baseline for the next
    // offline compile. This also replaces stale failed-commit evidence after
    // a verified rollback, so compile never carries forward the rejected DRC.
    if (!finalAudit && pass) writeFileSync(path.join(outDir, 'last-commit-verification.json'), JSON.stringify({
      document:doc,persistence:{pass:true,findings:[]},source:r,sourcePass:report.sourcePass,
      drc:report.drc,afterGate:live,live,
    }, null, 2));
    const context = buildWorkflowContext({ document: doc, sourceAudit: report, live, artifacts: {
      source: path.join(outDir, 'last_commit_after.txt'), geometry: live.geometryArtifact, netlist: live.netlistArtifact,
      pinOwners:pinOwnersPath, report: outputPath, context: contextPath, tokenEvidence:tokenEvidencePath,
    } });
    writeFileSync(contextPath, JSON.stringify(context, null, 2));
    const tokenEvidenceText = readFileSync(tokenEvidencePath, 'utf8').replace(/^\uFEFF/, '');
    const receipt = createWorkflowReceipt({ repo, documentUuid:doc.uuid, source:src,
      contextText:JSON.stringify(context, null, 2), tokenEvidenceText, tokenEvidencePath });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    console.log(report.drc.verified ? `DRC: ${JSON.stringify(report.drc.counts)}` : 'DRC 返回未验证，不能认定为零');
    console.log(`结构化几何: ${geometryPass ? '通过' : '失败'}；token 覆盖 ${live.coverage?.checked ?? '?'} / ${live.coverage?.expected ?? '?'}；截图 ${live.shots?.length ?? 0} 张`);
    for (const line of formatActionableQueue(live)) console.log(line);
    if (finalAudit) console.log(pass ? '源级、完整 token、原生 DRC 与一次新画布证据全部通过。' : `✗ 审计未通过——禁止交付: ${deliveryGate.problems.join('; ')}`);
    else console.log(pass ? '源级、完整 token 与原生 DRC 确定性检查全部通过（未截图）。' : '✗ 确定性检查未通过——保持修复状态。');
    console.log(`记录: ${outputPath}`);
    console.log(`AI 上下文: ${contextPath}`);
    console.log(`写入凭据: ${receiptPath}`);
    process.exitCode = pass ? 0 : 1;
  } else if (cmd === 'render') {
    const modelPath = path.join(outDir, 'src_model.json');
    execFileSync(process.execPath, [path.join(repo, 'src2model.mjs'), path.join(outDir, 'last_commit_after.txt'), modelPath], { cwd: outDir, stdio: 'inherit' });
    const { renderSheetOutput } = await import('./engine/sheet_renderer.mjs');
    const output = path.resolve(outDir, args[0] || 'wf_render.png');
    renderSheetOutput(JSON.parse(readFileSync(modelPath, 'utf8')), output, {});
    console.log(`源模型预览（非完整验收）: ${output}`);
  } else if (cmd === 'commit') {
    if (!args[0]) throw new Error('用法: wf commit <transform.mjs>');
    const doc = await activate();
    const tokenEvidencePath = resolveTokenEvidencePath({ explicitPath:process.env.EASYEDA_TOKEN_EVIDENCE,
      receiptPath, contextPath, documentUuid:doc.uuid });
    execFileSync(process.execPath, [path.join(repo, 'srccommit.mjs'), path.resolve(args[0])], { cwd: outDir, stdio: 'inherit', env: { ...process.env, EASYEDA_DOCUMENT_UUID: doc.uuid,
      EASYEDA_TOKEN_EVIDENCE:tokenEvidencePath, EASYEDA_PREFLIGHT_RECEIPT:receiptPath, EASYEDA_WORKFLOW_CONTEXT:contextPath, EASYEDA_RULE_REPO:repo } });
  } else if (cmd === 'seed') {
    if (!args[0]) throw Error('Usage: wf seed <private-device-manifest.json>');
    const doc = await activate();
    process.env.EASYEDA_TOKEN_EVIDENCE = resolveTokenEvidencePath({ explicitPath:process.env.EASYEDA_TOKEN_EVIDENCE,
      receiptPath, contextPath, documentUuid:doc.uuid });
    const {seedDevices} = await import('./engine/seed_devices.mjs');
    await seedDevices(path.resolve(args[0]), doc.uuid, outDir, {repo,receiptPath,contextPath});
  } else if (cmd === 'api') {
    if (!args[0]) throw Error('Usage: wf api <private-plan.mjs>');
    const doc=await activate();
    process.env.EASYEDA_TOKEN_EVIDENCE = resolveTokenEvidencePath({ explicitPath:process.env.EASYEDA_TOKEN_EVIDENCE,
      receiptPath, contextPath, documentUuid:doc.uuid });
    const {runApiTransaction}=await import('./engine/api_transaction.mjs');
    await runApiTransaction(path.resolve(args[0]),{outDir,documentUuid:doc.uuid,windowId:workflowWindowId,repo,
      receiptPath,contextPath});
  } else if (cmd === 'pcb-sync') {
    const pcbFlag=args.indexOf('--pcb');
    const pcbUuid=pcbFlag>=0?args[pcbFlag+1]:(args.find(x=>!x.startsWith('--'))||'');
    const doc=await activate();
    const tokenEvidencePath=resolveTokenEvidencePath({explicitPath:process.env.EASYEDA_TOKEN_EVIDENCE,
      receiptPath,contextPath,documentUuid:doc.uuid});
    const {syncPcbFromSchematic}=await import('./engine/pcb_sync_transaction.mjs');
    await syncPcbFromSchematic({pcbUuid,outDir,windowId:workflowWindowId,repo,
      receiptPath,contextPath,tokenEvidencePath,
      footprintMapPath:(()=>{const i=args.indexOf('--footprint-map');return i>=0?args[i+1]:'';})()});
  } else if (cmd === 'quick') {
    if (!args[0]) throw Error('Usage: wf quick <transform.mjs>');
    const {runQuickWorkflow}=await import('./engine/quick_workflow.mjs');
    const result=runQuickWorkflow({repo,artifactDir:outDir,transformPath:path.resolve(args[0])});
    console.log(`quick 完成：${result.fitted} 件，${result.steps.join(' → ')}`);
  } else if (cmd === 'runbook') {
    console.log(RUNBOOK);
  } else {
    console.log('用法: node wf.mjs lint | check | audit | render [out.png] | commit <t.mjs> | api <private-plan.mjs> | quick <transform.mjs> | seed <private-device-manifest.json> | pcb-sync --pcb <uuid> [--footprint-map file.json] | runbook');
  }
} catch (e) { console.error('FAIL:', e.message); process.exit(1); }
