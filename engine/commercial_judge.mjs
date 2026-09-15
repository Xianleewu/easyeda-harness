// 裁判 harness:取证(桥)→ 打分(纯)→ 证据化报告。零特定电路内容(报告只含匿名规则+证据路径)。
import { scoreAll } from './commercial_rubric.mjs';
import { judgeTokens } from './token_conformance.mjs';
import { readCompleteGeometry, captureRegion, regionFromParts } from './bridge_windows.mjs';
import { executeCode } from './bridge_client.mjs';
import { evaluateDrcEvidence, parseDrcDiagnosticRows, attributeDrcRows, currentPageDrcMagnitude, deriveCurrentPageDrc } from './drc_result.mjs';
import { buildRegionEvidence } from './region_evidence.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { passiveKind } from './passive_footprint_audit.mjs';

export function judgeBoard(model, { drc, shots = [] } = {}) {
	const s = scoreAll(model, { drc });
	const summary = `block 失败 ${s.blockFail} / flag 失败 ${s.flagFail} / 商用达标=${s.commercialPass}`;
	return { commercialPass: s.commercialPass, blockFail: s.blockFail, flagFail: s.flagFail, rules: s.rules, shots, summary };
}

export function judgeBoardTokens(model, { drc, shots = [], nets, ...tokenEvidence } = {}) {
	const j = judgeTokens(model, { drc, nets, ...tokenEvidence });
	return { ...j, shots };
}

/* 权威网表 → {designator:{pin:net}}(给 T-ADJACENCY;读真值,API 可达,绝不臆测)。 */
async function readNetlist({ windowId, port, timeoutMs }) {
	try {
		const txt = (await executeCode('try{const f=await eda.sch_ManufactureData.getNetlistFile();return await f.text();}catch(e){return "";}', { windowId, port, timeoutMs })).result;
		if (!txt) return null;
		const j = JSON.parse(txt), nets = {};
		for (const [, c] of Object.entries(j.components || {})) {
			const d = c.props && c.props.Designator; if (!d) continue;
			nets[d] = {}; for (const [p, inf] of Object.entries(c.pinInfoMap || {})) nets[d][p] = inf.net;
		}
		return { nets, rawText: txt };
	} catch { return null; }
}

/* 标题栏区域真 bbox:取无 Designator 的图框件(frame)的【可见 attr bbox 并集】(标题栏文字真位置,读真值非猜)。 */
function titleBlockBBox(components) {
	const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const c of components || []) {
		if (c.designator) continue;                 /* 仅无位号件=图框/标题栏 */
		for (const a of (c.attrs || [])) {
			if (!a.bbox || !(a.valueVisible || a.keyVisible)) continue;
			b.minX = Math.min(b.minX, a.bbox.minX); b.minY = Math.min(b.minY, a.bbox.minY);
			b.maxX = Math.max(b.maxX, a.bbox.maxX); b.maxY = Math.max(b.maxY, a.bbox.maxY);
		}
	}
	return Number.isFinite(b.minX) ? b : null;
}

async function runDrc({ windowId, port, timeoutMs = 120000 }) {
	const code = `
const lines=()=>((document.body&&document.body.innerText)||'').split('\\n').filter(x=>/完成设计规则检查|design rule check/i.test(x));
let changed=false;const observer=new MutationObserver(()=>{changed=true});observer.observe(document.body,{childList:true,subtree:true,characterData:true});
const raw = await eda.sch_Drc.check(true, true, true).catch(()=>null);
let now=lines();for(let i=0;i<20&&!now.length;i++){await new Promise(r=>setTimeout(r,100));now=lines();}observer.disconnect();
const body=((document.body&&document.body.innerText)||'');
return { raw, completion:now.at(-1)||'', fresh:changed&&now.length>0, invoked:true,
  diagnosticText:body.slice(Math.max(0,body.length-30000)) };
`;
	const { result } = await executeCode(code, { windowId, port, timeoutMs });
	const parsed=evaluateDrcEvidence(result?.raw,{completion:result?.completion,fresh:result?.fresh,invoked:result?.invoked});
	return { error:parsed.counts?.error??null, warn:parsed.counts?.warning??null, info:parsed.counts?.info??null, evidence:parsed,
		diagnosticText:result?.diagnosticText||'' };
}

export function normalizeVerifiedDrc(evidence) {
	const counts = evidence?.counts;
	if (evidence?.verified !== true || !counts || !['error', 'warning', 'info'].every(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0))
		throw new Error('Provided native DRC evidence is incomplete or unverified');
	return { error: counts.error, warn: counts.warning, info: counts.info, evidence,
		diagnosticText: typeof evidence.diagnosticText === 'string' ? evidence.diagnosticText : '' };
}

