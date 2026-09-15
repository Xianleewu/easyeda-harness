// assert_source: 源级棘轮断言 —— 本工程全部教训的机器化。零特定电路。
// 用法: import { assertSource } from './assert_source.mjs'; const r = assertSource(srcString);
// 每条断言都源自一次真实事故(注释注明),新教训 → 新断言(棘轮,只增不减)。
import { readFileSync } from 'node:fs';

export function parseSource(src) {
  const recs = [];
  for (const l of String(src).split('\n')) {
    const h = l.indexOf('||'); if (h < 0) continue;
    try { recs.push({ head: JSON.parse(l.slice(0, h)), atom: JSON.parse(l.slice(h + 2).replace(/\|$/, '')) }); } catch (e) { /* 坏行由 A0 抓 */ }
  }
  return recs;
}

// 真盒模型(2026-09-09 getPrimitivesBBox 实测标定): RIGHT_BOTTOM=锚左下 [x-w,x]×[y,y+8]; LEFT_BOTTOM=锚右下。
const CHAR_W = 4.6, TXT_H = 8, GAP = 1;   // 保守字宽 + 1 单位安全边
const labelBox = l => {
  const w = String(l.value).length * CHAR_W + GAP;
  const a = String(l.align || '');
  if (a.includes('RIGHT')) return { x1: l.x - w, y1: l.y, x2: l.x, y2: l.y + TXT_H };
  if (a.includes('LEFT'))  return { x1: l.x, y1: l.y, x2: l.x + w, y2: l.y + TXT_H };
  return { x1: l.x - w / 2, y1: l.y, x2: l.x + w / 2, y2: l.y + TXT_H };   // align=null 居中估
};

