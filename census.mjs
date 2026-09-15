// 缺陷分区普查 v2:适配 geomQC/labelQC 真实输出(字符串型 finding 带 refdes,坐标型直接定位)。
import { readFileSync } from 'node:fs';
import { geomQC } from './engine/geom_qc.mjs';
import { labelQC } from './engine/label_qc.mjs';
import { netQC } from './engine/net_qc.mjs';

const snap = JSON.parse(readFileSync(process.argv[2] || 'live.json', 'utf8').replace(/^﻿/, ''));

const anchors = [], compPos = new Map();
for (const c of snap.components) {
  if (!c.designator) continue;
  const cx = c.bbox ? (c.bbox.minX + c.bbox.maxX) / 2 : c.x, cy = c.bbox ? (c.bbox.minY + c.bbox.maxY) / 2 : c.y;
  compPos.set(c.designator, [cx, cy]);
  if (/^(U\d+|CON\d+|CN\d+|J\d+|P\d+)$/.test(c.designator)) anchors.push({ d: c.designator, cx, cy });
}
const nearestXY = (x, y) => anchors.reduce((b, a) => Math.hypot(a.cx - x, a.cy - y) < Math.hypot(b.cx - x, b.cy - y) ? a : b, anchors[0]).d;
const modOfRefdes = r => { const p = compPos.get(r); return p ? nearestXY(p[0], p[1]) : '未定位'; };

const buckets = new Map();
const put = (mod, cat) => { if (!buckets.has(mod)) buckets.set(mod, {}); const c = buckets.get(mod); c[cat] = (c[cat] || 0) + 1; };
const REF = /\b(?:U|CON|CN|J|P|R|C|L|FB|RN|D|Y|Q|T|SW|K|F|TP)\d+\b/g;
const byRefStr = (s, cat) => { const m = String(s).match(REF); put(m ? modOfRefdes(m[0]) : '未定位', cat); };

// 斜线 / netQC 坐标型 → 就近锚点
for (const w of snap.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 4) if (l[i + 2] - l[i] !== 0 && l[i + 3] - l[i + 1] !== 0) { put(nearestXY((l[i] + l[i + 2]) / 2, (l[i + 1] + l[i + 3]) / 2), '斜线'); break; } }
const n = netQC(snap);
for (const s of n.strayPowerFlags) put(nearestXY(s.x, s.y), '杂散电源标');
for (const m of n.malformedWires) put(nearestXY(m.at[0], m.at[1]), '畸形线');
for (const d of n.danglingFlags) put(nearestXY(d.x, d.y), '悬空标');
for (const f of snap.netflags.filter(f => f.type === 'netport')) put(nearestXY(f.x, f.y), 'netport');
// geomQC 字符串型
const g = geomQC(snap);
for (const s of g.wireThruComp || []) byRefStr(String(s).split('thru')[1], '线穿件');
for (const s of g.wireThruPin || []) byRefStr(String(s), '线穿脚');
for (const s of g.overlaps || []) byRefStr(String(s), '重叠');
for (const s of g.textOnWire || []) byRefStr(String(s), '文字压线');
// labelQC
for (const f of labelQC(snap).filter(f => f.severity === 'hard')) put(f.where?.comp ? modOfRefdes(f.where.comp) : '未定位', '标签硬伤');

console.log('锚点:', anchors.map(a => `${a.d}@${Math.round(a.cx)},${Math.round(a.cy)}`).join('  '));
console.log('\n=== 模块缺陷表(硬缺陷总数排序) ===');
const rows = [...buckets.entries()].map(([mod, cats]) => ({ mod, total: Object.values(cats).reduce((a, b) => a + b, 0), cats })).sort((a, b) => b.total - a.total);
for (const r of rows) console.log(`${r.mod.padEnd(6)} 共${String(r.total).padStart(4)}  ${Object.entries(r.cats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`\n总计 ${rows.reduce((a, r) => a + r.total, 0)} 处`);
console.log('\noverlaps 明细前12:', JSON.stringify((g.overlaps || []).slice(0, 12)));
console.log('wireThruPin 明细:', JSON.stringify(g.wireThruPin));
console.log('wireThruComp 明细:', JSON.stringify(g.wireThruComp));