export function applyLiveFootprintEvidence(profiles, liveSources = []) {
	const byUuid=new Map((liveSources||[]).map(item=>[String(item?.footprintUuid||''),item]));
	return (profiles||[]).map(profile=>{
		const uuid=String(profile?.footprintUuid||''),live=byUuid.get(uuid);
		return {...profile,sourceText:String(live?.sourceText||''),liveSourceVerified:live?.verified===true,
			liveSourceArtifact:live?.artifact||null,liveSourceError:live?.error||null,
			liveSourceLibraryUuid:live?.resolvedLibraryUuid||null};
	});
}

export function footprintLibraryCandidates(explicitLibraryUuid = '', projectLibraryUuid = '') {
	const named = [explicitLibraryUuid, projectLibraryUuid].map(value => String(value || '').trim()).filter(Boolean);
	return [...new Set(named), ''];
}

export function buildLiveFootprintReadCode(requests) {
	const candidateResolver = footprintLibraryCandidates.toString();
	return `const req=${JSON.stringify(requests)},out=[],libraryCandidates=${candidateResolver},info=await eda.dmt_SelectControl.getCurrentDocumentInfo(),project=String(info?.parentProjectUuid||'');for(const r of req){let f=null,resolvedLibraryUuid='',errors=[];const libs=libraryCandidates(r.libraryUuid,project);for(const lib of libs){try{const candidate=await eda.sys_FileManager.getFootprintFileByFootprintUuid(r.footprintUuid,lib||undefined,'elibz2');if(candidate&&Number.isFinite(candidate.size)&&candidate.size>0){f=candidate;resolvedLibraryUuid=lib;break;}}catch(e){errors.push(String(e))}}if(!f){out.push({...r,verified:false,error:errors.at(-1)||'footprint-file-unavailable'});continue;}const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));out.push({...r,resolvedLibraryUuid,verified:true,size:f.size,name:f.name||'',type:f.type||'',base64:btoa(binary)});}return out;`;
}

async function readLiveFootprintEvidence(profiles,{windowId,port,timeoutMs,outDir}){
	const requests=[...new Map((profiles||[]).filter(p=>p?.footprintUuid).map(p=>[String(p.footprintUuid),{
		footprintUuid:String(p.footprintUuid),libraryUuid:String(p.libraryUuid||''),
	}])).values()];
	if(!requests.length)return [];
	const code=buildLiveFootprintReadCode(requests);
	const rows=(await executeCode(code,{windowId,port,timeoutMs})).result;
	if(!Array.isArray(rows))return requests.map(r=>({...r,verified:false,error:'footprint-query-invalid'}));
	const dir=path.join(outDir,'live-footprints');mkdirSync(dir,{recursive:true});
	return rows.map(row=>{
		const safe=String(row.footprintUuid||'unknown').replace(/[^A-Za-z0-9_.-]/g,'_');
		if(row.verified!==true||!row.base64)return {...row,verified:false,sourceText:''};
		try{
			const zipFile=path.join(dir,`${safe}.elibz2`);writeFileSync(zipFile,Buffer.from(row.base64,'base64'));
			const entries=execFileSync('unzip',['-Z1',zipFile],{encoding:'utf8',maxBuffer:1024*1024}).split(/\r?\n/).filter(Boolean);
			const sourceEntry=entries.find(name=>/\.elibu$/i.test(name));
			if(!sourceEntry)throw Error('archive-has-no-elibu-source');
			const sourceText=execFileSync('unzip',['-p',zipFile,sourceEntry],{encoding:'utf8',maxBuffer:32*1024*1024});
			const sourceFile=path.join(dir,`${safe}.elibu`);writeFileSync(sourceFile,sourceText,'utf8');
			return {...row,base64:undefined,verified:sourceText.length>0,sourceText,artifact:sourceFile,error:sourceText.length?'':'footprint-source-empty'};
		}catch(error){return {...row,base64:undefined,verified:false,sourceText:'',error:error.message};}
	});
}

export function judgeSnapshot(snapshotPath, { drc } = {}) {
	const model = JSON.parse(readFileSync(snapshotPath, 'utf8').replace(/^﻿/, ''));
	return judgeBoard(model, { drc, shots: [] });
}

