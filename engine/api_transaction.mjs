import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {executeCode} from './bridge_client.mjs';
import {assertSource} from '../assert_source.mjs';
import {compileSourcePlan,readRecords,stableSourceContent,verifyPersistedSource,checkSourceIdentity} from './source_transaction.mjs';
import {runLiveJudge} from './commercial_judge.mjs';
import {evaluateDeliveryGate,loadDeliveryEvidence} from './delivery_gate.mjs';
import {formatActionableQueue} from './actionable_report.mjs';
import {loadAndVerifyWorkflowReceipt} from './workflow_receipt.mjs';

export async function runApiTransaction(planFile,{outDir,documentUuid,windowId='',repo,receiptPath,contextPath}={}){
  if(!planFile)throw Error('wf api requires a plan module');
  const factory=(await import(pathToFileURL(path.resolve(planFile)).href)).default;
  if(typeof factory!=='function')throw Error('API plan must export a function');
  mkdirSync(outDir,{recursive:true});
  const initial=(await executeCode('return await eda.dmt_SelectControl.getCurrentDocumentInfo();',{timeoutMs:15000})).result;
  if(!initial?.uuid||initial.documentType!==1||initial.uuid!==documentUuid)throw Error('API transaction document mismatch');
  const guard=`const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(d?.uuid!==${JSON.stringify(documentUuid)}||d.documentType!==1)throw Error('Document identity changed');`;
  const read=async()=>{
    const r=(await executeCode(`${guard}const source=await eda.sys_FileManager.getDocumentSource();const cs=await eda.sch_PrimitiveComponent.getAll();const owners=[];for(const c of cs){const ps=await c.getAllPins();for(const p of ps||[])owners.push([p.primitiveId,c.primitiveId]);}return {source,types:cs.map(c=>[c.primitiveId,c.componentType]),owners};`,{timeoutMs:40000})).result;
    checkSourceIdentity(r.source,documentUuid);return{source:r.source,componentTypes:Object.fromEntries(r.types),pinOwners:Object.fromEntries(r.owners)};
  };
  const before=await read();
  loadAndVerifyWorkflowReceipt({receiptPath,contextPath,tokenEvidencePath:process.env.EASYEDA_TOKEN_EVIDENCE,
    repo,documentUuid,source:before.source});
  const plan=await factory(readRecords(before.source));
  if(!plan?.stage?.name||typeof plan.apiCode!=='string'||typeof plan.validateStaged!=='function'||typeof plan.transformStaged!=='function')
    throw Error('API plan requires stage.name, apiCode, validateStaged, and transformStaged');
  const evidence=loadDeliveryEvidence(process.env.EASYEDA_TOKEN_EVIDENCE);
  const beforeEvidence=plan.tokenEvidenceBefore??evidence,afterEvidence=plan.tokenEvidenceAfter??evidence;
  const beforeSourceAudit=assertSource(before.source,{componentTypes:before.componentTypes});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),prefix=path.join(outDir,`api_${stamp}`);
  const beforeGate=await runLiveJudge({windowId,outDir:`${prefix}_before`,captureCanvas:false,...beforeEvidence});
  writeFileSync(`${prefix}_before.txt`,before.source);
  const reload=async()=>{
    const tab=(await executeCode(`${guard}return (await eda.dmt_SelectControl.getCurrentDocumentInfo()).tabId;`,{timeoutMs:15000})).result;
    if(!tab)throw Error('missing tab before reload');
    if((await executeCode(`${guard}return await eda.dmt_EditorControl.closeDocument(${JSON.stringify(tab)});`,{timeoutMs:15000})).result!==true)throw Error('close failed');
    if(!(await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(documentUuid)});`,{timeoutMs:20000})).result)throw Error('open failed');
  };
  const restore=async reason=>{
    let restored,v;
    for(let attempt=1;attempt<=2;attempt++){
      await executeCode(`${guard}if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(before.source)})!==true)throw Error('rollback source failed');if(await eda.sch_Document.save()!==true)throw Error('rollback save failed');return true;`,{timeoutMs:45000,writeContext:'rollback-transaction'});
      await new Promise(r=>setTimeout(r,3000));await reload();restored=await read();v=verifyPersistedSource(before.source,restored.source,documentUuid);if(v.pass)break;
    }
    writeFileSync(`${prefix}_rollback.json`,JSON.stringify({reason,verification:v},null,2));
    if(!v.pass)throw Error(`API transaction failed and rollback readback differs: ${reason}`);
    throw Error(`${reason}; rolled back and verified`);
  };
  try{
    const apiResult=(await executeCode(`${guard}const value=await(async()=>{${plan.apiCode}})();if(await eda.sch_Document.save()!==true)throw Error('API stage save failed');return value;`,{timeoutMs:60000,writeContext:'api-transaction'})).result;
    writeFileSync(`${prefix}_api-result.json`,JSON.stringify(apiResult,null,2));
    await new Promise(r=>setTimeout(r,1500));
    const staged=await read();writeFileSync(`${prefix}_staged.txt`,staged.source);
    const stageEvidence=await plan.validateStaged(staged.source,apiResult);writeFileSync(`${prefix}_stage-evidence.json`,JSON.stringify(stageEvidence,null,2));
    if(stageEvidence?.pass!==true)throw Error(`API staged semantics failed: ${JSON.stringify(stageEvidence?.errors||[])}`);
    const sourcePlan=await plan.transformStaged(readRecords(staged.source),apiResult);
    const compiled=compileSourcePlan(staged.source,sourcePlan,{pinOwners:{...staged.pinOwners,...(sourcePlan.pinOwners||{})},strictPrimitiveIds:true});
    const candidateAudit=assertSource(compiled.source,{componentTypes:staged.componentTypes});
    if(candidateAudit.hard>beforeSourceAudit.hard)throw Error(`source hard findings regressed ${beforeSourceAudit.hard} -> ${candidateAudit.hard}`);
    await executeCode(`${guard}const stable=${stableSourceContent.toString()};const current=await eda.sys_FileManager.getDocumentSource();if(stable(current)!==${JSON.stringify(stableSourceContent(staged.source))})throw Error('staged source changed');if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(compiled.source)})!==true)throw Error('candidate source failed');if(await eda.sch_Document.save()!==true)throw Error('candidate save failed');return true;`,{timeoutMs:45000,writeContext:'api-transaction'});
    await new Promise(r=>setTimeout(r,3000));await reload();
    const after=await read(),persistence=verifyPersistedSource(compiled.source,after.source,documentUuid),afterAudit=assertSource(after.source,{componentTypes:after.componentTypes});
    writeFileSync(`${prefix}_readback.json`,JSON.stringify({persistence,afterAudit},null,2));
    writeFileSync(`${prefix}_candidate.txt`,compiled.source);
    writeFileSync(`${prefix}_readback.txt`,after.source);
    if(!persistence.pass)throw Error(`persisted candidate differs in ${persistence.findings.length} records`);
    if(afterAudit.hard>beforeSourceAudit.hard)throw Error(`persisted hard findings regressed ${beforeSourceAudit.hard} -> ${afterAudit.hard}`);
    const afterGate=await runLiveJudge({windowId,outDir:`${prefix}_after`,captureCanvas:false,...afterEvidence});
    const gate=evaluateDeliveryGate(afterGate,{before:beforeGate,repair:true});
    const report={document:initial,note:plan.note,stage:plan.stage,apiResult,stageEvidence,beforeSourceAudit,candidateAudit,afterAudit,persistence,beforeGate,afterGate,gate};
    writeFileSync(`${prefix}_report.json`,JSON.stringify(report,null,2));writeFileSync(path.join(outDir,'last-api-transaction.json'),JSON.stringify(report,null,2));writeFileSync(path.join(outDir,'last_commit_after.txt'),after.source);
    if(!gate.pass){for(const line of formatActionableQueue(afterGate))console.error(line);throw Error(`API transaction ratchet failed: ${gate.problems.join('; ')}`);}
    console.log(`API transaction passed: ${plan.stage.name}; deviations ${gate.beforeDeviationCount} -> ${gate.afterDeviationCount}`);
    return report;
  }catch(e){await restore(e.message);}
}
