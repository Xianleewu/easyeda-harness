import { writeFileSync } from 'node:fs';
import { executeCode } from './bridge_client.mjs';
import { boardFromOutlineSource, flattenPcbDrc } from './pcb_placement_qc.mjs';

const round = value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : value;

export function extractBoardOutlineSources(source) {
	const found = [];
	for (const line of String(source || '').split('\n')) {
		const split = line.indexOf('||');
		if (split < 0) continue;
		try {
			const head = JSON.parse(line.slice(0, split));
			const payload = JSON.parse(line.slice(split + 2).replace(/\|$/, ''));
			if (head.type === 'POLY' && payload.layerId === 11 && Array.isArray(payload.path)) found.push(payload.path);
		} catch {}
	}
	return found;
}

export async function ensureActivePcb({ windowId = '', port = 0, pcbUuid = '', timeoutMs = 30000 } = {}) {
	const read = async () => (await executeCode('return await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(()=>null);', { windowId, port, timeoutMs })).result;
	let doc = await read();
	if (doc?.documentType === 3 && (!pcbUuid || doc.uuid === pcbUuid)) return doc;
	const inferred = pcbUuid || (doc?.documentType === 15 && String(doc.uuid || '').startsWith('2d-') ? String(doc.uuid).slice(3) : '');
	if (!inferred) throw new Error(`Active document is not a PCB and no PCB UUID was supplied: ${JSON.stringify(doc)}`);
	let tabId = doc?.parentProjectUuid ? `${inferred}@${doc.parentProjectUuid}` : '';
	if (!tabId) tabId = (await executeCode(`return await eda.dmt_EditorControl.openDocument(${JSON.stringify(inferred)});`, { windowId, port, timeoutMs })).result;
	if (!tabId) throw new Error(`Cannot open PCB ${inferred}`);
	await executeCode(`await eda.dmt_EditorControl.activateDocument(${JSON.stringify(tabId)});return true;`, { windowId, port, timeoutMs });
	doc = await read();
	if (doc?.documentType !== 3 || doc.uuid !== inferred) throw new Error(`PCB activation failed: ${JSON.stringify(doc)}`);
	return doc;
}

const LIVE_CODE = `
const d=await eda.dmt_SelectControl.getCurrentDocumentInfo();
if(!d||d.documentType!==3)throw Error('active document is not PCB');
const rb=v=>{if(!v)return null;const minX=v.minX??v.x,minY=v.minY??v.y,maxX=v.maxX??((v.x??0)+(v.width??0)),maxY=v.maxY??((v.y??0)+(v.height??0));return {minX,minY,maxX,maxY};};
const components=[],designators=[];
for(const c of await eda.pcb_PrimitiveComponent.getAll()){
 const id=c.getState_PrimitiveId(),ref=c.getState_Designator();
 const bbox=rb(await eda.pcb_Primitive.getPrimitivesBBox([id]));
 const pads=[];
 for(const p of (await c.getAllPins().catch(()=>[]))||[]){const pid=p.getState_PrimitiveId?.();pads.push({id:pid,number:p.getState_PadNumber?.(),net:p.getState_Net?.(),x:p.getState_X?.(),y:p.getState_Y?.(),layer:p.getState_Layer?.(),type:p.getState_PadType?.(),hole:p.getState_Hole?.(),bbox:rb(await eda.pcb_Primitive.getPrimitivesBBox([pid]).catch(()=>null))});}
 components.push({id,ref,name:c.getState_Name?.(),x:c.getState_X(),y:c.getState_Y(),rotation:c.getState_Rotation(),layer:c.getState_Layer(),bbox,footprint:c.getState_Footprint?.(),pads});
 for(const a of (await eda.pcb_PrimitiveAttribute.getAll(id).catch(()=>[]))||[]) if(a.getState_Key?.()==='Designator'){
  const aid=a.getState_PrimitiveId(),ab=rb(await eda.pcb_Primitive.getPrimitivesBBox([aid]).catch(()=>null));
  designators.push({id:aid,parent:id,ref,value:a.getState_Value?.(),visible:a.getState_ValueVisible?.(),x:a.getState_X?.(),y:a.getState_Y?.(),rotation:a.getState_Rotation?.(),layer:a.getState_Layer?.(),fontSize:a.getState_FontSize?.(),lineWidth:a.getState_LineWidth?.(),alignMode:a.getState_AlignMode?.(),bbox:ab});
 }
}
const source=await eda.sys_FileManager.getDocumentSource();
const drc=await eda.pcb_Drc.check(true,false,true);
return {document:d,components,designators,source,drc};`;

export async function capturePcbSnapshot({ windowId = '', port = 0, pcbUuid = '', timeoutMs = 120000, outFile = '' } = {}) {
	const document = await ensureActivePcb({ windowId, port, pcbUuid, timeoutMs });
	const { result } = await executeCode(LIVE_CODE, { windowId, port, timeoutMs });
	const outlineSources = extractBoardOutlineSources(result.source);
	const boards = outlineSources.map(boardFromOutlineSource).filter(Boolean);
	if (boards.length !== 1) throw new Error(`Expected exactly one supported PCB outline, found ${boards.length}`);
	const snapshot = {
		capturedAt: new Date().toISOString(),
		document,
		board: boards[0],
		components: result.components.map(component => ({
			...component,
			x: round(component.x), y: round(component.y),
			bbox: component.bbox && Object.fromEntries(Object.entries(component.bbox).map(([key, value]) => [key, round(value)])),
		})),
		designators: result.designators.map(item => ({
			...item,
			x: round(item.x), y: round(item.y),
			bbox: item.bbox && Object.fromEntries(Object.entries(item.bbox).map(([key, value]) => [key, round(value)])),
		})),
		drc: { findings: flattenPcbDrc(result.drc) },
	};
	if (outFile) writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');
	return snapshot;
}
