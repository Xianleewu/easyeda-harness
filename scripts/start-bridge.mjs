#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

for(let port=49620;port<=49629;port++)try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(250)});const h=await r.json();if(h?.service==='easyeda-bridge'){console.log(`Bridge already running on port ${port}`);process.exit(0);}}catch{}
const candidates=[process.env.EASYEDA_API_SKILL_DIR,path.join(homedir(),'.codex','skills','easyeda-api-skill'),
	path.join(homedir(),'.codex-alt','skills','easyeda-api-skill'),path.join(homedir(),'.agents','skills','easyeda-api-skill'),
	path.join(homedir(),'.local','share','easyeda-api-skill')].filter(Boolean);
const root=candidates.find(dir=>existsSync(path.join(dir,'scripts','bridge-server.mjs')));
if(!root)throw new Error('easyeda-api-skill not found; set EASYEDA_API_SKILL_DIR or follow docs/getting-started.md');
const child=spawn(process.execPath,[path.join(root,'scripts','bridge-server.mjs')],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exit(code??1);});
