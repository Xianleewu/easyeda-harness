import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowReceipt } from './workflow_receipt.mjs';
import { loadCompileContext } from './compile_context.mjs';

const repo=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=JSON.stringify({type:'DOCHEAD',id:'h'})+'||'+JSON.stringify({docType:'SCH_PAGE',uuid:'doc'});

function fixture(){
	const dir=mkdtempSync(path.join(tmpdir(),'compile-context-'));
	const files={source:path.join(dir,'source.txt'),report:path.join(dir,'workflow-lint.json'),owners:path.join(dir,'owners.json'),
		evidence:path.join(dir,'evidence.json'),context:path.join(dir,'workflow-context.json'),receipt:path.join(dir,'workflow-preflight-receipt.json')};
	const context={document:{uuid:'doc'},artifacts:{source:files.source,report:files.report,pinOwners:files.owners,tokenEvidence:files.evidence}};
	const contextText=JSON.stringify(context,null,2),evidenceText='{}';
	writeFileSync(files.source,source);writeFileSync(files.owners,JSON.stringify({pin:'part'}));writeFileSync(files.evidence,evidenceText);
	writeFileSync(files.context,contextText);writeFileSync(files.report,JSON.stringify({document:{uuid:'doc'},componentTypes:{part:'part'},
		live:{geometryArtifact:'/outside/geometry.json',netlistArtifact:'/outside/netlist.json'}}));
	writeFileSync(files.receipt,JSON.stringify(createWorkflowReceipt({repo,documentUuid:'doc',source,contextText,tokenEvidenceText:evidenceText,tokenEvidencePath:files.evidence})));
	return{dir,files};
}

test('compile follows the report named by the verified lint context instead of a stale fixed check file',()=>{
	const {dir}=fixture();
	writeFileSync(path.join(dir,'workflow-check.json'),JSON.stringify({document:{uuid:'wrong'},componentTypes:{stale:'part'}}));
	const loaded=loadCompileContext({artifactDir:dir,repo});
	assert.deepEqual(loaded.componentTypes,{part:'part'});
	assert.deepEqual(loaded.pinOwners,{pin:'part'});
	assert.equal(loaded.source,source);
});

test('compile context fails closed when its selected report belongs to another document',()=>{
	const {dir,files}=fixture();
	writeFileSync(files.report,JSON.stringify({document:{uuid:'other'},componentTypes:{},live:{geometryArtifact:'g',netlistArtifact:'n'}}));
	assert.throws(()=>loadCompileContext({artifactDir:dir,repo}),/different document/);
});
