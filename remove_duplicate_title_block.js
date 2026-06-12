const DUP_TEXT = [
  /^AIHWDEBUGER CONTROL & POWER$/i,
  /^P1 DETAIL SCHEMATIC$/i,
  /^PROJECT:\s*AIHWDEBUGER$/i,
  /^REV:\s*A\s*\|\s*STATUS:\s*REVIEW$/i,
  /^SHEET:\s*1\s+OF\s+1$/i,
  /^SOURCE:\s*HARNESS PASS$/i,
  /^USB\/power\s*->\s*ESP32-C3\s*->\s*switched and relay outputs$/i,
  /^DRC:\s*0 ERR\s*\/\s*0 WARN\s*\/\s*0 INFO$/i,
];
function bboxFromRaw(r) {
  if (!r) return null;
  if ([r.minX, r.minY, r.maxX, r.maxY].every(v => typeof v === 'number')) return r;
  if ([r.x, r.y, r.width, r.height].every(v => typeof v === 'number')) {
    return { minX: Math.min(r.x, r.x + r.width), maxX: Math.max(r.x, r.x + r.width), minY: Math.min(r.y, r.y + r.height), maxY: Math.max(r.y, r.y + r.height) };
  }
  return null;
}
const textIds = await eda.sch_PrimitiveText.getAllPrimitiveId().catch(() => []) || [];
const killTexts = [];
for (const id of textIds) {
  const t = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(() => null);
  const content = String(t && (t.content || (t.getState_Content && t.getState_Content())) || '').trim();
  if (DUP_TEXT.some(re => re.test(content))) killTexts.push(id);
}
const rectIds = await eda.sch_PrimitiveRectangle.getAllPrimitiveId().catch(() => []) || [];
const killRects = [];
for (const id of rectIds) {
  const r = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(() => null);
  const b = bboxFromRaw(await eda.sch_Primitive.getPrimitivesBBox([id]).catch(() => null));
  if (!b) continue;
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const color = String(r && (r.color || (r.getState_Color && r.getState_Color())) || '').toLowerCase();
  const gray = !color || ['#606060', '#6f6f6f', '#9a9a9a'].includes(color);
  const isSheetFrame = gray && width > 1200 && height > 650;
  const isDuplicateTitleBlock = gray && width > 350 && width < 650 && height > 60 && height < 140 && b.minX > 1200;
  if (isSheetFrame || isDuplicateTitleBlock) killRects.push(id);
}
if (killTexts.length) await eda.sch_PrimitiveText.delete(killTexts);
if (killRects.length) await eda.sch_PrimitiveRectangle.delete(killRects);
return { deletedTexts: killTexts.length, deletedRects: killRects.length, killTexts, killRects };
