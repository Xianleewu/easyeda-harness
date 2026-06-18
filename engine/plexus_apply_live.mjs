// Plexus 就地写回(沙箱):把现有器件移到合成摆位 + 删原线/标 + 画合成线/标 → 真实合成图。
// 破坏性,但先快照存盘(restore 文件)可整体还原。分批避桥超时。
//   node engine/plexus_apply_live.mjs           apply(就地重排)
//   node engine/plexus_apply_live.mjs --undo    从 restore 还原(器件移回 + 删合成 + 重建原线/标)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extractLogical } from './schematic_extract.mjs';
import { inferRoles } from './role_infer.mjs';
import { synthesizeContract } from './design_contract.mjs';
import { planLayout } from './plexus_planner.mjs';
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

// 分批执行一串 op 脚本片段(每片返回 {ids?} 可选)。ops 为字符串数组(EDA 端代码)。
async function runOps(label, ops) {
	let done = 0, failed = 0;
	for (let i = 0; i < ops.length; i += BATCH) {
		const chunk = ops.slice(i, i + BATCH);
		const script = `let n=0; const ids=[];\n${chunk.join('\n')}\nreturn { n, ids };`;
		const r = await execRetry(script);
		if (r && r.result) done += r.result.n; else failed += chunk.length;
		await sleep(350);
	}
	console.log(`  ${label}: ${done}/${ops.length}${failed ? ` (失败跳过 ${failed})` : ''}`);
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
	const r = planLayout({ contract, byDes, logical });
	const g = geomQC(r.model);
	const hard = g.overlaps.length + g.wireThruComp.length + g.crossings + labelQC(r.model).filter(f => f.severity === 'hard').length + synthesisFaithfulness({ logical, contract, model: r.model }).length;
	if (hard) { console.error(`fail-closed:合成 ${hard} 处硬伤,中止`); process.exit(1); }
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
	const wireOps = r.model.wires.map(w => `try{ await eda.sch_PrimitiveWire.create(${JSON.stringify(w.line)}, ${JSON.stringify(w.net || '')}); n++; }catch(e){}`);
	await runOps('画线', wireOps);
	const noSig = process.argv.includes('--no-sig-port') || process.env.PLEXUS_NO_SIG_PORT;
	const flagOps = r.model.netflags.map(f => {
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
