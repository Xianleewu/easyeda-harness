const SIG_NETS = new Set([
  'RESET_EN', 'EXT_PWR_EN', 'RELAY1_EN', 'RELAY2_EN', 'BOOT_IO9',
  'USB_DN', 'USB_DP', 'USB_CC1', 'USB_CC2',
  'PMOS_GATE', 'PGATE_PULL', 'Q2_GATE',
  'RLY1_GATE', 'RLY1_COIL_A', 'RLY1_COIL_V',
  'RLY2_GATE', 'RLY2_COIL_A', 'RLY2_COIL_V',
]);
const LEFT_BOTTOM = 6;
const RIGHT_BOTTOM = 8;
const round = v => Math.round(Number(v) * 100) / 100;
const lineKey = l => (l || []).map(round).join(',');
const anchors = new Map([
  ['USB_DN|405,1040,500,1040', { x: 405, y: 1040, alignMode: LEFT_BOTTOM }],
  ['USB_DP|405,1010,500,1010', { x: 405, y: 1010, alignMode: LEFT_BOTTOM }],
  ['RESET_EN|740,490,835,490', { x: 835, y: 490, alignMode: RIGHT_BOTTOM }],
  ['BOOT_IO9|1040,510,1115,510', { x: 1115, y: 510, alignMode: RIGHT_BOTTOM }],
  ['RESET_EN|760,855,800,855', { x: 760, y: 855, alignMode: LEFT_BOTTOM }],
  ['EXT_PWR_EN|760,845,800,845', { x: 760, y: 845, alignMode: LEFT_BOTTOM }],
  ['RELAY1_EN|760,835,800,835', { x: 760, y: 835, alignMode: LEFT_BOTTOM }],
  ['RELAY2_EN|760,825,800,825', { x: 760, y: 825, alignMode: LEFT_BOTTOM }],
  ['BOOT_IO9|760,795,800,795', { x: 760, y: 795, alignMode: LEFT_BOTTOM }],
  ['USB_DN|760,745,800,745', { x: 760, y: 745, alignMode: LEFT_BOTTOM }],
  ['USB_DP|760,735,800,735', { x: 760, y: 735, alignMode: LEFT_BOTTOM }],
  ['EXT_PWR_EN|1095,725,1200,725', { x: 1095, y: 725, alignMode: LEFT_BOTTOM }],
  ['RELAY1_EN|1515,740,1610,740', { x: 1515, y: 740, alignMode: LEFT_BOTTOM }],
  ['RELAY2_EN|1515,495,1610,495', { x: 1515, y: 495, alignMode: LEFT_BOTTOM }],
]);
function pointOnPolyline(x, y, line) {
  if (!line || line.length < 4) return false;
  const px = Number(x), py = Number(y);
  for (let i = 0; i + 3 < line.length; i += 2) {
    const x1 = Number(line[i]), y1 = Number(line[i + 1]);
    const x2 = Number(line[i + 2]), y2 = Number(line[i + 3]);
    if (Math.abs(y1 - y2) < 0.01 && Math.abs(py - y1) < 0.01) {
      if (px >= Math.min(x1, x2) - 0.01 && px <= Math.max(x1, x2) + 0.01) return true;
    }
    if (Math.abs(x1 - x2) < 0.01 && Math.abs(px - x1) < 0.01) {
      if (py >= Math.min(y1, y2) - 0.01 && py <= Math.max(y1, y2) + 0.01) return true;
    }
  }
  return false;
}
const modelSigAnchors = [
  { net: 'USB_DN', x: 405, y: 1040, alignMode: LEFT_BOTTOM },
  { net: 'USB_DP', x: 405, y: 1010, alignMode: LEFT_BOTTOM },
  { net: 'RESET_EN', x: 835, y: 490, alignMode: RIGHT_BOTTOM },
  { net: 'BOOT_IO9', x: 1115, y: 510, alignMode: RIGHT_BOTTOM },
  { net: 'RESET_EN', x: 760, y: 855, alignMode: LEFT_BOTTOM },
  { net: 'EXT_PWR_EN', x: 760, y: 845, alignMode: LEFT_BOTTOM },
  { net: 'RELAY1_EN', x: 760, y: 835, alignMode: LEFT_BOTTOM },
  { net: 'RELAY2_EN', x: 760, y: 825, alignMode: LEFT_BOTTOM },
  { net: 'BOOT_IO9', x: 760, y: 795, alignMode: LEFT_BOTTOM },
  { net: 'USB_DN', x: 760, y: 745, alignMode: LEFT_BOTTOM },
  { net: 'USB_DP', x: 760, y: 735, alignMode: LEFT_BOTTOM },
  { net: 'EXT_PWR_EN', x: 1095, y: 725, alignMode: LEFT_BOTTOM },
  { net: 'RELAY1_EN', x: 1515, y: 740, alignMode: LEFT_BOTTOM },
  { net: 'RELAY2_EN', x: 1515, y: 495, alignMode: LEFT_BOTTOM },
];
function fallbackAnchor(net, line) {
  if (!SIG_NETS.has(net) || !line || line.length < 4) return null;
  const exact = modelSigAnchors.find(a => a.net === net && pointOnPolyline(a.x, a.y, line));
  if (exact) return exact;
  let best = null;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const x1 = Number(line[i]), y1 = Number(line[i + 1]);
    const x2 = Number(line[i + 2]), y2 = Number(line[i + 3]);
    if (Math.abs(y1 - y2) >= 0.01) continue;
    const len = Math.abs(x2 - x1);
    if (!best || len > best.len) {
      const left = x1 <= x2 ? { x: x1, y: y1 } : { x: x2, y: y2 };
      best = { ...left, alignMode: LEFT_BOTTOM, len };
    }
  }
  if (best) return { x: best.x, y: best.y, alignMode: best.alignMode };
  return { x: Number(line[0]), y: Number(line[1]), alignMode: LEFT_BOTTOM };
}
const textIds = await eda.sch_PrimitiveText.getAllPrimitiveId().catch(() => []) || [];
let deletedFakeTexts = 0;
if (textIds.length) {
  const kill = [];
  for (const id of textIds) {
    const t = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(() => null);
    const content = String(t && (t.content || (t.getState_Content && t.getState_Content())) || '').trim();
    if (SIG_NETS.has(content)) kill.push(id);
  }
  if (kill.length) {
    await eda.sch_PrimitiveText.delete(kill);
    deletedFakeTexts = kill.length;
  }
}
const wires = await eda.sch_PrimitiveWire.getAll().catch(() => []) || [];
let shown = 0, hidden = 0, missingName = 0;
const changed = [];
for (const w of wires) {
  const id = w.primitiveId || (w.getState_PrimitiveId && w.getState_PrimitiveId());
  if (!id) continue;
  const net = String(w.net || (w.getState_Net && w.getState_Net()) || '');
  const line = w.line || (w.getState_Line && w.getState_Line()) || [];
  const explicit = anchors.get(`${net}|${lineKey(line)}`);
  const target = explicit || fallbackAnchor(net, line);
  const attrs = await eda.sch_PrimitiveAttribute.getAll(id).catch(() => []) || [];
  const a = attrs.find(x => String(x.key || (x.getState_Key && x.getState_Key()) || '') === 'Name');
  if (!a) {
    if (target) missingName++;
    continue;
  }
  const aid = a.primitiveId || (a.getState_PrimitiveId && a.getState_PrimitiveId());
  if (target) {
    await eda.sch_PrimitiveAttribute.modify(aid, {
      x: target.x,
      y: target.y,
      rotation: 0,
      alignMode: target.alignMode,
      keyVisible: false,
      valueVisible: true,
    });
    shown++;
    changed.push({ net, line, x: target.x, y: target.y, alignMode: target.alignMode });
  } else {
    await eda.sch_PrimitiveAttribute.modify(aid, { keyVisible: false, valueVisible: false });
    hidden++;
  }
}
return { deletedFakeTexts, shown, hidden, missingName, changed };
