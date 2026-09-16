import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateInstall} from './install_doctor.mjs';

test('offline install doctor checks only reproducible local prerequisites',()=>{
	const result=evaluateInstall({nodeMajor:20,dependenciesOk:true,offline:true});
	assert.equal(result.pass,true);assert.deepEqual(result.checks.map(x=>x.id),['node','dependencies']);
});

test('live doctor distinguishes a healthy bridge from a missing EasyEDA extension connection',()=>{
	const result=evaluateInstall({nodeMajor:22,dependenciesOk:true,skillPath:'/skill',bridge:{service:'easyeda-bridge',port:49620,edaConnected:false,edaWindowCount:0}});
	assert.equal(result.pass,false);assert.equal(result.checks.find(x=>x.id==='bridge').pass,true);assert.equal(result.checks.find(x=>x.id==='eda').pass,false);
	assert.equal(evaluateInstall({nodeMajor:22,dependenciesOk:true,skillPath:'/skill',bridge:{service:'easyeda-bridge',port:49620,edaConnected:true,edaWindowCount:1}}).pass,true);
});
