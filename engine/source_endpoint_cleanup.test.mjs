import test from 'node:test';
import assert from 'node:assert/strict';
import {planEndpointTextCleanup} from './source_endpoint_cleanup.mjs';
const r=(type,id,atom)=>({head:{type,id},atom});

test('endpoint cleanup flattens labels and shows named power rails',()=>{
	const plan=planEndpointTextCleanup([
		r('ATTR','blank',{parentId:'w',key:'NET',value:'',valueVisible:true}),
		r('ATTR','sig',{parentId:'w',key:'NET',value:'SIG',valueVisible:true,rotation:90}),
		r('COMPONENT','p',{x:0,y:0}),
		r('ATTR','pg',{parentId:'p',key:'Global Net Name',value:'+V',valueVisible:false}),
		r('ATTR','pn',{parentId:'p',key:'Name',value:'+V',valueVisible:false}),
		r('COMPONENT','p2',{x:20,y:30,rotation:90}),
		r('ATTR','p2g',{parentId:'p2',key:'Global Net Name',value:'VDD',valueVisible:null,rotation:90}),
	]);
	assert.equal(plan.edit.has('blank'),false,'EasyEDA empty NET placeholder is non-rendering and importer-owned');
	assert.equal(plan.edit.get('sig').rotation,null);
	assert.equal(plan.edit.get('pg').valueVisible,true);
	assert.equal(plan.edit.get('pg').y,0,'newly shown power name moves to the symbol connection origin');
	assert.equal(plan.edit.get('p2g').rotation,0);
	assert.equal(plan.edit.get('p2g').x,5);
	assert.equal(plan.edit.get('p2g').align,'RIGHT_MIDDLE');
});
