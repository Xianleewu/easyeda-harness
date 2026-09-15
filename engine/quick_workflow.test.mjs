import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runQuickWorkflow } from './quick_workflow.mjs';

function harness(parts){
	const dir=mkdtempSync(path.join(tmpdir(),'quick-workflow-')),geometry=path.join(dir,'geometry.json'),calls=[];
	const run=(_node,args,options)=>{
		calls.push({args,env:options.env});
		if(args.at(-1)==='lint'){
			writeFileSync(geometry,JSON.stringify({components:Array.from({length:parts},(_,i)=>({designator:`X${i+1}`}))}));
			writeFileSync(path.join(dir,'workflow-lint.json'),JSON.stringify({windowId:'window',document:{uuid:'document'},live:{geometryArtifact:geometry}}));
			writeFileSync(path.join(dir,'workflow-preflight-receipt.json'),'{}');
			return{status:1};
		}
		return{status:0};
	};
	return{dir,calls,run};
}

test('quick turns one fresh red lint into compile, one guarded commit and one final audit on the pinned window',()=>{
	const h=harness(12),out=runQuickWorkflow({repo:'/repo',artifactDir:h.dir,transformPath:'/private/fix.mjs',run:h.run});
	assert.deepEqual(out.steps,['lint','compile','commit','audit']);
	assert.equal(out.fitted,12);
	assert.deepEqual(h.calls.map(x=>x.args.slice(0,2)),[['/repo/wf.mjs','lint'],['/repo/compile.mjs','/private/fix.mjs'],['/repo/wf.mjs','commit'],['/repo/wf.mjs','audit']]);
	for(const call of h.calls.slice(1)){assert.equal(call.env.EASYEDA_WINDOW_ID,'window');assert.equal(call.env.EASYEDA_DOCUMENT_UUID,'document');}
	assert.equal(h.calls[2].env.EASYEDA_REPAIR_STAGE,'1');
});

test('quick refuses a board beyond its small-board limit before compile or write',()=>{
	const h=harness(26);
	assert.throws(()=>runQuickWorkflow({repo:'/repo',artifactDir:h.dir,transformPath:'/private/fix.mjs',run:h.run}),/limited to 25/);
	assert.equal(h.calls.length,1);
});

test('quick never treats a failed lint with no fresh artifacts as a red repair baseline',()=>{
	const dir=mkdtempSync(path.join(tmpdir(),'quick-workflow-empty-')),calls=[];
	assert.throws(()=>runQuickWorkflow({repo:'/repo',artifactDir:dir,transformPath:'/private/fix.mjs',
		run:(_node,args)=>{calls.push(args);return{status:1};}}),/artifact is stale/);
	assert.equal(calls.length,1);
});