export async function runLiveJudge({ windowId = '', port = 0, outDir = '.', timeoutMs = 120000,
	moduleRegions, cellRegions, placementExceptions, connectorMountExceptions, connectorSemanticProfiles, connectorFootprintProfiles, highSpeedProfiles, passiveElectricalProfiles, adjacency,
	sheetBounds, titleBlockKeepout, pageClearance, captureCanvas = true, verifiedDrc = null } = {}) {
	/* Canonical reader merges source NET labels and fails closed if label coverage is unknown. */
	const model = await readCompleteGeometry({ windowId, port, timeoutMs });
	/* 权威网表(T-ADJACENCY)+ 标题栏真 bbox(器件/标签压标题栏)→ live judge 与 model judge 同等完整,不留瞎区 */
	const netlist = await readNetlist({ windowId, port, timeoutMs });
	const nets = netlist?.nets || null;
	const passiveProfileByRef=new Map((passiveElectricalProfiles||[]).map(profile=>[String(profile?.ref||''),profile]));
	const passiveFootprintRequests=(model.components||[]).filter(passiveKind).map(component=>({
		footprintUuid:String((component.attrs||[]).find(a=>a.key==='Footprint')?.value||''),
		libraryUuid:String(passiveProfileByRef.get(String(component.designator||''))?.libraryUuid||''),
	}));
	const liveFootprintSources=await readLiveFootprintEvidence([...(connectorFootprintProfiles||[]),...passiveFootprintRequests],{windowId,port,timeoutMs,outDir});
	const measuredFootprintProfiles=applyLiveFootprintEvidence(connectorFootprintProfiles,liveFootprintSources);
	const tb = titleBlockBBox(model.components || []);
	if (tb) model._titleBlock = tb;
	// Measure boxes from this exact live geometry. The runtime manifest declares
	// membership and relationships; stale hand-entered boxes cannot pass spacing.
	const materialize = regions => !regions ? regions : buildRegionEvidence(model,regions,{padding:10,requireComplete:false});
	const measuredModules=materialize(moduleRegions), measuredCells=materialize(cellRegions);
	// A workflow that already awaited native DRC may pass that exact verified
	// evidence. This avoids rerunning the expensive native check in the same batch.
	const drc = verifiedDrc ? normalizeVerifiedDrc(verifiedDrc) : await runDrc({ windowId, port, timeoutMs });
	const designators=(model.components||[]).map(c=>c.designator).filter(Boolean);
	const componentNames=(model.components||[]).map(c=>c.name).filter(Boolean);
	drc.diagnosticRows=attributeDrcRows(parseDrcDiagnosticRows(drc.diagnosticText),{designators,componentNames});
	drc.currentPageMagnitude=currentPageDrcMagnitude(drc.diagnosticRows);
	mkdirSync(outDir, { recursive: true });
	const netlistArtifact = netlist ? `${outDir}/authoritative-netlist.json` : null;
	if (netlistArtifact) writeFileSync(netlistArtifact, netlist.rawText, 'utf8');
	const scopedDrc=deriveCurrentPageDrc(drc.evidence,drc.diagnosticRows);
	drc.scopeEvidence=scopedDrc;
	if (scopedDrc.verified) {
		drc.rawCounts={error:drc.error,warning:drc.warn,info:drc.info};
		drc.error=scopedDrc.counts.error; drc.warn=scopedDrc.counts.warning; drc.info=scopedDrc.counts.info;
	}
	const shots = [];
	const region = captureCanvas ? regionFromParts(model.components || []) : null;
	if (region) {
		const out = `${outDir}/judge_region.png`;
		try { await captureRegion({ windowId, port, region, outFile: out, timeoutMs }); shots.push(out); } catch { /* 截图失败不伪装,留空证据 */ }
	}
	const report = judgeBoardTokens(model, { drc, shots, nets, moduleRegions:measuredModules, cellRegions:measuredCells,
		placementExceptions, connectorMountExceptions, connectorSemanticProfiles, connectorFootprintProfiles:measuredFootprintProfiles, highSpeedProfiles, passiveElectricalProfiles, passiveFootprintSources:liveFootprintSources, adjacency, sheetBounds, titleBlockKeepout, pageClearance,
		requirePageEvidence: true, requireConnectorSemanticEvidence: true, requireLiveFootprintEvidence:true, requireHighSpeedEvidence: true, requirePassiveEvidence:true, requireNetlistEvidence:true, requireRegionEvidence:true });
	const geometryArtifact = `${outDir}/complete_geometry.json`;
	writeFileSync(geometryArtifact, JSON.stringify(model, null, 2), 'utf8');
	const liveReport = { ...report, drc, regionEvidence:{moduleRegions:measuredModules,cellRegions:measuredCells}, footprintEvidence:liveFootprintSources.map(({base64,...item})=>item), geometryArtifact, netlistArtifact,
		captureMode:captureCanvas?'final-canvas':'deterministic-only',capturedAt: new Date().toISOString() };
	writeFileSync(`${outDir}/judge_report.json`, JSON.stringify(liveReport, null, 2), 'utf8');
	return liveReport;
}
