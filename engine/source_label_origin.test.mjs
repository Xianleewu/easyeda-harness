import test from 'node:test';
import assert from 'node:assert/strict';
import {planSourceLabelOrigins,planSourceLabelColumn} from './source_label_origin.mjs';

const wire=(id,x1,y1,x2,y2)=>({head:{type:'LINE',id:'l-'+id},atom:{lineGroup:id,startX:x1,startY:y1,endX:x2,endY:y2}});
const label=(id,wireId,x,y,align)=>({head:{type:'ATTR',id},atom:{parentId:wireId,key:'NET',value:'SIGNAL',valueVisible:true,x,y,align}});

test('left free-end uses its outer left anchor and right free-end uses its outer right anchor',()=>{
	const left=planSourceLabelOrigins([wire('a',0,0,20,0),label('la','a',0,0,'RIGHT_BOTTOM')]);
	assert.equal(left.edit.get('la').align,'LEFT_BOTTOM');
	const right=planSourceLabelOrigins([wire('b',0,0,20,0),label('lb','b',20,0,'LEFT_BOTTOM')]);
	assert.equal(right.edit.get('lb').align,'RIGHT_BOTTOM');
});

test('horizontal endpoint labels cannot retain a vertical text rotation',()=>{
	const r=planSourceLabelOrigins([
		wire('a',0,0,20,0),
		{...label('la','a',0,0,'LEFT_BOTTOM'),atom:{...label('la','a',0,0,'LEFT_BOTTOM').atom,rotation:90}},
	]);
	assert.equal(r.edit.get('la').rotation,null);
});

test('vertical leader and junction anchors fail closed',()=>{
	const vertical=planSourceLabelOrigins([wire('a',0,0,0,20),label('la','a',0,20,'LEFT_BOTTOM')]);
	assert.equal(vertical.pass,false);
	const junction=planSourceLabelOrigins([wire('b',0,0,20,0),{head:{type:'LINE',id:'v'},atom:{lineGroup:'b',startX:0,startY:0,endX:0,endY:20}},label('lb','b',0,0,'LEFT_BOTTOM')]);
	assert.equal(junction.pass,false);
});

test('origin moves beyond same-wire perpendicular branches with text clearance',()=>{
	const left=planSourceLabelOrigins([
		wire('a',120,0,220,0),
		{head:{type:'LINE',id:'branch'},atom:{lineGroup:'a',startX:150,startY:0,endX:150,endY:30}},
		label('la','a',120,0,'LEFT_BOTTOM'),
	],{charWidth:5,textClearance:10,grid:10});
	assert.equal(left.edit.get('la').x,110); // branch 150 - width 30 - clearance 10
	assert.equal(left.edit.get('l-a').startX,110);
	const right=planSourceLabelOrigins([
		wire('b',0,0,100,0),
		{head:{type:'LINE',id:'branch2'},atom:{lineGroup:'b',startX:70,startY:0,endX:70,endY:30}},
		label('lb','b',100,0,'RIGHT_BOTTOM'),
	],{charWidth:5,textClearance:10,grid:10});
	assert.equal(right.edit.get('lb').x,110);
	assert.equal(right.edit.get('l-b').startX,110);
});

test('same-side column move changes both label origin and its horizontal free end',()=>{
	const p=planSourceLabelColumn([wire('a',100,0,220,0),label('la','a',100,0,'LEFT_BOTTOM')],{labelIds:['la'],x:80});
	assert.equal(p.pass,true);
	assert.equal(p.edit.get('la').x,80);
	assert.equal(p.edit.get('l-a').startX,80);
});

test('same-side labels reserve inward text width, stay column-aligned and split long runs inside one WIRE root',()=>{
	const r=planSourceLabelOrigins([
		wire('a',0,0,40,0),label('la','a',0,0,'RIGHT_BOTTOM'),
		wire('b',0,20,40,20),{...label('lb','b',0,20,'RIGHT_BOTTOM'),atom:{...label('lb','b',0,20,'RIGHT_BOTTOM').atom,value:'LONG_SIGNAL'}},
	],{charWidth:5,textClearance:10,grid:10});
	assert.equal(r.pass,true);
	assert.equal(r.edit.get('la').x,-30);
	assert.equal(r.edit.get('lb').x,-30);
	assert.equal(r.edit.get('la').align,'LEFT_BOTTOM');
	assert.ok(r.add.length>=2,'both long same-root runs are segmented');
	assert.ok(r.add.every(x=>x.atom.lineGroup==='a'||x.atom.lineGroup==='b'));
});
