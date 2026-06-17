// 通用实时商业化审计(任意已连接原理图,只读)
//
// 目标产品的"审计"阶段:对任意 EasyEDA 实时原理图给出统一、分类、可操作的
// 商业级就绪度报告,驱动后续修复闭环走向 致命0/错误0/警告0/信息0 + 视觉无重叠。
//
// 权威信号 = EasyEDA 原生 DRC(致命/错误/警告/信息)。
// 视觉可读性 = 设计无关的几何检查子集(对象重叠、文本/标签压器件、导线穿可见对象);
//   刻意剔除 harness 自有约定的检查(10 单位栅格、出格),否则对外部任意图会大量误报。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const LIVE = process.env.EASYEDA_LIVE_MODEL || `${ROOT}/live.json`;
const DRC = process.env.EASYEDA_DRC_REPORT || `${ROOT}/drc_report.json`;
const REPORT = process.env.EASYEDA_LIVE_AUDIT_REPORT || `${ROOT}/live_audit_report.json`;

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

/* 把 EDA DRC 的逐条消息归类(供应商/标准化、悬空引脚、未连网标、其它) */
function categorizeDrc(items) {
	const cats = {
		deviceStandardization: { level: 'warning', count: 0, hint: '器件属性/供应商编号不匹配，需器件标准化（指定 LCSC 标准器件）', refs: [] },
		floatingPin: { level: 'warning', count: 0, hint: '元件引脚悬空：确认是有意 NC（加非连接标识）还是真实漏连（补连线）', refs: [] },
		unconnectedNetLabel: { level: 'info', count: 0, hint: '网络标识未连接导线/总线：删除残留网标或补连线', refs: [] },
		other: { level: 'mixed', count: 0, hint: '其它 DRC 项，逐条查看', refs: [] },
	};
	const refsOf = msg => (msg.match(/[A-Za-z]+\d+(?:\.[A-Za-z0-9]+)?/g) || []).slice(0, 60);
	for (const it of items || []) {
		const m = it.msg || '';
		if (/器件标准化|供应商编号不匹配/.test(m)) { cats.deviceStandardization.count++; cats.deviceStandardization.refs.push(...refsOf(m)); }
		else if (/引脚悬空|非连接标识/.test(m)) { cats.floatingPin.count++; cats.floatingPin.refs.push(...refsOf(m)); }
		else if (/没有连接导线|未连接/.test(m)) { cats.unconnectedNetLabel.count++; cats.unconnectedNetLabel.refs.push(...refsOf(m)); }
		else { cats.other.count++; }
	}
	for (const c of Object.values(cats)) c.refs = [...new Set(c.refs)];
	return cats;
}

/* 设计无关的视觉可读性检查(只取对外部任意图也成立的项) */
function readabilityFindings(model) {
	const g = geomQC(model);
	const labelHard = labelQC(model).filter(f => f.severity === 'hard');
	const byRule = {};
	for (const f of labelHard) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
	return {
		bboxOverlaps: g.overlaps.length,
		wireThroughComponent: g.wireThruComp.length,
		differentNetCrossings: g.crossings,
		labelIssues: labelHard.length,
		labelByRule: byRule,
		/* 出格(offgrid)刻意不计入：外部图用 EDA 原生栅格，非 harness 10 栅格 */
		note: 'off-grid intentionally excluded (external designs use EDA-native grid)',
	};
}

export function runLiveAudit() {
	const findings = [];
	let model = null;
	let drc = null;
	if (!existsSync(LIVE)) findings.push({ rule: 'LA0-no-snapshot', severity: 'hard', msg: `live snapshot ${LIVE} missing; run bridge snapshot first` });
	else { try { model = readJson(LIVE); } catch (e) { findings.push({ rule: 'LA0-snapshot-parse', severity: 'hard', msg: e.message }); } }
	if (existsSync(DRC)) { try { drc = readJson(DRC); } catch { /* optional */ } }

	const drcCounts = drc?.drc?.counts || drc?.drc || { fatal: null, errors: null, warnings: null, info: null };
	const drcCats = drc?.drc?.items ? categorizeDrc(drc.drc.items) : null;
	const readability = model ? readabilityFindings(model) : null;

	const fatal = drcCounts.fatal ?? 0;
	const errors = drcCounts.errors ?? 0;
	const warnings = drcCounts.warnings ?? 0;
	const info = drcCounts.info ?? 0;
	const drcClean = fatal === 0 && errors === 0 && warnings === 0 && info === 0;
	const visualClean = readability ? (readability.bboxOverlaps === 0 && readability.wireThroughComponent === 0 && readability.differentNetCrossings === 0 && readability.labelIssues === 0) : false;

	return {
		generatedAt: null,
		project: model?.project || null,
		components: (model?.components || []).length,
		drc: { fatal, errors, warnings, info, clean: drcClean, categories: drcCats },
		readability,
		commercialReady: drcClean && visualClean,
		verdict: drcClean && visualClean ? 'COMMERCIAL-READY'
			: !model ? 'NO-SNAPSHOT'
			: `NOT-READY (drc: ${fatal}/${errors}/${warnings}/${info}; visual: ${visualClean ? 'clean' : 'issues'})`,
		blockers: findings,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const r = runLiveAudit();
	r.generatedAt = new Date().toISOString();
	writeFileSync(REPORT, JSON.stringify(r, null, 2), 'utf8');
	console.log(`live audit: ${r.verdict}`);
	if (r.drc.categories) {
		console.log(`DRC 致命=${r.drc.fatal} 错误=${r.drc.errors} 警告=${r.drc.warnings} 信息=${r.drc.info}`);
		for (const [k, c] of Object.entries(r.drc.categories)) {
			if (c.count) console.log(`  [${c.level}] ${k}: ${c.count} 组 — ${c.hint}${c.refs.length ? ` (${c.refs.length} 项)` : ''}`);
		}
	}
	if (r.readability) console.log(`视觉: 重叠=${r.readability.bboxOverlaps} 线压器件=${r.readability.wireThroughComponent} 异网交叉=${r.readability.differentNetCrossings} 标签问题=${r.readability.labelIssues}`);
	console.log(`report -> ${REPORT}`);
	process.exit(r.commercialReady ? 0 : 1);
}
