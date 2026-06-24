// 可复用多窗口桥工具:窗口枚举/定向/激活/截图/读几何 + 区域计算。
// 操作配方见记忆 eda-api-capability-map。零特定电路内容。
import { findBridge, listEdaWindows, executeCode } from './bridge_client.mjs';

// 纯函数:由 parts 的 bbox 算紧窗(已排除大图框——调用方只传 parts)。
export function regionFromParts(parts, { aspect = 2017 / 1081, pad = 160 } = {}) {
	const bx = (parts || []).map(p => p.bbox).filter(Boolean);
	if (!bx.length) return null;
	const minX = Math.min(...bx.map(b => b.minX)), maxX = Math.max(...bx.map(b => b.maxX));
	const minY = Math.min(...bx.map(b => b.minY)), maxY = Math.max(...bx.map(b => b.maxY));
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	let w = (maxX - minX) + 2 * pad, h = (maxY - minY) + 2 * pad;
	if (w / h > aspect) h = w / aspect; else w = h * aspect;
	return { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 };
}

// 桥 I/O 函数:列窗口、读几何、激活页、局部截图。
const SNAPSHOT_CODE = `
const round = v => (typeof v === 'number' ? Math.round(v*100)/100 : v);
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const components = [], netflags = [];
for (const id of ids) {
  const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if (!c) continue;
  const r = await eda.sch_Primitive.getPrimitivesBBox([id]);
  const bbox = r ? { minX:round(r.minX??r.x), minY:round(r.minY??r.y), maxX:round(r.maxX??(r.x+r.width)), maxY:round(r.maxY??(r.y+r.height)) } : null;
  if (c.componentType === 'part') {
    const ps = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id) || [];
    const attrs = (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [];
    components.push({ id, designator:c.designator||null, name:c.name||null, value:(c.otherProperty&&c.otherProperty.Value)||null,
      x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox,
      attrs: await Promise.all(attrs.map(async a=>{ let bb=null; try{ if(a.primitiveId){ const r=await eda.sch_Primitive.getPrimitivesBBox([a.primitiveId]); if(r) bb={minX:round(r.minX??r.x),minY:round(r.minY??r.y),maxX:round(r.maxX??(r.x+r.width)),maxY:round(r.maxY??(r.y+r.height))}; } }catch(e){} return {key:a.key||'', value:a.value||'', x:a.x, y:a.y, keyVisible:a.keyVisible??null, valueVisible:a.valueVisible??null, bbox:bb}; })),
      pins: ps.map(p=>({num:p.pinNumber, name:p.pinName, x:p.x, y:p.y, rot:p.rotation, len:p.pinLength, type:p.pinType, noConnected:p.getState_NoConnected?p.getState_NoConnected():false})) });
  } else if (c.componentType==='netflag'||c.componentType==='netport') {
    netflags.push({ id, type:c.componentType, net:c.net||c.netLabel||'', x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox });
  }
}
const wiresRaw = await eda.sch_PrimitiveWire.getAll() || [];
const wires = [];
for (const w of wiresRaw) {
  const id = w.primitiveId || (w.getState_PrimitiveId && w.getState_PrimitiveId());
  const attrs = id ? (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [] : [];
  wires.push({ id, net:w.net||'', line:w.line||(w.getState_Line&&w.getState_Line())||[],
    attrs: attrs.map(a=>({key:a.key||'', value:a.value||'', x:a.x, y:a.y})) });
}
return { components, netflags, wires, texts: [], rectangles: [] };
`;

export async function listWindows({ port = 0, timeoutMs = 3000 } = {}) {
	const { windows } = await listEdaWindows({ port, timeoutMs });
	return windows;
}

export async function readGeometry({ windowId = '', port = 0, timeoutMs = 120000 } = {}) {
	const { result } = await executeCode(SNAPSHOT_CODE, { windowId, port, timeoutMs });
	return result;
}

export async function activatePage({ windowId = '', port = 0, tabId }) {
	await executeCode(`await eda.dmt_EditorControl.activateDocument(${JSON.stringify(tabId)}); return true;`, { windowId, port });
}

export async function captureRegion({ windowId = '', port = 0, region, outFile, timeoutMs = 120000 }) {
	const { left, right, top, bottom } = region;
	const code = `
const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(()=>null);
const tabId = doc&&doc.tabId?doc.tabId:undefined;
const ok = await eda.dmt_EditorControl.zoomToRegion(${left},${right},${top},${bottom}, tabId);
await new Promise(r=>setTimeout(r,1000));
const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(tabId);
if(!blob) return { error:'no blob' };
const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf);
let bin=''; const ch=0x8000; for(let i=0;i<bytes.length;i+=ch) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+ch));
return { type:blob.type, size:bytes.length, b64:btoa(bin) };
`;
	const { result } = await executeCode(code, { windowId, port, timeoutMs });
	if (!result || !result.b64) throw new Error(`captureRegion 无图: ${JSON.stringify(result)}`);
	const { writeFileSync } = await import('node:fs');
	writeFileSync(outFile, Buffer.from(result.b64, 'base64'));
	return { outFile };
}
