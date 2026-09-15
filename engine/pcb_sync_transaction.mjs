import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { executeCode } from './bridge_client.mjs';
import { loadAndVerifyWorkflowReceipt } from './workflow_receipt.mjs';

const refOf = item => String(item?.ref || item?.designator || '').trim();
const padNumber = item => String(item?.number ?? '').trim();
const line = (type,ticket,id,atom) => `${JSON.stringify({type,ticket,id})}||${JSON.stringify(atom)}|`;

export function materializeEmptyPcbSource(source, components) {
	const rows=String(source||'').trimEnd().split('\n');
	let ticket=0;
	for(const row of rows){try{const split=row.indexOf('||');if(split>0)ticket=Math.max(ticket,Number(JSON.parse(row.slice(0,split)).ticket)||0);}catch{}}
	let serial=0;
	const fresh=prefix=>`${prefix}${(++serial).toString(16).padStart(14,'0')}`;
	for(let i=0;i<(components||[]).length;i++){
		const item=components[i],ref=refOf(item),profile=item.footprintOverride;
		if(!ref||!profile?.uuid||!profile?.deviceUuid)throw new Error(`complete catalog footprint/device evidence is required for ${ref||'?'}`);
		const id=fresh('pc'),x=1000+(i%5)*1000,y=-(1000+Math.floor(i/5)*1000),unique=item.uniqueId||fresh('uid');
		rows.push(line('COMPONENT',++ticket,id,{partitionId:'',groupId:0,layerId:1,x,y,angle:0,attrs:{Name:item.name||ref,Value:item.name||ref,'Unique ID':unique},locked:false,zIndex:-1}));
		rows.push(line('ATTR',++ticket,fresh('pa'),{partitionId:'',groupID:0,parentId:id,layerId:3,x:null,y:null,key:'Footprint',value:profile.uuid,keyVisible:false,valueVisible:false,fontFamily:'default',fontSize:39.3701,strokeWidth:4.9213,bold:0,italic:0,origin:'LEFT_BOTTOM',angle:0,reverse:false,expansion:0,mirror:false,locked:false,zIndex:-1,specialColor:null}));
		rows.push(line('ATTR',++ticket,fresh('pa'),{partitionId:'',groupID:0,parentId:id,layerId:3,x:x-50,y:y+50,key:'Designator',value:ref,keyVisible:false,valueVisible:true,fontFamily:'default',fontSize:39.3701,strokeWidth:4.9213,bold:0,italic:0,origin:'LEFT_BOTTOM',angle:0,reverse:false,expansion:0,mirror:false,locked:false,zIndex:-1,specialColor:null}));
		rows.push(line('ATTR',++ticket,fresh('pa'),{partitionId:'',groupID:0,parentId:id,layerId:3,x:null,y:null,key:'Device',value:profile.deviceUuid,keyVisible:false,valueVisible:false,fontFamily:'default',fontSize:39.3701,strokeWidth:4.9213,bold:0,italic:0,origin:'LEFT_BOTTOM',angle:0,reverse:false,expansion:0,mirror:false,locked:false,zIndex:-1,specialColor:null}));
		for(const [pin,net] of Object.entries(item.nets||{}))if(net)rows.push(line('PAD_NET',++ticket,JSON.stringify(['PAD_NET',id,String(pin),fresh('pn')]),{partitionId:'',padNet:String(net),padLen:null,attrsMap:{}}));
	}
	return rows.join('\n')+'\n';
}

