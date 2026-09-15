import test from 'node:test';
import assert from 'node:assert/strict';
import { rebindSourceFootprints } from './source_footprint_ops.mjs';

const records=[
	{head:{type:'COMPONENT',id:'p'},atom:{partId:'same'}},
	{head:{type:'ATTR',id:'d'},atom:{parentId:'p',key:'Designator',value:'R7'}},
	{head:{type:'ATTR',id:'f'},atom:{parentId:'p',key:'Footprint',value:'old'}},
	{head:{type:'ATTR',id:'s'},atom:{parentId:'p',key:'Symbol',value:'symbol'}},
	{head:{type:'ATTR',id:'v'},atom:{parentId:'p',key:'Device',value:'device'}},
];

test('footprint rebind edits only the footprint attr and emits an exact directed repair',()=>{
	const edit=new Map();
	const result=rebindSourceFootprints(records,edit,[{ref:'R7',beforeUuid:'old',afterUuid:'new',source:'mechanically audited source'}]);
	assert.deepEqual(edit.get('f'),{parentId:'p',key:'Footprint',value:'new'});
	assert.deepEqual(result.repairs.R7.changes,{Footprint:{before:'old',current:'new'}});
	assert.equal(result.repairs.R7.verified,true);
	assert.equal(edit.size,1);
});

test('footprint rebind fails closed on stale identity or missing objects',()=>{
	assert.throws(()=>rebindSourceFootprints(records,new Map(),[{ref:'R7',beforeUuid:'wrong',afterUuid:'new'}]),/baseline changed/);
	assert.throws(()=>rebindSourceFootprints(records,new Map(),[{ref:'C9',beforeUuid:'old',afterUuid:'new'}]),/component missing/);
});
