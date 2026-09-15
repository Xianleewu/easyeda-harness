// 回滚: setDocumentSource(存档) + save + reload + 验证
import { readFileSync } from 'node:fs';
import { executeCode } from './engine/bridge_client.mjs';
const arch = readFileSync(process.argv[2], 'utf8');
const pin = await executeCode('return await eda.dmt_SelectControl.getCurrentDocumentInfo();', { timeoutMs: 15000 });
if (!pin.result || pin.result.documentType !== 1) throw new Error('活动文档非原理图,中止');
const w = await executeCode(`return await eda.sys_FileManager.setDocumentSource(${JSON.stringify(arch)});`, { timeoutMs: 28000, writeContext:'rollback-transaction' });
const sv = await executeCode('return await eda.sch_Document.save();', { timeoutMs: 25000, writeContext:'rollback-transaction' });
await executeCode(`await eda.dmt_EditorControl.closeDocument(${JSON.stringify(pin.result.tabId)}); return true;`, { timeoutMs: 15000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2000));
await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(pin.result.uuid)});`, { timeoutMs: 20000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2500));
const r2 = await executeCode('return await eda.sys_FileManager.getDocumentSource();', { timeoutMs: 25000 });
console.log('回滚后行数:', r2.result ? r2.result.split('\n').length : 'FAIL', '字节数:', r2.result ? r2.result.length : 0);