export function verifyPcbImport(expected, actual) {
	const deviations = [];
	const expectedByRef = new Map();
	for (const item of expected || []) {
		const ref = refOf(item);
		if (!ref) { deviations.push({ kind: 'schematic-designator-missing' }); continue; }
		if (expectedByRef.has(ref)) deviations.push({ kind: 'schematic-designator-duplicate', ref });
		expectedByRef.set(ref, item);
		if (!item.footprint?.uuid || !item.footprint?.name) deviations.push({ kind: 'schematic-footprint-missing', ref });
	}
	const actualByRef = new Map();
	for (const item of actual || []) {
		const ref = refOf(item);
		if (!ref) { deviations.push({ kind: 'pcb-designator-missing' }); continue; }
		if (actualByRef.has(ref)) deviations.push({ kind: 'pcb-designator-duplicate', ref });
		actualByRef.set(ref, item);
	}
	for (const [ref, schematic] of expectedByRef) {
		const pcb = actualByRef.get(ref);
		if (!pcb) { deviations.push({ kind: 'pcb-component-missing', ref }); continue; }
		if (!pcb.footprint?.uuid || !pcb.footprint?.name) deviations.push({ kind: 'pcb-footprint-missing', ref });
		const actualPads = new Set((pcb.pads || []).map(padNumber).filter(Boolean));
		if (!actualPads.size) deviations.push({ kind: 'pcb-footprint-empty', ref });
		for (const number of schematic.pins || []) if (!actualPads.has(String(number)))
			deviations.push({ kind: 'pcb-pad-missing-for-symbol-pin', ref, pin: String(number) });
		const actualNets=new Map((pcb.pads||[]).map(p=>[padNumber(p),String(p?.net||'')]));
		for(const [number,net] of Object.entries(schematic.nets||{}))if(net&&actualNets.get(String(number))!==String(net))
			deviations.push({kind:'pcb-pad-net-mismatch',ref,pin:String(number),expected:String(net),actual:actualNets.get(String(number))||''});
	}
	for (const ref of actualByRef.keys()) if (!expectedByRef.has(ref)) deviations.push({ kind: 'pcb-component-unexpected', ref });
	return { pass: deviations.length === 0, deviations, expected: expectedByRef.size, actual: actualByRef.size };
}

const SCHEMATIC_INVENTORY = `
const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();
if(!d||d.documentType!==1)throw Error('active document is not schematic');
const netFile=await eda.sch_ManufactureData.getNetlistFile();
if(!netFile)throw Error('authoritative schematic netlist is unavailable');
const netlist=JSON.parse(await netFile.text());
const netsByRef={};
for(const item of Object.values(netlist.components||{})){const ref=item?.props?.Designator;if(!ref)continue;netsByRef[ref]={};for(const [pin,info] of Object.entries(item.pinInfoMap||{}))netsByRef[ref][String(pin)]=String(info?.net||'');}
const components=[];
for(const c of await eda.sch_PrimitiveComponent.getAll()){
  if(c.componentType==='sheet'||c.componentType==='netflag'||c.componentType==='netport')continue;
  if(c.getState_AddIntoPcb?.()===false)continue;
  const ref=c.getState_Designator?.()||c.designator||'';
  const footprint=c.getState_Footprint?.(),component=c.getState_Component?.();
  const pins=(await c.getAllPins().catch(()=>[]))||[];
  components.push({id:c.getState_PrimitiveId?.()||c.primitiveId,ref,name:c.getState_Name?.()||'',uniqueId:c.getState_UniqueId?.()||'',footprint,component,
    pins:pins.map(p=>String(p.getState_PinNumber?.()||p.pinNumber||'')).filter(Boolean),nets:netsByRef[ref]||{}});
}
return {document:d,components};`;

const PCB_INVENTORY = `
const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();
if(!d||d.documentType!==3)throw Error('active document is not PCB');
const components=[];
for(const c of await eda.pcb_PrimitiveComponent.getAll()){
  const pads=[];
  for(const p of (await c.getAllPins().catch(()=>[]))||[])pads.push({number:String(p.getState_PadNumber?.()||''),net:p.getState_Net?.()||''});
  components.push({id:c.getState_PrimitiveId?.(),ref:c.getState_Designator?.()||'',footprint:c.getState_Footprint?.(),pads});
}
return {document:d,source:await eda.sys_FileManager.getDocumentSource(),components};`;

