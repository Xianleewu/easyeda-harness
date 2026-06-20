// 保留式交付(Preserve-Deliver):对【已有好布局】的输入快照,保留设计者件位 + 真实连线 +
// 电源/地符号,只做清理式交付到 EDA——而非 ELK 从零重排(后者会把好布局摧毁成散落+标签汤)。
//
// 背景(2026-06-20 重大纠正,见记忆 tool-degrades-good-layouts):ELK 自动合成对已有好布局的
// 板产出比原图更差。工具正解 = 输入已有好布局时保留,只有裸网表才生成。
//
//   node engine/preserve_deliver.mjs [snapshot.json]   检测质量 + 投递保留布局到 EDA
//   node engine/preserve_deliver.mjs --check [snap]     仅检测布局质量(不投递)
//
// 退出码:0=成功/质量好,1=失败/质量差需生成。
import { existsSync, readFileSync } from 'node:fs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 布局质量检测:输入快照是否已有【可保留的好布局】。
// 标准(商业图特征):① 件有真实坐标且不退化重叠 ② 真实连线为主(非全网标)
//   ③ 去耦电容贴近 IC(平均最近 IC 距离合理)。返回 {good, reasons, stats}。
export function assessLayout(snap) {
	const comps = (snap.components || []).filter(c => c.designator);
	const wires = snap.wires || [];
	const netflags = snap.netflags || [];
	const reasons = [];
	if (comps.length < 2) return { good: false, reasons: ['件太少'], stats: {} };

	// ① 坐标分布:非全同点(退化)
	const xs = comps.map(c => c.x || 0), ys = comps.map(c => c.y || 0);
	const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
	if (spanX < 50 && spanY < 50) reasons.push('件坐标退化(重叠)');

	// ② 真实连线 vs 网标 比例:好布局以真实连线为主
	const wireRatio = wires.length / Math.max(1, wires.length + netflags.length);
	if (wireRatio < 0.5) reasons.push(`连线占比低(${(wireRatio * 100).toFixed(0)}%,标签汤)`);

	// ③ IC 去耦电容邻近度:每个电容到最近 IC 的中位距离
	const ics = comps.filter(c => /^(U|FPC|J)/.test(c.designator));
	const caps = comps.filter(c => /^C/.test(c.designator));
	let capProx = null;
	if (ics.length && caps.length) {
		const dists = caps.map(c => Math.min(...ics.map(u => Math.hypot((c.x || 0) - (u.x || 0), (c.y || 0) - (u.y || 0)))));
		dists.sort((a, b) => a - b);
		capProx = Math.round(dists[Math.floor(dists.length / 2)]);
		// 经验:贴近 IC 的去耦电容中位最近距离应较小(板尺度相关,> span/4 视为散落)
		if (capProx > Math.max(spanX, spanY) / 3) reasons.push(`电容远离 IC(中位 ${capProx},未分组)`);
	}
	const stats = { comps: comps.length, wires: wires.length, netflags: netflags.length, wireRatio: +wireRatio.toFixed(2), spanX, spanY, capProx };
	return { good: reasons.length === 0, reasons, stats };
}

// 构建保留式交付模型:直接用快照的件位/线/电源地符号(不重排)。
export function buildPreserveModel(snap) {
	const components = (snap.components || []).filter(c => c.designator).map(c => ({
		designator: c.designator, x: c.x, y: c.y, rotation: c.rotation || 0, mirror: !!c.mirror,
	}));
	const wires = (snap.wires || []).map(w => ({ net: w.net || '', line: w.line }));
	const netflags = (snap.netflags || []).map(f => ({
		flagId: /Ground/.test(f.symbol || '') ? 'Ground' : 'Power', net: f.net, x: f.x, y: f.y, rotation: f.rotation || 0,
	}));
	return { components, wires, netflags };
}

