#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {evaluateInstall} from '../engine/install_doctor.mjs';

const offline=process.argv.includes('--offline'),require=createRequire(import.meta.url);
let dependenciesOk=true;for(const name of ['@resvg/resvg-js','elkjs'])try{require.resolve(name);}catch{dependenciesOk=false;}
const skillCandidates=[process.env.EASYEDA_API_SKILL_DIR,
	path.join(homedir(),'.codex','skills','easyeda-api-skill'),path.join(homedir(),'.codex-alt','skills','easyeda-api-skill'),
	path.join(homedir(),'.agents','skills','easyeda-api-skill'),path.join(homedir(),'.local','share','easyeda-api-skill')].filter(Boolean);
const skillPath=skillCandidates.find(dir=>existsSync(path.join(dir,'scripts','bridge-server.mjs')))||'';
let bridge=null;
if(!offline)for(let port=49620;port<=49629;port++)try{
	const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(400)});
	const health=await response.json();if(health?.service==='easyeda-bridge'){bridge={...health,port};break;}
}catch{}
const result=evaluateInstall({nodeMajor:Number(process.versions.node.split('.')[0]),dependenciesOk,skillPath,bridge,offline});
for(const check of result.checks)console.log(`${check.pass?'✓':'✗'} ${check.id}: ${check.detail}`);
if(!result.pass){
	if(!offline&&!skillPath)console.log('  Install: git clone https://github.com/easyeda/easyeda-api-skill ~/.local/share/easyeda-api-skill && npm --prefix ~/.local/share/easyeda-api-skill install');
	if(!offline&&skillPath&&!bridge)console.log('  Start: npm run bridge');
	if(!offline&&bridge?.edaConnected!==true)console.log('  EasyEDA: install/load https://jlc-ext.com/item/oshwhub/run-api-gateway, then open a schematic');
}
process.exitCode=result.pass?0:1;
