// Plexus 就地写回(沙箱):把现有器件移到合成摆位 + 删原线/标 + 画合成线/标 → 真实合成图。
// 破坏性,但先快照存盘(restore 文件)可整体还原。分批避桥超时。
//   node engine/plexus_apply_live.mjs           apply(就地重排)
//   node engine/plexus_apply_live.mjs --undo    从 restore 还原(器件移回 + 删合成 + 重建原线/标)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
import { elkLayout } from './elk_layout.mjs';
import { wireConnectivity } from './wire_connectivity.mjs';
import { withLocalPins } from './transform.mjs';
import { geomQC } from './geom_qc.mjs';
import { labelQC } from './label_qc.mjs';
import { synthesisFaithfulness } from './synthesis_faithfulness.mjs';
import { executeCode, executeJsFile } from './bridge_client.mjs';

const ROOT = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const RESTORE = `${ROOT}/plexus_restore.json`;
const SNAP_JS = `${ROOT}/snapshot2.js`;
const BATCH = 15;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 容错:断连/超时多次重试(更长退避);彻底失败返回 null(不抛),让整体续跑。
async function execRetry(script, tries = 6) {
	let last;
	for (let t = 0; t < tries; t++) {
		try { return await executeCode(script, {}); }
		catch (e) { last = e; if (!/disconnect|timed out/i.test(e.message)) { console.error('  非连接错:', e.message.slice(0, 80)); return null; } await sleep(2500); }
	}
	console.error('  批彻底失败(跳过):', String(last && last.message).slice(0, 80));
	return null;
}

async function liveSnapshot() {
	const { result } = await executeJsFile(SNAP_JS, {});
	return result;
}

// 把整条 pin→label 路径拼成一条命名折线:不留可被 EDA 合并丢名的独立无名段。
function concatNamedPaths(wires) {
	const used = new Set();
	const result = [];
	for (const stub of wires) {
		if (!stub.net || stub.line.length !== 4) continue;
		const [ax, ay, bx, by] = stub.line;
		if (ay !== by) continue;
		for (const [ix, iy, fx, fy] of [[ax, ay, bx, by], [bx, by, ax, ay]]) {
			const esc = wires.find(w => !w.net && !used.has(w) && (w.line || []).length >= 4 && Math.abs(w.line[w.line.length - 2] - ix) < 1 && Math.abs(w.line[w.line.length - 1] - iy) < 1);
			if (esc) { used.add(esc); used.add(stub); result.push({ net: stub.net, line: [...esc.line, fx, fy] }); break; }
		}
	}
	for (const w of wires) if (!used.has(w)) result.push(w);
	return result;
}

// 把命名 stub 延伸到 channel、截掉逃逸线共线水平末段:让逃逸以竖直段接入命名 stub
// (拐角而非共线)→ EDA 不合并 → 命名段保住网名。修 densefanout 7 个网丢名根因。
function extendStubsToChannel(wires) {
	const out = wires.map(w => ({ ...w, line: w.line.slice() }));
	for (const stub of out) {
		if (!stub.net || stub.line.length !== 4) continue;
		const [ax, ay, bx, by] = stub.line;
		if (ay !== by) continue;
		for (const [ix, iy, isFirst] of [[ax, ay, true], [bx, by, false]]) {
			const esc = out.find(w => !w.net && w.line.length >= 4 && Math.abs(w.line[w.line.length - 2] - ix) < 1 && Math.abs(w.line[w.line.length - 1] - iy) < 1);
			if (!esc) continue;
			const L = esc.line;
			const prevY = L[L.length - 3];
			if (Math.abs(prevY - iy) >= 1) continue;
			const prevX = L[L.length - 4];
			esc.line = L.slice(0, L.length - 2);
			stub.line = isFirst ? [prevX, iy, bx, by] : [ax, ay, prevX, iy];
			break;
		}
	}
	return out;
}

