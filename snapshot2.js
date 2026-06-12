// 全量感知提取：器件(pos/rot/mirror/bbox/value) + 引脚(pos/rot/len/name) + netflag(net/pos/rot/bbox) + wires
const round = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const partIds = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
let sourceNcByPin = new Map();
try {
  const source = await eda.sys_FileManager.getDocumentSource();
  const lines = String(source || '').split('\n');
  const parsed = [];
  for (const line of lines) {
    const sep = line.indexOf('||');
    if (sep < 0) continue;
    try { parsed.push({ head: JSON.parse(line.slice(0, sep)), data: JSON.parse(line.slice(sep + 2).replace(/\|$/, '')) }); } catch {}
  }
  const designatorByParent = new Map();
  const pinNumByParent = new Map();
  const ncByParent = new Map();
  for (const r of parsed) {
    if (r.head?.type !== 'ATTR') continue;
    if (r.data?.key === 'Designator') designatorByParent.set(r.data.parentId, String(r.data.value || ''));
    if (r.data?.key === 'Pin Number') pinNumByParent.set(r.data.parentId, String(r.data.value || ''));
    if (r.data?.key === 'NO_CONNECT') ncByParent.set(r.data.parentId, String(r.data.value || '').toLowerCase() === 'yes');
  }
  for (const [pinParent, pinNum] of pinNumByParent.entries()) {
    const compParent = String(pinParent).split('-e')[0];
    const designator = designatorByParent.get(compParent);
    if (!designator) continue;
    sourceNcByPin.set(`${designator}.${pinNum}`, ncByParent.get(pinParent) === true);
  }
} catch {}
const components = [];
const netflags = [];
for (const id of partIds) {
  const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);
  if (!c) continue;
  const r = await eda.sch_Primitive.getPrimitivesBBox([id]);
  const bbox = r ? {
    minX: round(r.minX != null ? r.minX : r.x),
    minY: round(r.minY != null ? r.minY : r.y),
    maxX: round(r.maxX != null ? r.maxX : (r.x + r.width)),
    maxY: round(r.maxY != null ? r.maxY : (r.y + r.height)),
  } : null;
  if (c.componentType === 'part') {
    const ps = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id) || [];
    const attrsRaw = await eda.sch_PrimitiveAttribute.getAll(id).catch(() => []) || [];
    components.push({
      id, designator: c.designator || null, name: c.name || null,
      value: (c.otherProperty && c.otherProperty.Value) || null,
      supplier: c.supplier || null,
      supplierId: c.supplierId || null,
      manufacturer: c.manufacturer || null,
      manufacturerId: c.manufacturerId || null,
      addIntoBom: c.getState_AddIntoBom ? c.getState_AddIntoBom() : c.addIntoBom,
      addIntoPcb: c.getState_AddIntoPcb ? c.getState_AddIntoPcb() : c.addIntoPcb,
      x: c.x, y: c.y, rotation: c.rotation, mirror: !!c.mirror, bbox,
      attrs: attrsRaw.map(a => ({
        id: a.primitiveId,
        key: a.key || (a.getState_Key && a.getState_Key()) || '',
        value: a.value || (a.getState_Value && a.getState_Value()) || '',
        x: a.x,
        y: a.y,
        keyVisible: a.keyVisible ?? null,
        valueVisible: a.valueVisible ?? null,
      })),
      pins: ps.map(p => {
        const ref = `${c.designator || ''}.${p.pinNumber}`;
        const sourceNc = sourceNcByPin.has(ref) ? sourceNcByPin.get(ref) : null;
        return { num: p.pinNumber, name: p.pinName, x: p.x, y: p.y, rot: p.rotation, len: p.pinLength, noConnected: sourceNc != null ? sourceNc : (p.getState_NoConnected ? p.getState_NoConnected() : false) };
      }),
    });
  } else if (c.componentType === 'netflag' || c.componentType === 'netport') {
    netflags.push({ id, type: c.componentType, net: c.net || c.netLabel || '', x: c.x, y: c.y, rotation: c.rotation, mirror: !!c.mirror, symbol: c.component && c.component.name, bbox });
  }
}
async function getWires() {
  for (let i = 0; i < 5; i++) {
    const raw = await eda.sch_PrimitiveWire.getAll();
    if (raw && raw.length) return raw;
    await new Promise(r => setTimeout(r, 250));
  }
  return await eda.sch_PrimitiveWire.getAll();
}
const wiresRaw = await getWires();
const wires = [];
for (const w of wiresRaw) {
  const id = w.primitiveId || (w.getState_PrimitiveId && w.getState_PrimitiveId());
  const attrsRaw = id ? await eda.sch_PrimitiveAttribute.getAll(id).catch(() => []) || [] : [];
  wires.push({
    id,
    net: w.net || (w.getState_Net && w.getState_Net()) || '',
    line: w.line || (w.getState_Line && w.getState_Line()) || [],
    attrs: attrsRaw.map(a => ({
      id: a.primitiveId || (a.getState_PrimitiveId && a.getState_PrimitiveId()),
      key: a.key || (a.getState_Key && a.getState_Key()) || '',
      value: a.value || (a.getState_Value && a.getState_Value()) || '',
      x: a.x ?? (a.getState_X && a.getState_X()),
      y: a.y ?? (a.getState_Y && a.getState_Y()),
      rotation: a.rotation ?? (a.getState_Rotation && a.getState_Rotation()),
      alignMode: a.alignMode ?? a.align ?? (a.getState_AlignMode && a.getState_AlignMode()),
      keyVisible: a.keyVisible ?? (a.getState_KeyVisible && a.getState_KeyVisible()),
      valueVisible: a.valueVisible ?? (a.getState_ValueVisible && a.getState_ValueVisible()),
    })),
  });
}
const textsRaw = await eda.sch_PrimitiveText.getAll();
const texts = [];
for (const t of textsRaw) {
  const id = t.primitiveId;
  const r = id ? await eda.sch_Primitive.getPrimitivesBBox([id]) : null;
  const bbox = r ? {
    minX: round(r.minX != null ? r.minX : r.x),
    minY: round(r.minY != null ? r.minY : r.y),
    maxX: round(r.maxX != null ? r.maxX : (r.x + r.width)),
    maxY: round(r.maxY != null ? r.maxY : (r.y + r.height)),
  } : null;
  texts.push({
    id,
    content: t.content,
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    textColor: t.textColor ?? t.color ?? (t.getState_Color && t.getState_Color()),
    fontSize: t.fontSize ?? (t.getState_FontSize && t.getState_FontSize()),
    fontName: t.fontName ?? t.fontFamily ?? (t.getState_FontFamily && t.getState_FontFamily()),
    alignMode: t.alignMode ?? t.align ?? (t.getState_AlignMode && t.getState_AlignMode()),
    bbox,
  });
}
const rectsRaw = await eda.sch_PrimitiveRectangle.getAll().catch(() => []) || [];
const rectangles = [];
for (const r0 of rectsRaw) {
  const id = r0.primitiveId;
  const r = id ? await eda.sch_Primitive.getPrimitivesBBox([id]).catch(() => null) : null;
  const bbox = r ? {
    minX: round(r.minX != null ? r.minX : r.x),
    minY: round(r.minY != null ? r.minY : r.y),
    maxX: round(r.maxX != null ? r.maxX : (r.x + r.width)),
    maxY: round(r.maxY != null ? r.maxY : (r.y + r.height)),
  } : null;
  rectangles.push({
    id,
    topLeftX: r0.topLeftX,
    topLeftY: r0.topLeftY,
    width: r0.width,
    height: r0.height,
    rotation: r0.rotation,
    color: r0.color,
    fillColor: r0.fillColor,
    lineWidth: r0.lineWidth,
    lineType: r0.lineType,
    fillStyle: r0.fillStyle,
    bbox,
  });
}
const proj = await eda.dmt_Project.getCurrentProjectInfo();
return { project: proj && (proj.friendlyName || proj.name), ts: Date.now(), components, netflags, wires, texts, rectangles };
