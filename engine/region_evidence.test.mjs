import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRegionEvidence} from './region_evidence.mjs';

const comp=(designator,x)=>({designator,bbox:{minX:x,minY:0,maxX:x+10,maxY:10},attrs:[],pins:[{num:'1',x:x+10,y:5}]});

test('region evidence includes local wire/flag geometry but excludes cross-region interfaces',()=>{
	const model={
		components:[comp('J1',0),comp('U1',100)],
		wires:[
			{id:'local',net:'LOCAL',line:[10,5,30,5]},
			{id:'cross-a',net:'BUS',line:[10,5,50,5]},
			{id:'cross-b',net:'BUS',line:[110,5,80,5]},
		],
		netflags:[{net:'LOCAL',x:30,y:5,bbox:{minX:28,minY:3,maxX:32,maxY:7},nameBox:{minX:25,minY:8,maxX:35,maxY:16}}],
	};
	const r=buildRegionEvidence(model,[{id:'input',members:['J1']},{id:'core',members:['U1']}]);
	assert.equal(r[0].contentBox.maxX,35,'local flag name is included');
	assert.equal(r[1].contentBox.minX,100,'cross-region BUS segments are excluded from both content boxes');
});

test('disconnected same-name supply roots keep each built-in flag inside its local region',()=>{
	const model={
		components:[comp('U1',0),comp('U2',100)],
		wires:[
			{id:'pwr-a',net:'+V',line:[10,5,30,5]},
			{id:'pwr-b',net:'+V',line:[110,5,130,5]},
		],
		netflags:[
			{id:'fa',net:'+V',x:30,y:5,bbox:{minX:28,minY:3,maxX:32,maxY:9},nameBox:{minX:25,minY:12,maxX:35,maxY:20}},
			{id:'fb',net:'+V',x:130,y:5,bbox:{minX:128,minY:3,maxX:132,maxY:9},nameBox:{minX:125,minY:12,maxX:135,maxY:20}},
		],
	};
	const r=buildRegionEvidence(model,[{id:'a',members:['U1']},{id:'b',members:['U2']}]);
	assert.deepEqual(r.map(x=>x.contentBox.maxY),[20,20]);
	assert.deepEqual(r.map(x=>x.contentBox.maxX),[35,135]);
});

test('membership is fail-closed for missing or duplicate parts',()=>{
	assert.throws(()=>buildRegionEvidence({components:[comp('U1',0)]},[{id:'a',members:['U2']}]),/missing/);
	assert.throws(()=>buildRegionEvidence({components:[comp('U1',0)]},[{id:'a',members:['U1']},{id:'b',members:['U1']}]),/multiple/);
});

test('complete live evidence cannot omit a fitted component',()=>{
	const model={components:[comp('U1',0),comp('C1',40)],wires:[],netflags:[]};
	assert.throws(()=>buildRegionEvidence(model,[{id:'core',members:['U1']}],{requireComplete:true}),/incomplete.*C1/i);
});

test('runtime placeholder attribute boxes at the origin do not expand a region',()=>{
	const c=comp('U1',100);
	c.attrs=[{key:'Name',valueVisible:true,bbox:{minX:0,minY:0,maxX:0,maxY:0}}];
	const wires=[{net:'LOCAL',line:[110,5,130,5],attrs:[
		{key:'Relevance',bbox:{minX:0,minY:0,maxX:0,maxY:0}},
		{key:'NET',valueVisible:false,bbox:{minX:0,minY:0,maxX:0,maxY:0}},
	]}];
	const [region]=buildRegionEvidence({components:[c],wires,netflags:[]},[{id:'core',members:['U1']}]);
	assert.deepEqual(region.contentBox,{minX:100,minY:0,maxX:130,maxY:10});
});
