// Source-only transaction; invoke through wf.mjs so artifacts stay outside the repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeCode } from './engine/bridge_client.mjs';
import { assertSource } from './assert_source.mjs';
import { evaluateSourceAudit } from './engine/drc_result.mjs';
import { readRecords, checkSourceIdentity, compileSourcePlan, verifyPersistedSource, planRollbackResidueCleanup, auditRepairScope, stableSourceContent } from './engine/source_transaction.mjs';
import { runLiveJudge } from './engine/commercial_judge.mjs';
import { evaluateDeliveryGate, loadDeliveryEvidence, summarizeCommitVerification } from './engine/delivery_gate.mjs';
import { formatActionableQueue } from './engine/actionable_report.mjs';
import { loadAndVerifyWorkflowReceipt } from './engine/workflow_receipt.mjs';
import { runCandidatePreflight } from './engine/candidate_preflight.mjs';

async function main() {
  if (!process.argv[2]) throw new Error('用法: node wf.mjs commit <transform.mjs>');
  const transform = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).default;
  if (typeof transform !== 'function') throw new Error('变换必须导出函数');
  const { result: initial } = await executeCode('return await eda.dmt_SelectControl.getCurrentDocumentInfo();', {timeoutMs:15000});
  if (!initial?.uuid || initial.documentType !== 1 ||
      (process.env.EASYEDA_DOCUMENT_UUID && process.env.EASYEDA_DOCUMENT_UUID !== initial.uuid))
    throw new Error('当前文档与指定原理图身份不一致');
  const uuid = initial.uuid;
  const tokenEvidence = loadDeliveryEvidence(process.env.EASYEDA_TOKEN_EVIDENCE);
  const windowId = process.env.EASYEDA_WINDOW_ID || '';
  const guard = `const d=await eda.dmt_SelectControl.getCurrentDocumentInfo(); if(d?.uuid!==${JSON.stringify(uuid)}||d.documentType!==1) throw new Error('Document identity changed');`;
  const guarded = async (code, timeoutMs=25000) => {
    const { result } = await executeCode(`{${guard}} const value=await(async()=>{${code}})(); {${guard}} return value;`, {timeoutMs,writeContext:'source-transaction'});
    return result;
  };
  const snapshot = async () => {
    const result = await guarded(`const source=await eda.sys_FileManager.getDocumentSource(); const components=await eda.sch_PrimitiveComponent.getAll(); const owners=[]; for(const c of components){if(c.componentType==='sheet')continue; const pins=await c.getAllPins(); if(!Array.isArray(pins))throw new Error('Cannot verify pin ownership'); for(const p of pins)owners.push([p.primitiveId,c.primitiveId]);} return {source,types:components.map(c=>[c.primitiveId,c.componentType]),owners};`,40000);
    checkSourceIdentity(result?.source, uuid);
    if (!Array.isArray(result.types)) throw new Error('无法核验组件类型');
    return { source: result.source, componentTypes: Object.fromEntries(result.types), pinOwners:Object.fromEntries(result.owners) };
  };
  const before = await snapshot();
  loadAndVerifyWorkflowReceipt({receiptPath:process.env.EASYEDA_PREFLIGHT_RECEIPT,
    contextPath:process.env.EASYEDA_WORKFLOW_CONTEXT,tokenEvidencePath:process.env.EASYEDA_TOKEN_EVIDENCE,
    repo:process.env.EASYEDA_RULE_REPO || path.dirname(new URL(import.meta.url).pathname),documentUuid:uuid,source:before.source});
  const plan = await transform(readRecords(before.source));
  const beforeTokenEvidence = plan.tokenEvidenceBefore ?? tokenEvidence;
  const afterTokenEvidence = plan.tokenEvidenceAfter ?? tokenEvidence;
  const transactionPinOwners = {...before.pinOwners,...(plan.pinOwners??{})};
  const transactionComponentTypes = {...before.componentTypes,...(plan.componentTypes??{})};
  const compiled = compileSourcePlan(before.source, plan, {
    pinOwners:transactionPinOwners,
    strictPrimitiveIds:true,
    componentTypes:transactionComponentTypes,
    allowSheetEdit:plan.allowSheetEdit === true,
  });
  checkSourceIdentity(compiled.source, uuid);
  const pre = assertSource(compiled.source, {componentTypes:transactionComponentTypes});
  const repair = process.env.EASYEDA_REPAIR_STAGE === '1';
  let stagePre = null;
  if (repair) {
    if (!plan.stage?.name || typeof plan.validate !== 'function') throw new Error('逐模块修复需要模块范围与候选验证器');
    const scope = auditRepairScope(before.source,compiled.source,plan.stage.roots,transactionPinOwners);
    stagePre = assertSource(scope.scopedSource,{componentTypes:before.componentTypes});
    if (stagePre.findings.length) throw new Error('修复模块自身仍有源级 finding');
    // The private transform validates the exact compiled source against its
    // pin/geometry/page model; an unexecuted or unknown result is not a pass.
    const evidence = await plan.validate(compiled.source);
    if (evidence?.pass !== true) throw new Error('修复模块几何、接线或图框候选检查未通过');
    writeFileSync('repair-stage-preflight.json',JSON.stringify({module:plan.stage.name,scope,source:stagePre,evidence,wholeSheetSource:pre,deliveryVerified:false},null,2));
  }
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  writeFileSync(`candidate_${stamp}.txt`, compiled.source);
  writeFileSync(`candidate_${stamp}.json`, JSON.stringify({document:initial,note:plan.note,pre,
    removed:compiled.removed,edited:compiled.edited,added:compiled.added},null,2));
  if (!repair && pre.findings.length) throw new Error(`写前断言 ${pre.findings.length} 项——未写入原理图`);
  const beforeGateDir = path.resolve(`gate_before_${stamp}`);
  mkdirSync(beforeGateDir,{recursive:true});
  const beforeGate = await runLiveJudge({windowId,outDir:beforeGateDir,captureCanvas:false,...beforeTokenEvidence});
  writeFileSync('last-gate-before.json',JSON.stringify(beforeGate,null,2));
  const candidatePreflight = await runCandidatePreflight({candidateSource:compiled.source,baselineSource:before.source,plan,baselineReport:beforeGate,
    tokenEvidence:afterTokenEvidence,componentTypes:transactionComponentTypes,pinOwners:transactionPinOwners});
  writeFileSync(`candidate-preflight_${stamp}.json`,JSON.stringify(candidatePreflight,null,2));
  writeFileSync('last-candidate-preflight.json',JSON.stringify(candidatePreflight,null,2));
  if (!candidatePreflight.pass) {
    for (const line of formatActionableQueue(candidatePreflight)) console.error(line);
    throw new Error(`候选写前完整裁判失败: ${candidatePreflight.prewriteGate.problems.join('; ')}`);
  }
  writeFileSync(`archive_src_${stamp}.txt`, before.source);
  console.log(`变换 ${plan.note || ''}: 删 ${compiled.removed.length} 改 ${compiled.edited.length} 新增 ${compiled.added.length}`);
  await guarded(`const current=await eda.sys_FileManager.getDocumentSource(); const stable=${stableSourceContent.toString()}; if(stable(current)!==${JSON.stringify(stableSourceContent(before.source))}) throw new Error('Source changed since snapshot'); {${guard}} if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(compiled.source)})!==true) throw new Error('setDocumentSource failed'); {${guard}} if(await eda.sch_Document.save()!==true) throw new Error('save failed'); return true;`,40000);
  // Saving resolves before the desktop client has necessarily flushed its
  // document mutation queue. Closing immediately can reopen the server copy and
  // resurrect records that were just deleted. Give the official save path time
  // to settle, then rely on the existing close/reopen/readback verification.
  await new Promise(resolve => setTimeout(resolve, 3000));
  const tab = await guarded('return (await eda.dmt_SelectControl.getCurrentDocumentInfo()).tabId;',15000);
  if (!tab) throw new Error('保存后没有有效标签 ID');
  const closed = await executeCode(`{${guard}} return await eda.dmt_EditorControl.closeDocument(${JSON.stringify(tab)});`, {timeoutMs:15000});
  if (closed.result !== true) throw new Error('保存后关闭失败，不能声称已完成重载验证');
  const opened = await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(uuid)});`, {timeoutMs:20000});
  if (typeof opened.result !== 'string' || !opened.result) throw new Error('重开原理图失败');
  const restoreBefore = async reason => {
    await guarded(`if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(before.source)})!==true) throw new Error('rollback setDocumentSource failed'); if(await eda.sch_Document.save()!==true) throw new Error('rollback save failed'); return true;`,40000);
    await new Promise(resolve => setTimeout(resolve,3000));
    const rollbackTab = await guarded('return (await eda.dmt_SelectControl.getCurrentDocumentInfo()).tabId;',15000);
    if (!rollbackTab) throw new Error(`提交失败且回滚时没有有效标签: ${reason}`);
    if ((await executeCode(`{${guard}} return await eda.dmt_EditorControl.closeDocument(${JSON.stringify(rollbackTab)});`,{timeoutMs:15000})).result!==true)
      throw new Error(`提交失败且回滚关闭文档失败: ${reason}`);
    const reopened = await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(uuid)});`,{timeoutMs:20000});
    if (typeof reopened.result!=='string'||!reopened.result) throw new Error(`提交失败且回滚重开文档失败: ${reason}`);
    let restored = await snapshot();
    let verification = verifyPersistedSource(before.source,restored.source,uuid),cleanup=null;
    if(!verification.pass){
      const cleanupPlan=planRollbackResidueCleanup(before.source,restored.source,uuid);
      if(cleanupPlan.pass&&cleanupPlan.drop.size){
        const cleaned=compileSourcePlan(restored.source,cleanupPlan,{pinOwners:restored.pinOwners,componentTypes:restored.componentTypes});
        await guarded(`const current=await eda.sys_FileManager.getDocumentSource(); const stable=${stableSourceContent.toString()}; if(stable(current)!==${JSON.stringify(stableSourceContent(restored.source))}) throw new Error('Rollback residue source changed'); if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(cleaned.source)})!==true) throw new Error('rollback residue cleanup failed'); if(await eda.sch_Document.save()!==true) throw new Error('rollback residue save failed'); return true;`,40000);
        await new Promise(resolve=>setTimeout(resolve,3000));
        const cleanupTab=await guarded('return (await eda.dmt_SelectControl.getCurrentDocumentInfo()).tabId;',15000);
        if(!cleanupTab||(await executeCode(`{${guard}} return await eda.dmt_EditorControl.closeDocument(${JSON.stringify(cleanupTab)});`,{timeoutMs:15000})).result!==true)
          throw new Error(`提交失败且回滚残留清理无法关闭文档: ${reason}`);
        const cleanupOpened=await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(uuid)});`,{timeoutMs:20000});
        if(typeof cleanupOpened.result!=='string'||!cleanupOpened.result)throw new Error(`提交失败且回滚残留清理无法重开文档: ${reason}`);
        restored=await snapshot();verification=verifyPersistedSource(before.source,restored.source,uuid);
        cleanup={removed:[...cleanupPlan.drop],verification};
      }
    }
    writeFileSync('last-rollback-verification.json',JSON.stringify({reason,verification,cleanup},null,2));
    if (!verification.pass) throw new Error(`提交失败且自动回滚复读不一致: ${reason}`);
    throw new Error(`${reason}；已自动回滚并复读确认`);
  };
  try {
    const after = await snapshot();
    writeFileSync('last_commit_after.txt', after.source);
    const persistence = verifyPersistedSource(compiled.source, after.source, uuid);
    const post = assertSource(after.source, {componentTypes:after.componentTypes});
    const stagePost = repair ? assertSource(auditRepairScope(before.source,after.source,plan.stage.roots,{...transactionPinOwners,...after.pinOwners}).scopedSource,{componentTypes:after.componentTypes}) : null;
    const drcEvidence = await guarded(`const lines=()=>((document.body&&document.body.innerText)||'').split('\\n').filter(x=>/完成设计规则检查|design rule check/i.test(x)); let changed=false; const observer=new MutationObserver(()=>{changed=true}); observer.observe(document.body,{childList:true,subtree:true,characterData:true}); const raw=await eda.sch_Drc.check(true,true,true); let now=lines(); for(let i=0;i<20&&!now.length;i++){await new Promise(r=>setTimeout(r,100));now=lines();} observer.disconnect(); return {raw,completion:now.at(-1)||'',fresh:changed&&now.length>0,invoked:true};`,40000);
    const rawDrc = drcEvidence.raw;
    const audit = evaluateSourceAudit(post, rawDrc, drcEvidence);
    const afterGateDir = path.resolve(`gate_after_${stamp}`);
    mkdirSync(afterGateDir,{recursive:true});
    const afterGate = await runLiveJudge({windowId,outDir:afterGateDir,captureCanvas:!repair,...afterTokenEvidence});
    const deliveryGate = evaluateDeliveryGate(afterGate,{before:beforeGate,repair});
    const verification = summarizeCommitVerification({persistence,sourceAudit:audit,afterReport:afterGate,deliveryGate,repair,stagePost});
    writeFileSync('last-commit-verification.json',JSON.stringify({document:initial,persistence,source:post,stagePre,stagePost,rawDrc,drcEvidence,
      ...audit,...verification,drc:verification.currentPageDrc,beforeGate,afterGate,deliveryGate},null,2));
    if (!persistence.pass) throw new Error(`保存重开后有 ${persistence.findings.length} 项与候选不符`);
    if (repair && stagePost.findings.length) throw new Error('修复模块源级检查未通过');
    if (!repair && !audit.sourcePass) throw new Error('源级检查未通过');
    // sch_Drc.check returns project-wide totals, including the preserved backup
    // page. runLiveJudge attributes every native diagnostic to a page and fails
    // closed if that attribution is incomplete, so the active-page tier is the
    // correct transaction gate here.
    if (!repair && afterGate.tier1?.conform !== true) throw new Error('当前页原生 DRC 未通过');
    if (repair && !audit.drc.verified) throw new Error('原生 DRC 返回不完整或未识别');
    if (!deliveryGate.pass) {
      for (const line of formatActionableQueue(afterGate)) console.error(line);
      throw new Error(`商业化硬门禁失败: ${deliveryGate.problems.join('; ')}`);
    }
    if (deliveryGate.accepted) console.log('持久化、源级断言、完整 token、原生 DRC 与新画布证据全部通过。');
    else console.log(`修复棘轮通过: 偏离 ${deliveryGate.beforeDeviationCount} → ${deliveryGate.afterDeviationCount}；当前页仍未验收。`);
  } catch (error) {
    await restoreBefore(error.message);
  }
}
main().catch(e => { console.error('FAIL:',e.message); process.exitCode=1; });
