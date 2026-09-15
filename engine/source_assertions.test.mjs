import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSource } from '../assert_source.mjs';
const component = JSON.stringify({ type: 'COMPONENT', id: 'symbol-instance' }) + '||' + JSON.stringify({x:0,y:0});
test('verified drawing sheet is not an unnamed net port', () => {
  assert.equal(assertSource(component, { componentTypes: {'symbol-instance':'sheet'} }).hard, 0);
  assert.equal(assertSource(component).hard, 1);
});
test('net port remains forbidden even with a designator', () => {
  const source = component + '\n' + JSON.stringify({type:'ATTR',id:'attribute'}) + '||' + JSON.stringify({parentId:'symbol-instance',key:'Designator',value:'port'});
  assert.equal(assertSource(source, {componentTypes:{'symbol-instance':'netport'}}).hard, 1);
});

test('hidden NET bindings with null visibility are not visible labels', () => {
  const source = [
    JSON.stringify({type:'WIRE',id:'wire'})+'||'+JSON.stringify({}),
    JSON.stringify({type:'LINE',id:'line'})+'||'+JSON.stringify({lineGroup:'wire',startX:0,startY:0,endX:20,endY:0}),
    JSON.stringify({type:'ATTR',id:'hidden'})+'||'+JSON.stringify({parentId:'wire',key:'NET',value:'SIGNAL',valueVisible:null,align:null}),
  ].join('\n');
  const report=assertSource(source);
  assert.ok(!report.findings.some(f=>f.rule==='A6-null-align-label'));
  assert.match(report.summary,/标签 0$/);
});

test('a visible NET label without an explicit anchor is a hard source failure', () => {
  const source = [
    JSON.stringify({type:'WIRE',id:'wire'})+'||'+JSON.stringify({}),
    JSON.stringify({type:'LINE',id:'line'})+'||'+JSON.stringify({lineGroup:'wire',startX:0,startY:0,endX:20,endY:0}),
    JSON.stringify({type:'ATTR',id:'visible'})+'||'+JSON.stringify({parentId:'wire',key:'NET',value:'SIGNAL',valueVisible:true,align:null,x:0,y:0}),
  ].join('\n');
  const report=assertSource(source);
  assert.ok(report.findings.some(f=>f.rule==='A6-null-align-label'&&f.sev==='hard'));
});

test('rotated signal and hidden power names are hard source failures; empty placeholders are ignored',()=>{
	const rows=[
		[{type:'WIRE',id:'w'},{}],
		[{type:'ATTR',id:'empty'},{parentId:'w',key:'NET',value:'',valueVisible:true}],
		[{type:'ATTR',id:'rot'},{parentId:'w',key:'NET',value:'SIG',valueVisible:true,align:'LEFT_BOTTOM',rotation:90,x:0,y:0}],
		[{type:'COMPONENT',id:'p'},{x:0,y:0}],
		[{type:'ATTR',id:'pg'},{parentId:'p',key:'Global Net Name',value:'+V',valueVisible:false}],
		[{type:'ATTR',id:'pn'},{parentId:'p',key:'Name',value:'+V',valueVisible:false}],
	].map(([h,a])=>JSON.stringify(h)+'||'+JSON.stringify(a)).join('\n');
	const r=assertSource(rows,{componentTypes:{p:'netflag'}});
	for(const rule of ['A6c-rotated-net-label','A6d-hidden-power-net-name'])
		assert.ok(r.findings.some(f=>f.rule===rule),rule);
	assert.ok(!r.findings.some(f=>f.rule==='A6b-empty-visible-net-label'));
});

test('a power netflag cannot inherit two visible bound name fields',()=>{
	const rows=[
		[{type:'COMPONENT',id:'p'},{x:10,y:-10}],
		[{type:'ATTR',id:'pg'},{parentId:'p',key:'Global Net Name',value:'+V',valueVisible:true}],
		[{type:'ATTR',id:'pn'},{parentId:'p',key:'Name',value:'+V',valueVisible:null}],
	];
	const src=rows.map(([h,a])=>`${JSON.stringify(h)}||${JSON.stringify(a)}|`).join('\n');
	const r=assertSource(src,{componentTypes:{p:'netflag'}});
	assert.ok(r.findings.some(x=>x.rule==='A6f-duplicate-power-net-name'));
});