export function assertSource(src, { componentTypes = {} } = {}) {
  const recs = parseSource(src);
  const F = [];   // findings: {rule, sev, detail}
  const add = (rule, sev, detail) => F.push({ rule, sev, detail });

  const wireIds = new Set(recs.filter(r => r.head.type === 'WIRE').map(r => r.head.id));
  const comps = recs.filter(r => r.head.type === 'COMPONENT');
  const attrs = recs.filter(r => r.head.type === 'ATTR');
  const gnn = new Map();
  for (const a of attrs) if (a.atom.key === 'Global Net Name' && a.atom.parentId) gnn.set(a.atom.parentId, a.atom.value);
  const des = new Map();
  for (const a of attrs) if (a.atom.key === 'Designator' && a.atom.parentId) des.set(a.atom.parentId, a.atom.value);

  // A1 坏行(源完整性)
  let bad = 0;
  for (const l of String(src).split('\n')) { const h = l.indexOf('||'); if (h < 0) continue; try { JSON.parse(l.slice(0, h)); JSON.parse(l.slice(h + 2).replace(/\|$/, '')); } catch (e) { bad++; } }
  if (bad) add('A1-source-integrity', 'fatal', `${bad} 坏行`);

  // A2 DR17: netport 禁止(引擎 repair-nets 曾量产 netport)
  // Source COMPONENT records do not encode the library's semantic type.
  // Read it from the live primitive (or an independently verified snapshot).
  // A sheet has no designator; that alone must not classify it as a net port.
  const ports = comps.filter(c => {
    const type = componentTypes[c.head.id];
    if (type === 'netport') return true;
    if (type === 'sheet') return false;
    return !des.get(c.head.id) && !gnn.has(c.head.id);
  });
  if (ports.length) add('A2-no-netport', 'hard', `${ports.length} 个 netport 或类型未验证的无名符号`);

  // A3 标签真实互叠(错列事故 → 真盒标定;同侧单列即 0)
  // EasyEDA materializes hidden wire bindings with valueVisible:null.  Only an
  // explicit true is rendered text; treating null as visible creates phantom
  // labels, false overlap findings, and blocks otherwise valid repair stages.
  const labs = attrs.filter(a => a.atom.key === 'NET' && a.atom.valueVisible === true && String(a.atom.value || '').trim())
    .map(a => ({ value: a.atom.value, x: a.atom.x, y: -(a.atom.y ?? 0), align: a.atom.align, id: a.head.id, parent: a.atom.parentId }));
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const a = labelBox(labs[i]), b = labelBox(labs[j]);
    if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2)
      add('A3-label-overlap', 'hard', `${labs[i].value}@${Math.round(labs[i].x)},${Math.round(labs[i].y)} × ${labs[j].value}@${Math.round(labs[j].x)},${Math.round(labs[j].y)}`);
  }

  // A4 同线重复标签(R=22 跨线误删教训 → 只查同 parentId)
  const byParent = new Map();
  for (const l of labs) { if (!byParent.has(l.parent)) byParent.set(l.parent, []); byParent.get(l.parent).push(l); }
  for (const [p, ls] of byParent) if (ls.length > 1)
    add('A4-dup-label-per-wire', 'hard', `线${String(p).slice(0, 8)} 带 ${ls.length} 个标签(${ls.map(l => l.value).join(',')})`);

  // A5 孤儿标签(父线已亡)——工程 verify 前置
  for (const l of labs) if (l.parent && !wireIds.has(l.parent))
    add('A5-orphan-label', 'hard', `${l.value}@${Math.round(l.x)},${Math.round(l.y)} 父线不存在`);

  // A6 align=null NET 标签(引擎遗留,几何不可预测)
  const nullAlign = labs.filter(l => !l.align);
  if (nullAlign.length) add('A6-null-align-label', 'hard', `${nullAlign.length} 个 null 对齐标签`);

  // A6c:水平端点标签保留 90° 旋转是肉眼可见的坏标注。空 NET 是
  // EasyEDA 自动再生且不渲染的直连线占位，不属于可见标签人口。
  const rotatedLabels = attrs.filter(a => a.atom.key === 'NET' && a.atom.valueVisible === true && String(a.atom.value || '').trim()
    && Number.isFinite(Number(a.atom.rotation)) && ((Number(a.atom.rotation) % 180) + 180) % 180 !== 0);
  if (rotatedLabels.length) add('A6c-rotated-net-label', 'hard', `${rotatedLabels.length} 个非水平 NET 标签`);

  // 非地电源符号若 Name/GNN 都被显式隐藏，页面只剩无名图形，无法审图。
  const isGround = n => /(^|[_\-./])(a|d|p)?gnd\d*([_\-./]|$)|(^|[_\-./])v(ss|ee)\d*([_\-./]|$)/i.test(String(n || ''));
  let hiddenPowerNames = 0;
  for (const c of comps) {
    const aa = attrs.filter(a => a.atom.parentId === c.head.id);
    const global = aa.find(a => a.atom.key === 'Global Net Name');
    if (!global || isGround(global.atom.value)) continue;
    const name = aa.find(a => a.atom.key === 'Name');
    if (global.atom.valueVisible === false && (!name || name.atom.valueVisible === false)) hiddenPowerNames++;
  }
  if (hiddenPowerNames) add('A6d-hidden-power-net-name', 'hard', `${hiddenPowerNames} 个非地电源符号没有可见网名`);
  const rotatedPowerNames = attrs.filter(a => a.atom.key === 'Global Net Name' && !isGround(a.atom.value)
    && a.atom.valueVisible !== false && Number.isFinite(Number(a.atom.rotation))
    && ((Number(a.atom.rotation) % 180) + 180) % 180 !== 0);
  if (rotatedPowerNames.length) add('A6e-rotated-power-net-name', 'hard', `${rotatedPowerNames.length} 个非水平电源网名`);

  // A netflag library carries both Name and Global Net Name.  EasyEDA treats
  // null visibility on these bound fields as inherited/default visibility, so
  // leaving both non-false renders duplicate text (often one rotated with the
  // parent symbol).  Exactly the Global Net Name is allowed to remain visible.
  let duplicatePowerNames = 0;
  for (const c of comps) {
    const aa = attrs.filter(a => a.atom.parentId === c.head.id);
    const global = aa.find(a => a.atom.key === 'Global Net Name');
    const name = aa.find(a => a.atom.key === 'Name');
    if (!global || !name || isGround(global.atom.value)) continue;
    if (global.atom.valueVisible !== false && name.atom.valueVisible !== false &&
        String(global.atom.value || '') === String(name.atom.value || '')) duplicatePowerNames++;
  }
  if (duplicatePowerNames) add('A6f-duplicate-power-net-name', 'hard', `${duplicatePowerNames} 个电源符号同时显示 Name 与 Global Net Name`);

  // A7 重复旗标(同网同位)——超时重试事故
  const fseen = new Set();
  for (const c of comps) {
    const net = gnn.get(c.head.id); if (!net) continue;
    const k = net + '|' + Math.round(c.atom.x / 4) + ',' + Math.round(c.atom.y / 4);
    if (fseen.has(k)) add('A7-dup-flag', 'hard', `${net}@${Math.round(c.atom.x)},${Math.round(c.atom.y)}`);
    fseen.add(k);
  }

  // A8 重复位号
  const dcount = new Map();
  for (const [, d] of des) dcount.set(d, (dcount.get(d) || 0) + 1);
  for (const [d, n] of dcount) if (/^(U|CON|CN|J|P|R|C|L|D|X|LED)\d+$/.test(d) && n > 1) add('A8-dup-designator', 'hard', `${d}×${n}`);

  // A9 零长线段(吸附伪影)
  let zl = 0;
  for (const r of recs) if (r.head.type === 'LINE' && r.atom.startX === r.atom.endX && r.atom.startY === r.atom.endY) zl++;
  if (zl) add('A9-zero-length-line', 'soft', `${zl} 段`);

  // A10 斜线段(段式解析 i+=4 教训)
  let diag = 0;
  for (const r of recs) if (r.head.type === 'LINE' && r.atom.startX !== r.atom.endX && r.atom.startY !== r.atom.endY) diag++;
  if (diag) add('A10-diagonal-line', 'hard', `${diag} 段`);

  const hard = F.filter(f => f.sev !== 'soft').length;
  return { findings: F, hard, summary: `断言:${F.length} 项(硬 ${hard}) | 件 ${comps.length - ports.length} 旗标 ${gnn.size} 线 ${wireIds.size} 标签 ${labs.length}` };
}

if (process.argv[1] && process.argv[1].endsWith('assert_source.mjs')) {
  const src = readFileSync(process.argv[2] || 'last_commit_after.txt', 'utf8');
  const r = assertSource(src);
  console.log(r.summary);
  for (const f of r.findings.slice(0, 20)) console.log(` [${f.sev}] ${f.rule}: ${f.detail}`);
  console.log(r.hard === 0 ? '✅ 源级断言全绿' : `✗ 硬断言 ${r.hard} 项`);
  process.exit(r.hard === 0 ? 0 : 1);
}
