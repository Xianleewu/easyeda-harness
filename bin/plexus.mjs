#!/usr/bin/env node
// 通用原理图美化工具入口(零特定电路内容)。
// 像前端设计工作流:输入【任意】原理图快照 → 角色化聚类 + schematic-aware 单元 + 2D 商业排版
// → 渲染 + 几何/标签门校验 → 可投递到 live EDA。不含任何特定电路的器件/网名/模块信息。
import { readFileSync, writeFileSync } from 'node:fs';
import { generateLayout, deliverGenerated } from '../engine/cluster_generate.mjs';
import { geomQC } from '../engine/geom_qc.mjs';
import { labelQC } from '../engine/label_qc.mjs';

function loadSnap(file) {
	if (!file) throw new Error('需要快照文件路径');
	return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function option(args, name, fallback = '') {
	const index = args.indexOf(name);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function positional(args, valuedOptions = []) {
	const values = new Set(valuedOptions);
	const out = [];
	for (let index = 0; index < args.length; index++) {
		if (values.has(args[index])) { index++; continue; }
		if (!args[index].startsWith('--')) out.push(args[index]);
	}
	return out;
}

function printPcbReport(report) {
	for (const result of report.results) console.log(`${result.pass ? '✅' : '✗'} ${result.id}: ${result.deviations.length}`);
	console.log(`deterministic: ${report.deterministicPass ? 'PASS' : 'FAIL'}; visual: ${report.visualReview?.status || 'required'}; final: ${report.pass ? 'PASS' : 'FAIL'}`);
}

// 通用几何/标签门(任意板):DR1 正交 / DR2 交叉·短路 / DR3 线穿件·脚 / DR4-5 重叠 / 标签硬伤。
function reportGates(model) {
	const g = geomQC(model);
	let diag = 0;
	for (const w of model.wires) { const l = w.line; for (let i = 0; i + 3 < l.length; i += 4) if (l[i + 2] - l[i] !== 0 && l[i + 3] - l[i + 1] !== 0) diag++; }
	const lh = labelQC(model).filter(f => f.severity === 'hard').length;
	const shorts = g.collinear + g.endpointShort + g.endpointOnWire;
	const total = diag + g.crossings + shorts + g.wireThruComp.length + g.wireThruPin.length + g.overlaps.length + lh;
	console.log(`门: 正交斜线=${diag} 异网交叉=${g.crossings} 短路=${shorts} 线穿件=${g.wireThruComp.length} 线穿脚=${g.wireThruPin.length} 重叠=${g.overlaps.length} 标签硬伤=${lh}`);
	console.log(total === 0 ? '✅ 几何/标签门全 0' : `✗ 剩 ${total} 处`);
	return total;
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);

	if (cmd === 'pcb-snapshot') {
		const [out = 'pcb-snapshot.json'] = positional(args, ['--window', '--pcb']);
		const { capturePcbSnapshot } = await import('../engine/pcb_live_snapshot.mjs');
		const snapshot = await capturePcbSnapshot({
			windowId: option(args, '--window', process.env.EASYEDA_WINDOW_ID || ''),
			pcbUuid: option(args, '--pcb'),
			outFile: out,
		});
		console.log(`PCB snapshot: ${snapshot.components.length} components / ${snapshot.designators.length} designators / ${snapshot.drc.findings.length} native DRC findings -> ${out}`);
		return;
	}

	if (cmd === 'pcb-qc') {
		const [snapshotFile, policyFile, reportFile = 'pcb-placement-report.json'] = args;
		if (!snapshotFile || !policyFile) throw new Error('用法: plexus pcb-qc <snapshot.json> <policy.json> [report.json]');
		const { judgePcbPlacement } = await import('../engine/pcb_placement_qc.mjs');
		const report = judgePcbPlacement(loadSnap(snapshotFile), loadSnap(policyFile));
		writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
		printPcbReport(report);
		console.log(`report -> ${reportFile}`);
		process.exit(report.pass ? 0 : 1);
	}

	if (cmd === 'pcb-judge-live') {
		const [policyFile] = positional(args, ['--window', '--pcb', '--snapshot', '--report']);
		if (!policyFile) throw new Error('用法: plexus pcb-judge-live <policy.json> [--window id] [--pcb uuid] [--snapshot file] [--report file]');
		const snapshotFile = option(args, '--snapshot', 'pcb-live-snapshot.json');
		const reportFile = option(args, '--report', 'pcb-live-placement-report.json');
		const { capturePcbSnapshot } = await import('../engine/pcb_live_snapshot.mjs');
		const { judgePcbPlacement } = await import('../engine/pcb_placement_qc.mjs');
		const snapshot = await capturePcbSnapshot({
			windowId: option(args, '--window', process.env.EASYEDA_WINDOW_ID || ''),
			pcbUuid: option(args, '--pcb'),
			outFile: snapshotFile,
		});
		const report = judgePcbPlacement(snapshot, loadSnap(policyFile));
		writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
		printPcbReport(report);
		console.log(`snapshot -> ${snapshotFile}`);
		console.log(`report -> ${reportFile}`);
		process.exit(report.pass ? 0 : 1);
	}

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
		throw new Error('直接 deliver 已停用；请通过 wf.mjs commit，使完整商业化门禁与自动回滚生效');
		const snap = loadSnap(args[0]);
		await deliverGenerated(snap, { faithRepair: false });   // in-deliver 修复关:其会话快照坐标滞后会规划错位 netport 碎片化网
		// 投递后用独立子进程 \`repair-nets\` 做权威网表验证-修复(关注点分离 + 新进程开新 bridge 连接、规避
		// deliver 长会话后可能的连接降级)。repair-nets 取【新鲜网表】对账,故不受布局变化致旧网表过时影响。
		const { spawnSync } = await import('node:child_process');
		spawnSync(process.execPath, [process.argv[1], 'repair-nets'], { stdio: 'inherit' });
		return;
	}

	if (cmd === 'repair-nets') {
		throw new Error('直接 live repair-nets 已停用；请用 wf.mjs commit 事务修复');
		// 独立验证-修复:权威网表对账当前 live 板,给断裂网补命名 netport,收敛到零断裂(任意板通用)。
		const { executeCode } = await import('../engine/bridge_client.mjs');
		const { verifyAndRepairLive } = await import('../engine/net_live_repair.mjs');
		const { readFileSync } = await import('node:fs');
		const snapJs = readFileSync(new URL('../snapshot2.js', import.meta.url), 'utf8');
		const exec = async js => (await executeCode(js, { timeoutMs: 90000 })).result;
		const r = await verifyAndRepairLive(exec, snapJs, { onIter: (i, p) => console.log(`权威对账(轮${i + 1}): 真断裂网 ${p.broken}${p.ops.length ? `,补 ${p.planned} netport` : ' → 零断网 ✓'}`) });
		console.log(r.converged ? '✅ 权威网表零断网' : `⚠️ 未完全收敛(剩 ${r.broken} 断裂)`);
		return;
	}

	if (cmd === 'repair') {
		throw new Error('直接 live repair 已停用；请用 EASYEDA_REPAIR_STAGE=1 的 wf.mjs commit 事务修复');
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

	if (cmd === 'twin') {   // 离线忠实预览 + 离线 judgeTokens(tier2)
		const snap = loadSnap(args[0]);
		const out = args.find(a => /\.png$/.test(a)) || 'twin.png';
		const { generateLayout } = await import('../engine/cluster_generate.mjs');
		const { twinPredict } = await import('../engine/eda_twin.mjs');
		const { renderTwin } = await import('../engine/twin_renderer.mjs');
		const { judgeTokens } = await import('../engine/token_conformance.mjs');
		const r = await generateLayout(snap, {});
		const g = twinPredict(r.model, snap);
		renderTwin(g, out, { width: 1980 });
		const rep = judgeTokens(g, {});
		console.log('孪生忠实预览 ->', out, '(注:这是 EDA 实貌预测,非 sheet_renderer 美化图)');
		for (const t of rep.tier2) console.log('  ', t.token, ':', t.conform ? '符合' : '✗偏离', JSON.stringify(t.detail));
		console.log('tier1 DRC: 需 live(离线不可预测)');
		return;
	}
	if (cmd === 'calibrate') {   // 钉死孪生:需 live;由控制者执行
		console.log('calibrate --live:在 live_loop 上跑 deliver→read→compareGeom(需桥+confirmOverwrite)。见 spec B1 §6。');
		return;
	}

	if (cmd === 'judge') {
		// 三层 token 确定性符合裁判(无合成百分比):tier1 DRC 底线 / tier2 几何 token / tier3 视觉残余。
		const printTiers = (rep) => {
			const coverage = rep.coverage || { complete: false, expected: null, checked: null, missing: ['coverage-evidence-missing'], duplicate: [], unexpected: [] };
			console.log(`token coverage: ${coverage.complete ? '符合' : '✗ 不完整'} ${JSON.stringify(coverage)}`);
			console.log(`tier1 DRC: ${rep.tier1.conform ? '符合' : '✗ 不符合'} ${JSON.stringify(rep.tier1.detail)}`);
			for (const r of rep.tier2) { console.log(`  ${r.token}: ${r.conform ? '符合' : '✗ 偏离'} ${JSON.stringify(r.detail)}`); }
			console.log(rep.conform ? '✅ tier1+tier2 符合(tier3 视觉待并排商用参考图确认)' : `✗ 不符合,共偏离 ${rep.deviationCount} 处`);
		};
		const live = args.includes('--live');
		if (live) {
			/* --window <id>:定向指定窗口(多窗时 active 可能是别的板,必须定向;空=active,危险) */
			const wi = args.indexOf('--window');
			const windowId = (wi >= 0 && args[wi + 1]) ? args[wi + 1] : (process.env.EASYEDA_WINDOW_ID || '');
			const ei = args.indexOf('--evidence');
			const evidenceFile = (ei >= 0 && args[ei + 1]) ? args[ei + 1] : (process.env.EASYEDA_TOKEN_EVIDENCE || '');
			const { runLiveJudge } = await import('../engine/commercial_judge.mjs');
			const { loadDeliveryEvidence } = await import('../engine/delivery_gate.mjs');
			const evidence = evidenceFile ? loadDeliveryEvidence(evidenceFile) : {};
			if (windowId) console.log('judge 定向 windowId:', windowId);
			const rep = await runLiveJudge({ outDir: '.', windowId, ...evidence });
			printTiers(rep);
			console.log('tier3 视觉证据:', rep.shots);
			console.log('证据报告 -> judge_report.json');
			process.exit(rep.conform ? 0 : 1);
		}
		const { judgeTokens } = await import('../engine/token_conformance.mjs');
		const snap = args.find(a => /\.json$/.test(a));
		if (!snap) { console.error('用法: plexus judge <snapshot.json> | judge --live'); process.exit(2); }
		const model = JSON.parse(readFileSync(snap, 'utf8').replace(/^﻿/, ''));
		const rep = judgeTokens(model, {});   // 离线无 DRC → T-DRC 不符合(诚实:无真 DRC 不认达标)
		printTiers(rep);
		process.exit(rep.conform ? 0 : 1);
	}

	console.log(`通用原理图美化工具(公共工具,零特定电路内容)

用法:
	  node bin/plexus.mjs pcb-snapshot [out.json] [--window id] [--pcb uuid]  实时读取 PCB 几何、位号、板框与原生 DRC
	  node bin/plexus.mjs pcb-qc <snapshot.json> <policy.json> [report.json]   离线执行 PCB 布局门禁
	  node bin/plexus.mjs pcb-judge-live <policy.json> [options]             实时快照并执行 PCB 布局门禁
  node bin/plexus.mjs layout     <snapshot.json> [out.png]   离线:任意板快照 → 商业 2D 布局 + 渲染 + 门校验
  node bin/plexus.mjs twin       <snapshot.json> [out.png]   离线忠实预览(EDA 实貌预测)+离线 judgeTokens tier2
  node bin/plexus.mjs calibrate                              打印 live 标定使用说明(需桥)
  node bin/plexus.mjs audit      <snapshot.json>             商业化布局质量诊断:6 类(连接/走线/间距/电源地/标注/结构)按严重度
  node bin/plexus.mjs qc         <snapshot.json>             网级体检:短路 / 杂散电源标 / 畸形线 / ERC引脚类型 / 悬空标
  node bin/plexus.mjs repair     <snapshot.json>             自动修复(删杂散电源短路标 / 拉直畸形线)并报 DRC 前后
  node bin/plexus.mjs deliver    <snapshot.json>             生成布局并投递到当前 live EDA 文档
  node bin/plexus.mjs judge      <snapshot.json>             离线几何评分(DR 规则+商用达标判定)
  node bin/plexus.mjs judge      --live --evidence <json>    live EDA 完整取证评分 + 输出 judge_report.json

快照获取(从 live EDA 捕获任意板):
  npm run live:save        # -> live.json`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
