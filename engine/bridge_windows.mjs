// 可复用多窗口桥工具:窗口枚举/定向/激活/截图/读几何 + 区域计算。
// 操作配方见记忆 eda-api-capability-map。零特定电路内容。
import { findBridge, listEdaWindows, executeCode } from './bridge_client.mjs';
import { fillVisibleAttrBBoxes } from './eda_transform.mjs';
import { enrichNetLabels, assertNetLabelCoverage } from './source_labels.mjs';

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
let sheetEvidence = null;
for (const id of ids) {
  const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if (!c) continue;
  const r = await eda.sch_Primitive.getPrimitivesBBox([id]);
  const bbox = r ? { minX:round(r.minX??r.x), minY:round(r.minY??r.y), maxX:round(r.maxX??(r.x+r.width)), maxY:round(r.maxY??(r.y+r.height)) } : null;
  if (c.componentType === 'sheet') {
    const attrs = (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [];
    sheetEvidence = { id, bbox, x:c.x, y:c.y, rotation:c.rotation,
      attrs: await Promise.all(attrs.map(async a=>{ let bb=null; try{ if(a.primitiveId){ const r=await eda.sch_Primitive.getPrimitivesBBox([a.primitiveId]); if(r) bb={minX:round(r.minX??r.x),minY:round(r.minY??r.y),maxX:round(r.maxX??(r.x+r.width)),maxY:round(r.maxY??(r.y+r.height))}; } }catch(e){} return {key:a.key||'',value:a.value??'',x:a.x,y:a.y,keyVisible:a.keyVisible??null,valueVisible:a.valueVisible??null,bbox:bb}; })) };
  } else if (c.componentType === 'part') {
    const ps = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id) || [];
    const attrs = (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [];
    components.push({ id, designator:c.designator||null, name:c.name||null, value:(c.otherProperty&&c.otherProperty.Value)||null,
      x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox,
      attrs: await Promise.all(attrs.map(async a=>{ let bb=null; try{ if(a.primitiveId){ const r=await eda.sch_Primitive.getPrimitivesBBox([a.primitiveId]); if(r) bb={minX:round(r.minX??r.x),minY:round(r.minY??r.y),maxX:round(r.maxX??(r.x+r.width)),maxY:round(r.maxY??(r.y+r.height))}; } }catch(e){} return {key:a.key||'', value:a.value||'', x:a.x, y:a.y, keyVisible:a.keyVisible??null, valueVisible:a.valueVisible??null, bbox:bb}; })),
      pins: ps.map(p=>({num:p.pinNumber, name:p.pinName, x:p.x, y:p.y, rot:p.rotation, len:p.pinLength, type:p.pinType, noConnected:p.getState_NoConnected?p.getState_NoConnected():false})) });
  } else if (c.componentType==='netflag'||c.componentType==='netport') {
    /* ★取 Global Net Name 子 attr 的【真实渲染 bbox】(getPrimitivesBBox)→ live judge 用真名框测重叠,
     * 不再靠 netflagNameBox 的字形偏移假设(那是 model 预测;live 验证用实测,治名×名真重叠漏检如 5V_LED×GND)。 */
    const nfAttrs = (await eda.sch_PrimitiveAttribute.getAll(id).catch(()=>[])) || [];
    const gnn = nfAttrs.find(a => a.key==='Global Net Name' && a.valueVisible)
      || nfAttrs.find(a => a.key==='Name' && a.valueVisible);
    let nameBox = null, nameAlign = null;
    if (gnn) {
      nameAlign = gnn.align || null;
      try { if (gnn.primitiveId) { const r=await eda.sch_Primitive.getPrimitivesBBox([gnn.primitiveId]); if(r && (r.maxX??0)>(r.minX??0)) nameBox={minX:round(r.minX??r.x),minY:round(r.minY??r.y),maxX:round(r.maxX??(r.x+r.width)),maxY:round(r.maxY??(r.y+r.height))}; } } catch(e){}
    }
    netflags.push({ id, type:c.componentType, net:c.net||c.netLabel||'', x:c.x, y:c.y, rotation:c.rotation, mirror:!!c.mirror, bbox, nameBox, nameAlign, nameRotation:gnn?.rotation??0,
      nameVisible:!!gnn });
  }
}
/* 注:运行时 API 不暴露挂在 wire 上的 NET 文本标签(getAll(wireId) 返 []、3321 attr 中无 NET、无 Text 原语);
 * wire 仅暴露 net 名。net 标签几何由 commercial_judge 从【文档源】解析 + 用可查组件 attr bbox 标定真字体补齐。 */
const wiresRaw = await eda.sch_PrimitiveWire.getAll() || [];
const wires = [];
for (const w of wiresRaw) {
  const id = w.primitiveId || (w.getState_PrimitiveId && w.getState_PrimitiveId());
  const L = w.line||(w.getState_Line&&w.getState_Line())||[];
  /* sch_PrimitiveWire.line = 段对拼接 [s0x,s0y,e0x,e0y, s1x,s1y,e1x,e1y,...](每4值一条【2点正交段】,非连续折线)。
     必须按段拆成独立 2 点段;否则把【段间跳转】当连续折线读 → 误判斜线(治 live ORTHO/几何假阳性,实测 i+=2 读 24 斜线、i+=4 读 0)。 */
  if (L.length >= 8 && L.length % 4 === 0) {
    for (let i = 0; i + 3 < L.length; i += 4) wires.push({ id: id+'#'+(i/4), net:w.net||'', line:[L[i],L[i+1],L[i+2],L[i+3]] });
  } else {
    wires.push({ id, net:w.net||'', line:L });
  }
}
const texts = [];
for (const t of await eda.sch_PrimitiveText.getAll()) {
  const r = await eda.sch_Primitive.getPrimitivesBBox([t.primitiveId]);
  const bbox = r ? { minX:round(r.minX??r.x), minY:round(r.minY??r.y), maxX:round(r.maxX??(r.x+r.width)), maxY:round(r.maxY??(r.y+r.height)) } : null;
  texts.push({id:t.primitiveId,text:t.content,x:t.x,y:t.y,rotation:t.rotation,bbox});
}
const rectangles = [];
for (const o of await eda.sch_PrimitiveRectangle.getAll()) {
  const r = await eda.sch_Primitive.getPrimitivesBBox([o.primitiveId]);
  const bbox = r ? { minX:round(r.minX??r.x), minY:round(r.minY??r.y), maxX:round(r.maxX??(r.x+r.width)), maxY:round(r.maxY??(r.y+r.height)) } : null;
  rectangles.push({id:o.primitiveId,bbox});
}
return { components, netflags, wires, texts, rectangles, sheetEvidence };
`;

export async function listWindows({ port = 0, timeoutMs = 3000 } = {}) {
	const { windows } = await listEdaWindows({ port, timeoutMs });
	return windows;
}

export async function readGeometry({ windowId = '', port = 0, timeoutMs = 120000 } = {}) {
	const { result } = await executeCode(SNAPSHOT_CODE, { windowId, port, timeoutMs });
	/* Node 侧后处理:EDA 未返回 attr bbox 时按字串估算兜底,DR4/DR5 检查才有数据可查。
	 * TODO(calibration): 估算 bbox 待 live 标定钉死字宽公式 */
	if (result && result.components) result.components = fillVisibleAttrBBoxes(result.components);
	return result;
}

/* Canonical live geometry for every quality gate. readGeometry alone is intentionally incomplete:
 * the EasyEDA runtime omits wire-attached NET attributes. This function merges document-source
 * labels and fails closed when their coverage cannot be proved. */
export async function readCompleteGeometry({ windowId = '', port = 0, timeoutMs = 120000 } = {}) {
	const raw = await readGeometry({ windowId, port, timeoutMs });
	const { result: source } = await executeCode(
		'return await eda.sys_FileManager.getDocumentSource();',
		{ windowId, port, timeoutMs },
	);
	const model = enrichNetLabels(raw, source);
	model._labelCoverage = assertNetLabelCoverage(model, source);
	return model;
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
