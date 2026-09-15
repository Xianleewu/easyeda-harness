import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBoardOutlineSources } from './pcb_live_snapshot.mjs';

test('extracts a generic rectangular PCB outline from document source', () => {
	const source = [
		'{"type":"LAYER"}||{"layerId":11}|',
		'{"type":"POLY","id":"outline"}||{"layerId":11,"path":["R",0,0,800,500,0,39.3701],"polyType":"NORMAL"}|',
		'{"type":"POLY","id":"copper"}||{"layerId":1,"path":["R",0,0,50,50,0,0]}|',
	].join('\n');
	assert.deepEqual(extractBoardOutlineSources(source), [['R', 0, 0, 800, 500, 0, 39.3701]]);
});
