// Live Schematic Optimizer 主编排（默认 dry-run，只读不写）
//
// 流程：读 DRC → classifyFindings → 合并已有决策 → buildPlan
//        → 写 optimize_decisions.json(模糊项待填) + optimize_plan.json → 打印汇总
//
// 实时写不在此处发生：dry-run 只产出"会做什么"的计划与待决策清单。
// 实际经 gated 写路径的批量落地由 --apply 触发（resolver/写边界，后续接入）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyFindings } from './finding_classifier.mjs';
import { buildPlan } from './optimize_plan.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const DRC = process.env.EASYEDA_DRC_REPORT || `${ROOT}/drc_report.json`;
const DECISIONS = process.env.EASYEDA_OPTIMIZE_DECISIONS || `${ROOT}/optimize_decisions.json`;
const PLAN = process.env.EASYEDA_OPTIMIZE_PLAN || `${ROOT}/optimize_plan.json`;

const INSTRUCTIONS = '对每个悬空引脚填 decision: nc(加非连接标识) | wire(确认漏连) | skip(本轮不动)；'
	+ '对每个待标准化器件填 standardPart: "C编号"。改完重跑 optimize 生成新计划。';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

/* 读旧决策文件，保留用户已填答案（按 ref 索引） */
function loadPriorDecisions(path) {
	const prior = { pins: {}, devices: {} };
	if (!existsSync(path)) return prior;
	try {
		const j = readJson(path);
		for (const p of j.floatingPins || []) if (p.decision) prior.pins[p.ref] = p.decision;
		for (const d of j.devices || []) if (d.standardPart) prior.devices[d.ref] = d.standardPart;
	} catch { /* 损坏则忽略，重建 */ }
	return prior;
}

/* 由分类结果 + 旧答案构造决策模板与 buildPlan 用的决策 map */
function buildDecisions(items, prior) {
	const floatingPins = items.filter(i => i.disposition === 'ask')
		.map(i => ({ ref: i.ref, suggestion: i.suggestion, decision: prior.pins[i.ref] ?? null }));
	const devices = items.filter(i => i.disposition === 'resolve')
		.map(i => ({ ref: i.ref, edaId: i.detail?.edaId ?? null, standardPart: prior.devices[i.ref] ?? null }));

	const map = {};
	for (const p of floatingPins) if (p.decision) map[p.ref] = p.decision;
	for (const d of devices) if (d.standardPart) map[d.ref] = { standardPart: d.standardPart };
	return { floatingPins, devices, map };
}

export function runOptimize() {
	if (!existsSync(DRC)) {
		return { ok: false, error: `DRC 报告缺失：${DRC}。先跑 live:audit / drc_check 拉真实 DRC。` };
	}
	const drc = readJson(DRC);
	const { items } = classifyFindings(drc);
	const prior = loadPriorDecisions(DECISIONS);
	const { floatingPins, devices, map } = buildDecisions(items, prior);
	const plan = buildPlan(items, map);

	const decisionsDoc = { generatedAt: new Date().toISOString(), instructions: INSTRUCTIONS, floatingPins, devices };
	const planDoc = { generatedAt: new Date().toISOString(), mode: 'dry-run', summary: plan.summary, actions: plan.actions, flagged: plan.flagged, pending: plan.pending };

	writeFileSync(DECISIONS, JSON.stringify(decisionsDoc, null, 2), 'utf8');
	writeFileSync(PLAN, JSON.stringify(planDoc, null, 2), 'utf8');

	return { ok: true, classified: items.length, plan, decisions: { floatingPins, devices }, paths: { DECISIONS, PLAN } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const r = runOptimize();
	if (!r.ok) {
		console.error(r.error);
		process.exit(2);
	}
	const { plan } = r;
	console.log(`optimize (dry-run): 分类 ${r.classified} 项 → 可执行 ${plan.summary.actions} · 待人工 ${plan.summary.flagged} · 待决策 ${plan.summary.pending}`);
	console.log(`  可直接执行: 删网标 ${plan.actions.filter(a => a.op === 'delete-net-label').length} · 加NC ${plan.actions.filter(a => a.op === 'add-noconnect').length} · 重绑器件 ${plan.actions.filter(a => a.op === 'rebind-device').length}`);
	console.log(`  待人工(疑似漏连，不自动猜): ${plan.flagged.map(f => f.ref).join(', ') || '无'}`);
	console.log(`  待决策: 悬空引脚 ${r.decisions.floatingPins.filter(p => !p.decision).length} · 待选标准件 ${r.decisions.devices.filter(d => !d.standardPart).length}`);
	console.log(`  填 ${resolve(r.paths.DECISIONS)} 后重跑应用。`);
	console.log(`  plan -> ${resolve(r.paths.PLAN)}`);
	process.exit(0);
}
