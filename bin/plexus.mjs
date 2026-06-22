#!/usr/bin/env node
// 通用原理图美化工具入口(零特定电路内容)。
// 像前端设计工作流:输入【任意】原理图快照 → 角色化聚类 + schematic-aware 单元 + 2D 商业排版
// → 渲染 + 几何/标签门校验 → 可投递到 live EDA。不含任何特定电路的器件/网名/模块信息。
import { readFileSync } from 'node:fs';
import { generateLayout, deliverGenerated } from '../engine/cluster_generate.mjs';
import { geomQC } from '../engine/geom_qc.mjs';
import { labelQC } from '../engine/label_qc.mjs';

function loadSnap(file) {
	if (!file) throw new Error('需要快照文件路径');
	return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

// 通用几何/标签门(任意板):DR1 正交 / DR2 交叉·短路 / DR3 线穿件·脚 / DR4-5 重叠 / 标签硬伤。
function reportGates(model) {
	const g = geomQC(model);
	let diag = 0;
	for (const w of model.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 2) if (l[i + 2] - l[i] !== 0 && l[i + 3] - l[i + 1] !== 0) diag++; }
	const lh = labelQC(model).filter(f => f.severity === 'hard').length;
	const shorts = g.collinear + g.endpointShort + g.endpointOnWire;
	const total = diag + g.crossings + shorts + g.wireThruComp.length + g.wireThruPin.length + g.overlaps.length + lh;
	console.log(`门: 正交斜线=${diag} 异网交叉=${g.crossings} 短路=${shorts} 线穿件=${g.wireThruComp.length} 线穿脚=${g.wireThruPin.length} 重叠=${g.overlaps.length} 标签硬伤=${lh}`);
	console.log(total === 0 ? '✅ 几何/标签门全 0' : `✗ 剩 ${total} 处`);
	return total;
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);

	if (cmd === 'layout') {
		const snap = loadSnap(args[0]);
		const out = args.find(a => /\.png$/.test(a)) || 'layout.png';
		const r = await generateLayout(snap, {});
		if (!r) { console.error('未找到 IC 锚点(U/FPC/J),无法聚类。'); process.exit(1); }
		const { renderSheetOutput } = await import('../engine/sheet_renderer.mjs');
		renderSheetOutput(r.model, out, { moduleRegions: r.moduleRegions });
		console.log(`生成: ${r.stats.clusters} 模块 / ${r.stats.components} 件 / ${r.stats.wires} 线 / ${r.stats.nets} 网`);
		reportGates(r.model);
		console.log(`渲染 -> ${out}`);
		return;
	}

	if (cmd === 'deliver') {
		const snap = loadSnap(args[0]);
		await deliverGenerated(snap, { });
		return;
	}

	if (cmd === 'repair') {
		// 通用网级修复闭环(任意 live 板):netRepairPlan → 经 bridge 应用(删杂散电源短路标 / 拉直畸形线)→ 报 DRC 前后。
		// 仅做 schematic 层安全可修项;ERC 引脚类型(需符号库)与短路(需人判)只报告不自动改。
		const snap = loadSnap(args[0]);
		const { netRepairPlan } = await import('../engine/net_qc.mjs');
		const plan = netRepairPlan(snap);
		console.log(`修复规划:可自动修 ${plan.autoFixable} 处;需手工 ${JSON.stringify(plan.manualOnly)}`);
		if (!plan.autoFixable) { console.log('✅ 无 schematic 层可自动修缺陷'); return; }
		const { executeCode } = await import('../engine/bridge_client.mjs');
		const js = `
const before = await eda.sch_Drc.check(true,true,true);
const ops = ${JSON.stringify(plan.ops)};
let done = 0;
// 删杂散电源短路标:按 net+坐标定位 netflag 删除
for (const op of ops.filter(o=>o.kind==='delete-flag')) {
  const ids = (await eda.sch_PrimitiveComponent.getAllPrimitiveId())||[];
  for (const id of ids) { const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(()=>null);
    if (c && (c.componentType==='netflag'||c.componentType==='netport') && c.net===op.net && Math.abs((c.x||0)-op.x)<=2 && Math.abs((c.y||0)-op.y)<=2) { try{ await eda.sch_PrimitiveComponent.delete([id]); done++; }catch(e){} break; } }
}
// 拉直畸形线:找含回折/零长的线,替换为去重直化版
const dedup = l => { const o=[]; for(let i=0;i<l.length;i+=2){ if(o.length>=2&&o[o.length-2]===l[i]&&o[o.length-1]===l[i+1])continue; o.push(l[i],l[i+1]); } const p=[]; for(let i=0;i+5<o.length;i+=2){ if(o[i]===o[i+4]&&o[i+1]===o[i+5]){ const xs=o.filter((_,k)=>k%2===0),ys=o.filter((_,k)=>k%2===1); const horiz=Math.max(...ys)-Math.min(...ys)<Math.max(...xs)-Math.min(...xs); return horiz?[Math.min(...xs),ys[0],Math.max(...xs),ys[0]]:[xs[0],Math.min(...ys),xs[0],Math.max(...ys)]; } } return o; };
if (ops.some(o=>o.kind==='straighten-wire')) {
  const ws = (await eda.sch_PrimitiveWire.getAll())||[];
  for (const w of ws) { const l=w.line||[]; let mal=false; for(let i=0;i+5<l.length;i+=2)if(l[i]===l[i+4]&&l[i+1]===l[i+5])mal=true; for(let i=0;i+3<l.length;i+=2)if(l[i]===l[i+2]&&l[i+1]===l[i+3])mal=true;
    if(mal){ const id=w.primitiveId; const clean=dedup(l); try{ await eda.sch_PrimitiveWire.delete([id]); await eda.sch_PrimitiveWire.create(clean, w.net||''); done++; }catch(e){} } }
}
let after; for(let i=0;i<3;i++) after = await eda.sch_Drc.check(true,true,true);
return { done, before: before.map(x=>x.type[0]+x.count).join('/'), after: after.map(x=>x.type[0]+x.count).join('/') };
`;
		const res = (await executeCode(js, { timeoutMs: 90000 })).result;
		console.log(`已应用 ${res.done} 处修复;DRC ${res.before} → ${res.after}`);
		console.log(`剩余需符号库手修(引脚电气类型)等见 \`plexus qc\` 与 /tmp/drc_fix_checklist.md`);
		return;
	}

	if (cmd === 'qc') {
		// 通用网级体检(任意板):短路 / 杂散电源标 / 畸形线 / 悬空标。DRC 前自查,定位需修缺陷。
		const snap = loadSnap(args[0]);
		const { netQC } = await import('../engine/net_qc.mjs');
		const r = netQC(snap);
		const line = (label, arr, fmt) => console.log(`${label}=${arr.length}${arr.length ? '  ' + arr.slice(0, 8).map(fmt).join('  ') : ''}`);
		line('短路', r.shorts, s => `{${s.nets.join(',')}}`);
		line('杂散电源标', r.strayPowerFlags, s => `${s.flag}@(${s.x},${s.y})→${s.onNet}`);
		line('畸形线', r.malformedWires, s => `${s.kind}@${s.at}`);
		line('ERC引脚类型', r.ercPinType || [], s => `${s.ref}=${s.pinType}(应${s.expect})`);
		line('悬空标', r.danglingFlags, s => `${s.net}@(${s.x},${s.y})`);
		const total = r.shorts.length + r.strayPowerFlags.length + r.malformedWires.length;
		const erc = (r.ercPinType || []).length;
		console.log(total === 0 ? '✅ 网级体检无硬缺陷' : `✗ 网级硬缺陷 ${total} 处(悬空标 ${r.danglingFlags.length} 软提示)`);
		if (erc) console.log(`⚠ ERC 引脚类型疑似错标 ${erc} 处(无源件脚非 Passive)→ 需符号库修引脚类型,非布线问题`);
		return;
	}

	if (cmd === 'audit') {
		// 综合布局质量诊断(任意板):6 大类(连接/走线/间距/电源地/标注/结构)按严重度量化,商业化评估标准。
		const snap = loadSnap(args[0]);
		const { layoutAudit } = await import('../engine/layout_audit.mjs');
		const rep = layoutAudit(snap);
		console.log(`布局质量诊断:总 ${rep.summary.total} 问题 | 严重度 ${JSON.stringify(rep.summary.byCriticality)}`);
		console.log(`类别分布:${JSON.stringify(rep.summary.byCategory)}`);
		for (const [cat, d] of Object.entries(rep.categories)) {
			console.log(`\n【${cat}】 ${d.count}`);
			const ind = Object.entries(d).filter(([k]) => !['count', 'items'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ');
			if (ind) console.log(`  指标:${ind}`);
			for (const it of (d.items || []).slice(0, 8)) console.log(`  · [${it.sev || '?'}] ${it.msg}`);
		}
		console.log(`\n改进路线图见 docs/schematic-commercialization-roadmap.md(P0 网表完整→P1 重排投递→P2 标注/电源地→P3 符号库 ERC)`);
		return;
	}

	console.log(`通用原理图美化工具(公共工具,零特定电路内容)

用法:
  node bin/plexus.mjs layout  <snapshot.json> [out.png]   离线:任意板快照 → 商业 2D 布局 + 渲染 + 门校验
  node bin/plexus.mjs audit   <snapshot.json>             商业化布局质量诊断:6 类(连接/走线/间距/电源地/标注/结构)按严重度
  node bin/plexus.mjs qc      <snapshot.json>             网级体检:短路 / 杂散电源标 / 畸形线 / ERC引脚类型 / 悬空标
  node bin/plexus.mjs repair  <snapshot.json>             自动修复(删杂散电源短路标 / 拉直畸形线)并报 DRC 前后
  node bin/plexus.mjs deliver <snapshot.json>             生成布局并投递到当前 live EDA 文档

快照获取(从 live EDA 捕获任意板):
  npm run live:save        # -> live.json`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
