import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeBoard, judgeBoardTokens, runLiveJudge, judgeSnapshot, normalizeVerifiedDrc, applyLiveFootprintEvidence, footprintLibraryCandidates, buildLiveFootprintReadCode } from './commercial_judge.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('judgeBoard 组装证据化报告', () => {
	const model = { components: [], wires: [] };
	const rep = judgeBoard(model, { drc: { error: 1, warn: 2, info: 0 }, shots: ['/tmp/a.png'] });
	assert.equal(rep.commercialPass, false);    // CR-01 error=1 → block fail
	assert.ok(rep.rules.find(r => r.id === 'CR-01' && r.pass === false));
	assert.deepEqual(rep.shots, ['/tmp/a.png']);
	assert.match(rep.summary, /block/i);
});

test('runLiveJudge 无桥 → fail-closed(reject,不伪装绿灯)', async () => {
	await assert.rejects(
		() => runLiveJudge({ port: 1, outDir: '/tmp', timeoutMs: 10 }),
		/bridge|not found|fetch|abort|ECONN|timeout|no EDA window|connect an EDA window/i
	);
});

test('judgeSnapshot 读 JSON 离线评分', () => {
	const dir = mkdtempSync(join(tmpdir(), 'judge-'));
	const f = join(dir, 's.json');
	writeFileSync(f, JSON.stringify({ components: [], wires: [] }));
	const rep = judgeSnapshot(f, { drc: { error: 0, warn: 0, info: 0 } });
	assert.equal(rep.rules.length, 10);
	assert.equal(rep.commercialPass, true);
});

test('judgeBoardTokens 三层 + shots 透传,DRC脏→不符合', () => {
	const rep = judgeBoardTokens({ components: [], wires: [] }, { drc: { error: 1, warn: 0, info: 0 }, shots: ['/tmp/x.png'] });
	assert.equal(rep.conform, false);
	assert.equal(rep.tier1.conform, false);
	assert.deepEqual(rep.shots, ['/tmp/x.png']);
	assert.equal(rep.score, undefined);
});

test('已在同批次取得的完整原生 DRC 证据可复用，未知证据失败关闭', () => {
	const evidence = { verified: true, counts: { error: 0, warning: 2, info: 0 }, source: 'native-completion' };
	assert.deepEqual(normalizeVerifiedDrc(evidence), {
		error: 0, warn: 2, info: 0, evidence, diagnosticText: '',
	});
	const withText={...evidence,diagnosticText:'[warning] : example'};
	assert.equal(normalizeVerifiedDrc(withText).diagnosticText,'[warning] : example');
	assert.throws(() => normalizeVerifiedDrc({ verified: false, counts: { error: 0, warning: 0, info: 0 } }), /unverified/);
});

test('live footprint evidence replaces caller files and fails closed when the bound library object is unavailable',()=>{
	const profiles=[{ref:'J1',footprintUuid:'fp1',sourceText:'stale-file'}];
	assert.deepEqual(applyLiveFootprintEvidence(profiles,[{footprintUuid:'fp1',verified:true,sourceText:'live-source',artifact:'/tmp/fp1',resolvedLibraryUuid:'project-lib'}]),[{
		...profiles[0],sourceText:'live-source',liveSourceVerified:true,liveSourceArtifact:'/tmp/fp1',liveSourceError:null,liveSourceLibraryUuid:'project-lib',
	}]);
	const missing=applyLiveFootprintEvidence(profiles,[{footprintUuid:'fp1',verified:false,error:'unavailable'}])[0];
	assert.equal(missing.sourceText,'');
	assert.equal(missing.liveSourceVerified,false);
	assert.equal(missing.liveSourceError,'unavailable');
	assert.equal(missing.liveSourceLibraryUuid,null);
});

test('live footprint lookup tries declared library, active project library, then system without duplicates',()=>{
	assert.deepEqual(footprintLibraryCandidates('declared','project'),['declared','project','']);
	assert.deepEqual(footprintLibraryCandidates('project','project'),['project','']);
	assert.deepEqual(footprintLibraryCandidates('','project'),['project','']);
	assert.deepEqual(footprintLibraryCandidates('',''),['']);
	const code=buildLiveFootprintReadCode([{footprintUuid:'fp',libraryUuid:'declared'}]);
	assert.match(code,/getCurrentDocumentInfo/);
	assert.match(code,/getFootprintFileByFootprintUuid/);
	assert.match(code,/resolvedLibraryUuid/);
	assert.doesNotMatch(code,/\[\.\.\.new Set\(\[r\.libraryUuid,project/);
});

test('judgeBoardTokens passes caller-supplied live module/cell evidence into token gates', () => {
	const component = x => ({ designator: `U${x}`, x, y: 0, bbox: { minX: x, minY: 0, maxX: x + 10, maxY: 10 }, pins: [] });
	const model = { components: [component(0), component(100), component(200), component(300)], wires: [], netflags: [] };
	const region = (id, x) => ({ id, module: 'sheet', box: { minX: x - 10, minY: -10, maxX: x + 30, maxY: 20 }, contentBox: { minX: x, minY: 0, maxX: x + 20, maxY: 10 } });
	const rep = judgeBoardTokens(model, {
		drc: { error: 0, warn: 0, info: 0 },
		moduleRegions: [region('m1', 0), region('m2', 100), region('m3', 200), region('m4', 300)],
		cellRegions: [region('c1', 0), region('c2', 100), region('c3', 200), region('c4', 300)],
	});
	assert.equal(rep.tier2.find(x => x.token === 'T-MODULE-SPACING').detail.regions, 4);
	assert.equal(rep.tier2.find(x => x.token === 'T-CELL-SPACING').detail.cells, 4);
});