export async function activateTabAndPoll(tabId, expectedUuid, expectedType, {
	windowId, timeoutMs = 45000, execute = executeCode,
	wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
	// activateDocument only switches an already-open tab. A cold EasyEDA restart has
	// no PCB tab yet, so fall back to openDocument using the stable document UUID.
	const activation = await execute(`return await eda.dmt_EditorControl.activateDocument(${JSON.stringify(tabId)}).catch(()=>false);`, { windowId, timeoutMs: 5000 });
	if (activation.result !== true) {
		await execute(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(expectedUuid)});`, { windowId, timeoutMs: 30000 });
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await wait(1000);
		const doc = (await execute('return await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(()=>null);', { windowId, timeoutMs: 5000 })).result;
		if (doc?.uuid === expectedUuid && doc.documentType === expectedType) return doc;
	}
	throw new Error(`document activation timed out: ${expectedUuid}`);
}

export async function syncPcbFromSchematic({ pcbUuid, outDir, windowId = '', repo, receiptPath, contextPath, tokenEvidencePath, footprintMapPath = '' } = {}) {
	if (!pcbUuid) throw new Error('pcb-sync requires --pcb <uuid>');
	mkdirSync(outDir, { recursive: true });
	const schematic = (await executeCode(SCHEMATIC_INVENTORY, { windowId, timeoutMs: 40000 })).result;
	if (!schematic?.document?.uuid || !schematic.components?.length) throw new Error('schematic inventory is incomplete');
	const boards = (await executeCode('return await eda.dmt_Board.getAllBoardsInfo();', { windowId, timeoutMs: 15000 })).result || [];
	const board = boards.find(item => item?.pcb?.uuid === pcbUuid && (item?.schematic?.page || []).some(page => page.uuid === schematic.document.uuid));
	const schematicUuid = board?.schematic?.uuid;
	if (!schematicUuid) throw new Error('PCB is not associated with the active schematic page through a Board');
	const source = (await executeCode('return await eda.sys_FileManager.getDocumentSource();', { windowId, timeoutMs: 30000 })).result;
	loadAndVerifyWorkflowReceipt({ receiptPath, contextPath, tokenEvidencePath, repo, documentUuid: schematic.document.uuid, source });
	const tokenEvidence = JSON.parse(readFileSync(tokenEvidencePath, 'utf8').replace(/^\uFEFF/, ''));
	const footprintProfiles = new Map((tokenEvidence.connectorFootprintProfiles || []).map(profile => [String(profile.ref), profile]));
	const explicitFootprints = footprintMapPath ? JSON.parse(readFileSync(footprintMapPath, 'utf8').replace(/^\uFEFF/, '')) : {};
	for (const item of schematic.components) {
		const profile = explicitFootprints[item.ref] || footprintProfiles.get(item.ref);
		const uuid=profile?.uuid||profile?.footprintUuid;
		if (uuid) item.footprintOverride = { libraryType:'4', libraryUuid:profile.libraryUuid || '0819f05c4eef4c71ace90d822a990e87', uuid, deviceUuid:profile.deviceUuid||profile.componentUuid||'' };
	}
	const missing = schematic.components.filter(c => !c.footprint?.uuid || !c.footprint?.name);
	if (missing.length) throw new Error(`schematic components lack footprint association: ${missing.map(refOf).join(',')}`);
	const initialTab = schematic.document.tabId;
	const pcbTab = schematic.document.parentProjectUuid ? `${pcbUuid}@${schematic.document.parentProjectUuid}` : '';
	if (!pcbTab) throw new Error('cannot derive PCB tab identity from the active project');
	await activateTabAndPoll(pcbTab, pcbUuid, 3, { windowId });
	let before;
	try {
		before = (await executeCode(PCB_INVENTORY, { windowId, timeoutMs: 40000 })).result;
		if (before?.document?.uuid !== pcbUuid) throw new Error('PCB document identity mismatch');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const prefix = path.join(outDir, `pcb-sync-${stamp}`);
		writeFileSync(`${prefix}-before.txt`, before.source, 'utf8');
		writeFileSync(`${prefix}-schematic.json`, JSON.stringify(schematic, null, 2), 'utf8');
		let result;
		if (before.components.length) {
			const preVerification=verifyPcbImport(schematic.components,before.components);
			if (preVerification.pass) {
				result={mode:'already-synchronized',preserved:before.components.length};
			} else {
				// Stale components from another schematic revision cannot be repaired by
				// merely changing hidden footprint attributes. Recreate each part from its
				// catalog device so EasyEDA materializes real footprint primitives/pads.
				const specs=schematic.components.map((item,index)=>({
					ref:item.ref,uniqueId:item.uniqueId||'',nets:item.nets||{},index,
					libraryUuid:item.footprintOverride?.libraryUuid,
					deviceUuid:item.footprintOverride?.deviceUuid,
				}));
				if(specs.some(x=>!x.libraryUuid||!x.deviceUuid))throw new Error('catalog device binding is required to rebuild a stale PCB');
				// The bridge has a fixed per-request timeout. Keep every catalog operation
				// bounded and sequential; a long monolithic request can outlive its rollback.
				await executeCode(`const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(d?.uuid!==${JSON.stringify(pcbUuid)}||d.documentType!==3)throw Error('PCB identity changed');const old=await eda.pcb_PrimitiveComponent.getAll();if(old.length&&await eda.pcb_PrimitiveComponent.delete(old)!==true)throw Error('stale PCB component removal failed');return old.length;`,{windowId,timeoutMs:20000,writeContext:'pcb-transaction'});
				const rebuilt=[];
				for(const s of specs){
					const x=400+(s.index%5)*450,y=-(300+Math.floor(s.index/5)*350);
					const made=(await executeCode(`const s=${JSON.stringify(s)};const c=await eda.pcb_PrimitiveComponent.create({libraryUuid:s.libraryUuid,uuid:s.deviceUuid},1,${x},${y},0,false);if(!c)throw Error('catalog PCB component create failed: '+s.ref);const id=c.getState_PrimitiveId?.();const changed=await eda.pcb_PrimitiveComponent.modify(id,{designator:s.ref,uniqueId:s.uniqueId||null});if(!changed)throw Error('PCB component identity update failed: '+s.ref);const edits=[];for(const p of await changed.getAllPins().catch(()=>[])||[]){const n=String(p.getState_PadNumber?.()||'');if(s.nets[n])edits.push(eda.pcb_PrimitivePad.modify(p,{net:s.nets[n]}));}const done=await Promise.all(edits);if(done.some(x=>!x))throw Error('PCB pad net update failed: '+s.ref);const fresh=await eda.pcb_PrimitiveComponent.get(id);return {ref:fresh?.getState_Designator?.()||'',id};`,{windowId,timeoutMs:25000,writeContext:'pcb-transaction'})).result;
					rebuilt.push(made);
				}
				await executeCode(`if(await eda.pcb_Document.save()!==true)throw Error('PCB save failed');return true;`,{windowId,timeoutMs:20000,writeContext:'pcb-transaction'});
				result={mode:'catalog-device-rebuild',created:rebuilt.length,beforeComponents:before.components.length};
			}
		} else {
			const candidateSource=materializeEmptyPcbSource(before.source,schematic.components);
			writeFileSync(`${prefix}-candidate.txt`,candidateSource,'utf8');
			await executeCode(`const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(d?.uuid!==${JSON.stringify(pcbUuid)}||d.documentType!==3)throw Error('PCB identity changed');if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(candidateSource)})!==true)throw Error('PCB candidate source failed');if(await eda.pcb_Document.save()!==true)throw Error('PCB save failed');return true;`,{windowId,timeoutMs:30000,writeContext:'pcb-transaction'});
			result={mode:'deterministic-empty-pcb-source-materialization',created:schematic.components.length};
		}
		let after,verification;
		await new Promise(resolve=>setTimeout(resolve,3000));
		after=(await executeCode(PCB_INVENTORY,{windowId,timeoutMs:20000})).result;
		verification=verifyPcbImport(schematic.components,after.components);
		writeFileSync(`${prefix}-after.txt`, after.source, 'utf8');
		writeFileSync(`${prefix}-report.json`, JSON.stringify({ board:board.name, schematic: schematic.document, schematicUuid, pcb: after.document, result, verification, components: after.components }, null, 2), 'utf8');
		writeFileSync(path.join(outDir, 'last-pcb-sync.json'), JSON.stringify({ board:board.name, schematic: schematic.document, schematicUuid, pcb: after.document, result, verification, components: after.components, artifacts: { prefix } }, null, 2), 'utf8');
		if (!verification.pass) throw new Error(`PCB import verification failed: ${JSON.stringify(verification.deviations.slice(0, 20))}`);
		console.log(`PCB sync passed: ${verification.actual}/${verification.expected} components; every schematic pin has a real PCB pad`);
		return { verification, after };
	} catch (error) {
		if (before?.source) await executeCode(`const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(d?.uuid!==${JSON.stringify(pcbUuid)}||d.documentType!==3)throw Error('PCB identity changed during rollback');if(await eda.sys_FileManager.setDocumentSource(${JSON.stringify(before.source)})!==true)throw Error('PCB rollback source failed');if(await eda.pcb_Document.save()!==true)throw Error('PCB rollback save failed');return true;`, { windowId, timeoutMs: 60000, writeContext: 'rollback-transaction' });
		throw error;
	} finally {
		if (initialTab) await activateTabAndPoll(initialTab, schematic.document.uuid, 1, { windowId, timeoutMs: 30000 }).catch(()=>{});
	}
}