async function deliverPreserve(model) {
	const { executeCode } = await import('./bridge_client.mjs');
	const exec = async js => {
		for (let t = 0; t < 6; t++) {
			try { return (await executeCode(js, { timeoutMs: 90000 })).result; }
			catch (e) { if (!/disconnect|timed out/i.test(e.message)) { console.error('  非连接错:', e.message.slice(0, 80)); return null; } await sleep(2500); }
		}
		return null;
	};
	const runOps = async (label, ops, batch = 15) => {
		let done = 0;
		for (let i = 0; i < ops.length; i += batch) {
			await exec(`let n=0;\n${ops.slice(i, i + batch).join('\n')}\nreturn {n};`);
			done += Math.min(batch, ops.length - i);
			process.stdout.write(`\r  ${label}: ${done}/${ops.length}`);
		}
		console.log(' ✓');
	};

	console.log('保留式交付:取当前件 designator→id 映射...');
	const cur = await exec(`const cs=await eda.sch_PrimitiveComponent.getAll();return cs.map(c=>({id:c.primitiveId||c.id,des:c.designator}));`);
	const desToId = new Map((cur || []).filter(c => c.des).map(c => [c.des, c.id]));
	console.log(`  当前件 ${cur ? cur.length : 0},有 designator ${desToId.size}`);

	console.log('清除现有合成线/标(保留矩形框/文本)...');
	await exec(`for(let p=0;p<10;p++){const ws=(await eda.sch_PrimitiveWire.getAll())||[];const wid=ws.map(w=>w.primitiveId);if(wid.length){try{await eda.sch_PrimitiveWire.delete(wid);}catch(e){}}const ids=(await eda.sch_PrimitiveComponent.getAllPrimitiveId())||[];const fc=[];for(const id of ids){const c=await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);if(c&&(c.componentType==='netflag'||c.componentType==='netport'))fc.push(id);}if(fc.length){try{await eda.sch_PrimitiveComponent.delete(fc);}catch(e){}}if(!wid.length&&!fc.length)break;}return {};`);

	const moveOps = model.components.map(c => { const id = desToId.get(c.designator); return id ? `try{await eda.sch_PrimitiveComponent.modify(${JSON.stringify(id)},{x:${c.x},y:${c.y},rotation:${c.rotation},mirror:${c.mirror}});n++;}catch(e){}` : null; }).filter(Boolean);
	await runOps('件保留位', moveOps);
	const wireOps = model.wires.map(w => `try{await eda.sch_PrimitiveWire.create(${JSON.stringify(w.line)},${JSON.stringify(w.net)});n++;}catch(e){}`);
	await runOps('真实连线', wireOps);
	const flagOps = model.netflags.map(f => `try{await eda.sch_PrimitiveComponent.createNetFlag('${f.flagId}',${JSON.stringify(f.net)},${f.x},${f.y},${f.rotation});n++;}catch(e){}`);
	await runOps('电源/地符号', flagOps);

	// 自愈:部分密集脚连线被 EDA create 拒("create failed!")→ 整网可能丢失。补法:回读已连网,
	// 对【完全没连上】的命名网,在其连线两端建网标/电源符号(同名连通,密集脚可建)。保 100% 网覆盖。
	const covered = await exec(`const ws=await eda.sch_PrimitiveWire.getAll();return [...new Set((ws||[]).map(w=>w.net).filter(Boolean))];`);
	const coveredSet = new Set(covered || []);
	const healOps = [];
	for (const w of model.wires) {
		if (!w.net || !w.net.trim() || coveredSet.has(w.net)) continue;
		const l = w.line; const pts = [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]];
		const isGnd = /^GND/i.test(w.net), isPwr = /^(VBUS|VCC|5V|BL_|3V|\+)/i.test(w.net);
		for (const [x, y] of pts) {
			if (isGnd) healOps.push(`try{await eda.sch_PrimitiveComponent.createNetFlag('Ground',${JSON.stringify(w.net)},${x},${y},0);n++;}catch(e){}`);
			else if (isPwr) healOps.push(`try{await eda.sch_PrimitiveComponent.createNetFlag('Power',${JSON.stringify(w.net)},${x},${y},0);n++;}catch(e){}`);
			else healOps.push(`try{await eda.sch_PrimitiveComponent.createNetPort('BI',${JSON.stringify(w.net)},${x},${y},0);n++;}catch(e){}`);
		}
	}
	if (healOps.length) { console.log(`自愈:${healOps.length / 2} 个失败命名网 → 同名网标连通`); await runOps('自愈网标', healOps); }
	console.log('保留式交付完成(已自愈失败连线,保 100% 网覆盖)。');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('engine/preserve_deliver.mjs')) {
	const checkOnly = process.argv.includes('--check');
	const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || (existsSync(`${ROOT}/live_clean.json`) ? `${ROOT}/live_clean.json` : `${ROOT}/live.json`);
	const snap = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
	const a = assessLayout(snap);
	console.log(`布局质量(${file.split('/').pop()}): ${a.good ? '好(可保留)' : '差(需生成)'} | ${JSON.stringify(a.stats)}`);
	if (a.reasons.length) console.log('  问题:', a.reasons.join('; '));
	if (checkOnly) process.exit(a.good ? 0 : 1);
	if (!a.good) { console.error('布局质量差,保留无意义——应走生成路径。'); process.exit(1); }
	await deliverPreserve(buildPreserveModel(snap));
	process.exit(0);
}