// 网名传播:EDA 合并共线线段,若命名 stub 与无名逃逸线共线合并、结果取无名 → 丢连通。
// 预先让同一几何连通簇的所有无名线都带该网名,合并后仍是该网 → 连通稳。命名线不显示符号。
function propagateNets(wires) {
	const key = (x, y) => Math.round(x) + ',' + Math.round(y);
	const par = new Map();
	const find = x => { if (!par.has(x)) par.set(x, x); let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
	const uni = (a, b) => par.set(find(a), find(b));
	for (const w of wires) { const l = w.line || []; const pts = []; for (let i = 0; i < l.length; i += 2) pts.push(key(l[i], l[i + 1])); for (let i = 1; i < pts.length; i++) uni(pts[i - 1], pts[i]); }
	const clusterNet = new Map();
	for (const w of wires) { if (!w.net) continue; const l = w.line; if (l.length < 2) continue; const r = find(key(l[0], l[1])); if (!clusterNet.has(r)) clusterNet.set(r, w.net); }
	return wires.map(w => {
		if (w.net) return w;
		const l = w.line; if (l.length < 2) return w;
		const net = clusterNet.get(find(key(l[0], l[1])));
		return net ? { ...w, net } : w;
	});
}

// 分批执行一串 op 脚本片段(每片返回 {ids?} 可选)。ops 为字符串数组(EDA 端代码)。
// op 内 catch 可把失败标记 push 进 errs(批返回),runOps 汇总到 opErrs 供自愈/诊断用。
const batchScript = chunk => `let n=0; const ids=[]; const errs=[];\n${chunk.join('\n')}\nreturn { n, ids, errs };`;
let opErrs = [];   // 上一次 runOps 收集到的失败标记(由 op 的 catch push)

async function runOps(label, ops) {
	let done = 0;
	let failedChunks = [];
	opErrs = [];
	for (let i = 0; i < ops.length; i += BATCH) {
		const chunk = ops.slice(i, i + BATCH);
		const r = await execRetry(batchScript(chunk));
		if (r && r.result) { done += r.result.n; if (r.result.errs) opErrs.push(...r.result.errs); } else failedChunks.push(chunk);
		await sleep(350);
	}
	// 第二/三遍:只重试失败批(填补缺口、不产重复),给 EDA 重连时间。
	for (let pass = 0; pass < 3 && failedChunks.length; pass++) {
		const retry = failedChunks; failedChunks = [];
		for (const chunk of retry) {
			await sleep(2500);
			const r = await execRetry(batchScript(chunk));
			if (r && r.result) { done += r.result.n; if (r.result.errs) opErrs.push(...r.result.errs); } else failedChunks.push(chunk);
		}
	}
	console.log(`  ${label}: ${done}/${ops.length}${failedChunks.length ? ` (仍失败 ${failedChunks.length * BATCH})` : ' ✓'}`);
	return done;
}

async function apply() {
	console.log('1) 实时快照(存 restore)...');
	const snap = await liveSnapshot();
	const comps = (snap.components || []).filter(c => c.designator);
	const restore = {
		components: comps.map(c => ({ id: c.id, designator: c.designator, x: c.x, y: c.y, rotation: c.rotation, mirror: !!c.mirror })),
		wires: (snap.wires || []).map(w => ({ net: w.net || '', line: w.line })),
		netflags: (snap.netflags || []).map(f => ({ kind: f.type, net: f.net, x: f.x, y: f.y, rotation: f.rotation, mirror: !!f.mirror, symbol: f.symbol })),
		savedAt: Date.now(),
	};
	writeFileSync(RESTORE, JSON.stringify(restore, null, 2));
	console.log(`   存 restore:${restore.components.length} 器件 / ${restore.wires.length} 线 / ${restore.netflags.length} 标`);

	console.log('2) 合成(本地快照,门判)...');
	const local = existsSync(`${ROOT}/live_clean.json`) ? JSON.parse(readFileSync(`${ROOT}/live_clean.json`, 'utf8').replace(/^﻿/, '')) : snap;
	const logical = extractLogical(local);
	const contract = synthesizeContract(inferRoles(logical), logical);
	const byDes = new Map((local.components || []).map(c => [c.designator, withLocalPins(c)]));
	// PLEXUS_LAYOUT=elk:用 elkjs 自动布局(紧凑+真实连线,商用可读),scale=false 保符号原尺寸→脚接得上。
	const useElk = (process.env.PLEXUS_LAYOUT || '').toLowerCase() === 'elk';
	let r;
	if (useElk) {
		const m = await elkLayout({ snapshot: local, logical, byDes, scale: false });
		r = { placements: m.placements, model: { components: m.components, wires: m.wires, netflags: m.netflags } };
	} else {
		r = planLayout({ contract, byDes, logical });
	}
	const g = geomQC(r.model);
	const geomHard = g.overlaps.length + g.wireThruComp.length + g.wireThruPin.length + g.crossings;
	if (useElk) {
		// ELK:门只 fail-closed【电气】(几何短路/穿件/穿脚 + 连通断);标签叠压(cosmetic)、faith(契约式,
		// 对扁平 ELK 模型不适用)仅告警不阻断——「门是必要非充分,先看渲染图」。
		const connHard = wireConnectivity({ model: r.model, logical }).filter(f => f.severity === 'hard').length;
		if (geomHard + connHard) { console.error(`fail-closed:ELK 布局 ${geomHard} 几何短路 + ${connHard} 连通断,中止`); process.exit(1); }
		const lh = labelQC(r.model).filter(f => f.severity === 'hard').length;
		console.log(`   ELK 布局:几何全净、连通完整;标签叠压 ${lh}(cosmetic,先看渲染图)`);
	} else {
		const hard = geomHard + g.crossings + labelQC(r.model).filter(f => f.severity === 'hard').length + synthesisFaithfulness({ logical, contract, model: r.model }).length;
		if (hard) { console.error(`fail-closed:合成 ${hard} 处硬伤,中止`); process.exit(1); }
	}
	const placeBy = new Map(r.placements.map(p => [p.designator, p]));
	const idBy = new Map(comps.map(c => [c.designator, c.id]));

	console.log('3) 移器件到合成摆位...');
	const moveOps = [];
	for (const [des, pl] of placeBy) {
		const id = idBy.get(des); if (!id) continue;
		moveOps.push(`try{ await eda.sch_PrimitiveComponent.modify(${JSON.stringify(id)}, { x:${pl.x}, y:${pl.y}, rotation:${pl.rot}, mirror:${pl.mirror} }); n++; }catch(e){}`);
	}
	await runOps('移器件', moveOps);

	console.log('4) 删原线 + 原网标...');
	const delWireOps = (snap.wires || []).map(w => `try{ await eda.sch_PrimitiveWire.delete([${JSON.stringify(w.id)}]); n++; }catch(e){}`);
	await runOps('删原线', delWireOps);
	const delFlagOps = (snap.netflags || []).map(f => `try{ await eda.sch_PrimitiveComponent.delete([${JSON.stringify(f.id)}]); n++; }catch(e){}`);
	await runOps('删原标', delFlagOps);

	console.log('5) 画合成线 + 电源地符号(信号靠命名线连通,可选跳过重/不可靠的 netPort)...');
	// 整条 pin→label 路径拼成单条命名折线 → 无独立无名段可被 EDA 合并丢名。
	// ELK:每条线【无网名】创建(EDA 会把同网名线合并成乱序折线=视觉乱麻;无名线各自独立、几何干净),
	// 连通/网名靠 netPort 提供。旧合成:concatNamedPaths 拼单条命名路径(其结构本就连续,不乱)。
	const fixedWires = useElk ? r.model.wires : concatNamedPaths(r.model.wires);
	// op 的 catch 把失败线坐标 push 进 errs → opErrs。某些密集脚的短桩会被 EDA 拒("create failed!"),
	// 需在画标阶段把这些脚改为「脚尖直建端口/标」自愈(见下)。
	const wireOps = fixedWires.map(w => `try{ await eda.sch_PrimitiveWire.create(${JSON.stringify(w.line)}, ${JSON.stringify(useElk ? '' : (w.net || ''))}); n++; }catch(e){ errs.push(${JSON.stringify(w.line)}); }`);
	await runOps('画线', wireOps);
	const failedLines = opErrs.slice();
	if (failedLines.length) writeFileSync(`${ROOT}/diag_failed_wires.json`, JSON.stringify(failedLines, null, 2));

	// 自愈:每条失败短桩 = 脚→escape(escape 处落着一个 netflag)。建桩失败 → 该脚不达其 escape 端口
	// → 浮空。修法:把该 netflag 改建在【脚尖】(免桩、端口自带引线直连),不再在 escape 留孤立端口。
	// netflag 与桩 escape 端坐标一一对应(214 桩↔214 标);脚端 = 桩另一端。泛化适配任意板。
	const near = (a, b) => Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2;
	const flagPos = useElk ? r.model.netflags.map(f => ({ f, xy: [f.x, f.y], deliverXY: [f.x, f.y], moved: false })) : null;
	let healed = 0;
	if (useElk && failedLines.length) {
		for (const line of failedLines) {
			const e0 = [line[0], line[1]], e1 = [line[line.length - 2], line[line.length - 1]];
			// escape 端 = 与某未移 netflag 重合的端;脚端 = 另一端
			const hit = flagPos.find(fp => !fp.moved && (near(fp.xy, e0) || near(fp.xy, e1)));
			if (!hit) continue;
			hit.deliverXY = near(hit.xy, e0) ? e1 : e0;   // 改投到脚尖
			hit.moved = true;
			healed++;
		}
		console.log(`  自愈:${healed}/${failedLines.length} 失败桩脚改为脚尖直建端口(免桩直连)`);
	}

	const noSig = process.argv.includes('--no-sig-port') || process.env.PLEXUS_NO_SIG_PORT;
	const flagSrc = useElk ? flagPos.map(fp => ({ ...fp.f, x: fp.deliverXY[0], y: fp.deliverXY[1] })) : r.model.netflags;
	const flagOps = flagSrc.map(f => {
		const x = f.x, y = f.y, rot = f.rot || 0;
		if (f.kind === 'sig') return noSig ? null : `try{ await eda.sch_PrimitiveComponent.createNetPort('BI', ${JSON.stringify(f.net)}, ${x}, ${y}, ${rot}); n++; }catch(e){}`;
		if (f.kind === 'power') return `try{ await eda.sch_PrimitiveComponent.createNetFlag('Power', ${JSON.stringify(f.net)}, ${x}, ${y}, ${rot}); n++; }catch(e){}`;
		return `try{ await eda.sch_PrimitiveComponent.createNetFlag('Ground', ${JSON.stringify(f.net)}, ${x}, ${y}, ${rot}); n++; }catch(e){}`;
	}).filter(Boolean);
	await runOps('画标', flagOps);
	console.log(`完成就地写回:移 ${placeBy.size} 器件、画 ${r.model.wires.length} 线 + ${r.model.netflags.length} 标。还原:node engine/plexus_apply_live.mjs --undo`);
}

async function undo() {
	if (!existsSync(RESTORE)) { console.error('无 restore 文件'); process.exit(2); }
	const rs = JSON.parse(readFileSync(RESTORE, 'utf8'));
	console.log('还原:删当前合成线/标...');
	// 删全部当前线 + 全部 netflag/netport(就地写回后整图都是合成产物)
	const purge = `
let dw=0,dc=0;
for(let p=0;p<10;p++){
  const ws=(await eda.sch_PrimitiveWire.getAll())||[]; const wid=ws.map(w=>w.primitiveId);
  if(wid.length){try{await eda.sch_PrimitiveWire.delete(wid);dw+=wid.length;}catch(e){}}
  const ids=(await eda.sch_PrimitiveComponent.getAllPrimitiveId())||[]; const fc=[];
  for(const id of ids){const c=await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if(c&&(c.componentType==='netflag'||c.componentType==='netport'))fc.push(id);}
  if(fc.length){try{await eda.sch_PrimitiveComponent.delete(fc);dc+=fc.length;}catch(e){}}
  if(!wid.length&&!fc.length)break;
}
return {n:dw+dc, dw, dc};`;
	await execRetry(purge);
	console.log('还原:器件移回原位...');
	const moveOps = rs.components.map(c => `try{ await eda.sch_PrimitiveComponent.modify(${JSON.stringify(c.id)}, { x:${c.x}, y:${c.y}, rotation:${c.rotation}, mirror:${c.mirror} }); n++; }catch(e){}`);
	await runOps('器件移回', moveOps);
	console.log('还原:重建原线...');
	const wireOps = rs.wires.map(w => `try{ await eda.sch_PrimitiveWire.create(${JSON.stringify(w.line)}, ${JSON.stringify(w.net || '')}); n++; }catch(e){}`);
	await runOps('重建线', wireOps);
	console.log('还原:重建原网标...');
	const flagOps = rs.netflags.map(f => {
		const id = /Ground/.test(f.symbol || '') ? 'Ground' : 'Power';
		return `try{ await eda.sch_PrimitiveComponent.createNetFlag('${id}', ${JSON.stringify(f.net)}, ${f.x}, ${f.y}, ${f.rotation || 0}); n++; }catch(e){}`;
	});
	await runOps('重建标', flagOps);
	console.log('还原完成。');
}

if (process.argv.includes('--undo')) await undo();
else await apply();
