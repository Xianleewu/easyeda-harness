import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {executeCode} from './bridge_client.mjs';
import {readRecords,verifyPersistedSource} from './source_transaction.mjs';
import {loadAndVerifyWorkflowReceipt} from './workflow_receipt.mjs';

// Add catalog primitives only. Connections and final annotations remain source transactions.
export async function seedDevices(manifestFile,documentUuid,outDir,{repo,receiptPath,contextPath}={}) {
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(!Array.isArray(manifest.parts)||!manifest.parts.length)throw Error('No devices to seed');
  if(manifest.documentUuid!==documentUuid)throw Error('Seed document mismatch');
  const digest=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const receipt=path.join(outDir,'seed-request-'+digest+'.json');
  if(fs.existsSync(receipt))throw Error('This seed request was already attempted; reconcile its receipt instead of placing duplicates: '+receipt);
  const seen=new Set();
  for(const p of manifest.parts){
    if(!p.key||seen.has(p.key)||!p.deviceUuid||!p.libraryUuid||!p.mpn||!p.supplierId||![p.x,p.y,p.rotation].every(Number.isFinite))throw Error('Incomplete seed manifest');
    seen.add(p.key);
  }
  const prefix=path.join(outDir,'seed-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const invoke=async code=>(await executeCode(code,{timeoutMs:60000,writeContext:'catalog-seed'})).result;
  const guard=`const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(d?.uuid!==${JSON.stringify(documentUuid)}||d.documentType!==1)throw Error('Seed document changed');`;
  const source=()=>invoke(guard+'return await eda.sys_FileManager.getDocumentSource();');
  const before=await source();fs.writeFileSync(prefix+'-before.txt',before);
  loadAndVerifyWorkflowReceipt({receiptPath,contextPath,tokenEvidencePath:process.env.EASYEDA_TOKEN_EVIDENCE,
    repo,documentUuid,source:before});
  const existingRefs=new Set(readRecords(before).filter(r=>r.head.type==='ATTR'&&r.atom.key==='Designator').map(r=>r.atom.value));
  for(const p of manifest.parts)if(existingRefs.has(p.key))throw Error('Target designator already exists: '+p.key);
  const backup=await invoke(guard+'const f=await eda.sys_FileManager.getProjectFile();if(!f)throw Error("No project backup");const a=new Uint8Array(await f.arrayBuffer());let s="";for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);');
  fs.writeFileSync(prefix+'-backup.epro2',Buffer.from(backup,'base64'));
  const devices=await invoke('const parts='+JSON.stringify(manifest.parts)+';const out=[];for(const p of parts){const d=await eda.lib_Device.get(p.deviceUuid,p.libraryUuid);if(d?.property?.manufacturerId!==p.mpn||d?.property?.supplierId!==p.supplierId||!d.association?.footprintUuid)throw Error("Catalog identity mismatch: "+p.key);out.push(d);}return out;');
  const created=[];
  fs.writeFileSync(receipt,JSON.stringify({status:'requires-reconciliation',manifestFile,prefix,created},null,2));
  fs.writeFileSync(prefix+'-catalog.json',JSON.stringify(devices,null,2));
  for(let i=0;i<manifest.parts.length;i++){
    const p=manifest.parts[i];
    const c=await invoke(guard+'const p='+JSON.stringify(p)+';const c=await eda.sch_PrimitiveComponent.create({libraryUuid:p.libraryUuid,uuid:p.deviceUuid},p.x,p.y,undefined,p.rotation,false,true,true);if(!c)throw Error("Device placement returned empty");return c;');
    if(!c.primitiveId)throw Error('Missing created primitive ID');
    created.push({key:p.key,component:c});
    fs.writeFileSync(prefix+'-created.json',JSON.stringify(created,null,2));
    fs.writeFileSync(receipt,JSON.stringify({status:'requires-reconciliation',manifestFile,prefix,created},null,2));
  }
  const saved=await invoke(guard+'return await eda.sch_Document.save();');
  if(saved!==true)throw Error('New devices not saved');
  const after=await source();fs.writeFileSync(prefix+'-after.txt',after);
  const ids=new Set(created.map(c=>c.component.primitiveId));
  const filtered=readRecords(after).filter(r=>!ids.has(r.head.id)&&!ids.has(r.atom.parentId)).map(r=>r.raw).join('\n');
  const unchanged=verifyPersistedSource(before,filtered,documentUuid);
  const report={created,unchanged,createdAndSaved:unchanged.pass,deliveryVerified:false,requiresSourceLayout:true};
  fs.writeFileSync(prefix+'-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({reportFile:prefix+'-report.json',created:created.map(c=>({key:c.key,id:c.component.primitiveId})),unchanged:unchanged.pass}));
  if(!unchanged.pass)throw Error('Existing source changed during device seeding');
  fs.writeFileSync(receipt,JSON.stringify({status:'created-and-saved',manifestFile,prefix,created},null,2));
  return report;
}
