// 裁判 harness:取证(桥)→ 打分(纯)→ 证据化报告。零特定电路内容(报告只含匿名规则+证据路径)。
import { scoreAll } from './commercial_rubric.mjs';
import { readGeometry, captureRegion, regionFromParts } from './bridge_windows.mjs';
import { executeCode } from './bridge_client.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

export function judgeBoard(model, { drc, shots = [] } = {}) {
	const s = scoreAll(model, { drc });
	const summary = `block 失败 ${s.blockFail} / flag 失败 ${s.flagFail} / 商用达标=${s.commercialPass}`;
	return { commercialPass: s.commercialPass, blockFail: s.blockFail, flagFail: s.flagFail, rules: s.rules, shots, summary };
}

async function runDrc({ windowId, port, timeoutMs = 120000 }) {
	const code = `
const res = await eda.sch_Drc.check(true, false, true).catch(()=>null);
if (!Array.isArray(res)) return { error: null, warn: null, info: null, raw: false };
const pick = t => (res.find(x=>x.type===t)||{count:0}).count||0;
return { error: pick('fatalError')+pick('error'), warn: pick('warn'), info: pick('info'), raw:true };
`;
	const { result } = await executeCode(code, { windowId, port, timeoutMs });
	return result;
}

export function judgeSnapshot(snapshotPath, { drc } = {}) {
	const model = JSON.parse(readFileSync(snapshotPath, 'utf8').replace(/^﻿/, ''));
	return judgeBoard(model, { drc, shots: [] });
}

export async function runLiveJudge({ windowId = '', port = 0, outDir = '.', timeoutMs = 120000 } = {}) {
	const model = await readGeometry({ windowId, port, timeoutMs });
	const drc = await runDrc({ windowId, port, timeoutMs });
	mkdirSync(outDir, { recursive: true });
	const shots = [];
	const region = regionFromParts(model.components || []);
	if (region) {
		const out = `${outDir}/judge_region.png`;
		try { await captureRegion({ windowId, port, region, outFile: out, timeoutMs }); shots.push(out); } catch { /* 截图失败不伪装,留空证据 */ }
	}
	const report = judgeBoard(model, { drc, shots });
	writeFileSync(`${outDir}/judge_report.json`, JSON.stringify({ ...report, drc }, null, 2), 'utf8');
	return report;
}
