import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const readJson=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const stamp=file=>{try{const s=statSync(file,{bigint:true});return`${s.mtimeNs}:${s.size}`;}catch{return'';}};

export function inspectFreshQuickBaseline({artifactDir,previous={},maxParts=25}){
	const reportPath=path.join(artifactDir,'workflow-lint.json');
	const receiptPath=path.join(artifactDir,'workflow-preflight-receipt.json');
	for(const file of [reportPath,receiptPath])if(!stamp(file)||stamp(file)===previous[file])
		throw new Error(`quick baseline artifact is stale: ${path.basename(file)}`);
	const report=readJson(reportPath),windowId=String(report?.windowId||''),documentUuid=String(report?.document?.uuid||'');
	if(!windowId||!documentUuid)throw new Error('quick lint did not bind an EasyEDA window and schematic document');
	const geometryPath=String(report?.live?.geometryArtifact||'');
	if(!geometryPath)throw new Error('quick lint lacks complete geometry evidence');
	const geometry=readJson(geometryPath);
	const fitted=(geometry.components||[]).filter(component=>String(component?.designator||'').trim()).length;
	if(fitted>maxParts)throw new Error(`quick is limited to ${maxParts} fitted parts; current board has ${fitted}`);
	return{report,windowId,documentUuid,fitted,reportPath,receiptPath};
}

export function runQuickWorkflow({repo,artifactDir,transformPath,env=process.env,run=spawnSync,maxParts=25}){
	if(!transformPath)throw new Error('Usage: wf quick <transform.mjs>');
	const node=process.execPath,wf=path.join(repo,'wf.mjs'),compile=path.join(repo,'compile.mjs');
	const tracked=[path.join(artifactDir,'workflow-lint.json'),path.join(artifactDir,'workflow-preflight-receipt.json')];
	const previous=Object.fromEntries(tracked.map(file=>[file,stamp(file)]));
	const invoke=(label,file,args,stepEnv,{allowFreshRedLint=false}={})=>{
		const result=run(node,[file,...args],{cwd:artifactDir,env:stepEnv,stdio:'inherit'});
		if(result?.error)throw new Error(`${label} failed to start: ${result.error.message}`);
		if(result?.status!==0&&!allowFreshRedLint)throw new Error(`${label} failed with exit ${result?.status ?? 'unknown'}`);
		return result;
	};
	const baseEnv={...env,EASYEDA_ARTIFACT_DIR:artifactDir};
	invoke('quick lint',wf,['lint'],baseEnv,{allowFreshRedLint:true});
	const baseline=inspectFreshQuickBaseline({artifactDir,previous,maxParts});
	const pinnedEnv={...baseEnv,EASYEDA_WINDOW_ID:baseline.windowId,EASYEDA_DOCUMENT_UUID:baseline.documentUuid};
	invoke('quick compile',compile,[path.resolve(transformPath),'--artifact-dir',artifactDir],pinnedEnv);
	invoke('quick commit',wf,['commit',path.resolve(transformPath)],{...pinnedEnv,EASYEDA_REPAIR_STAGE:'1'});
	invoke('quick audit',wf,['audit'],pinnedEnv);
	return{pass:true,windowId:baseline.windowId,documentUuid:baseline.documentUuid,fitted:baseline.fitted,steps:['lint','compile','commit','audit']};
}
