// src2model: 文档源 → 渲染器可用的快照模型（真理源直读，不经 getAll）
// 用法: node src2model.mjs [src.txt] [out.json]  (缺省 last_commit_after.txt → src_model.json)
import { readFileSync, writeFileSync } from 'node:fs';

const inPath = process.argv[2] || 'last_commit_after.txt';
const outPath = process.argv[3] || 'src_model.json';
const src = readFileSync(inPath, 'utf8');

const recs = [];
for (const l of src.split('\n')) {
  const h = l.indexOf('||'); if (h < 0) continue;
  try { recs.push({ head: JSON.parse(l.slice(0, h)), atom: JSON.parse(l.slice(h + 2).replace(/\|$/, '')) }); } catch (e) {}
}

// ATTR 归属: parentId → list
const attrsOf = new Map();
for (const r of recs) if (r.head.type === 'ATTR' && r.atom.parentId) {
  if (!attrsOf.has(r.atom.parentId)) attrsOf.set(r.atom.parentId, []);
  attrsOf.get(r.atom.parentId).push(r.atom);
}
// WIRE 组: lineGroup → 段集
const segsOf = new Map();
for (const r of recs) if (r.head.type === 'LINE' && r.atom.lineGroup) {
  if (!segsOf.has(r.atom.lineGroup)) segsOf.set(r.atom.lineGroup, []);
  segsOf.get(r.atom.lineGroup).push(r.atom);
}

const components = [], netflags = [], wires = [];
for (const r of recs) {
  if (r.head.type === 'WIRE') {
    const segs = segsOf.get(r.head.id) || [];
    const net = (attrsOf.get(r.head.id) || []).find(a => a.key === 'NET')?.value || '';
    for (const s of segs) wires.push({ id: r.head.id + '#', net, line: [s.startX, -s.startY, s.endX, -s.endY] });   // 源y上→屏幕y下
    continue;
  }
  if (r.head.type !== 'COMPONENT') continue;
  const at = attrsOf.get(r.head.id) || [];
  const des = at.find(a => a.key === 'Designator')?.value;
  const gnn = at.find(a => a.key === 'Global Net Name')?.value;
  if (gnn) { netflags.push({ type: 'netflag', net: gnn, x: r.atom.x, y: -r.atom.y, rotation: r.atom.rotation || 0, bbox: { minX: r.atom.x - 8, minY: -r.atom.y - 8, maxX: r.atom.x + 8, maxY: -r.atom.y + 8 } }); continue; }
  if (des) { components.push({ id: r.head.id, designator: des, x: r.atom.x, y: -r.atom.y, rotation: r.atom.rotation || 0, mirror: !!r.atom.isMirror, bbox: null, pins: [] }); continue; }
}

// 标签(NET ATTR 挂在 WIRE 上)→ 附到对应线(渲染层用 wires[i].label)
const labels = [];
for (const r of recs) if (r.head.type === 'ATTR' && r.atom.key === 'NET' && r.atom.valueVisible !== false)
  labels.push({ net: r.atom.value, x: r.atom.x, y: -r.atom.y, parentId: r.atom.parentId });

writeFileSync(outPath, JSON.stringify({ components, netflags, wires, labels, texts: [], rectangles: [] }));
console.log(`源→模型: 件 ${components.length} 旗标 ${netflags.length} 线段 ${wires.length} 可见标签 ${labels.length}`);
