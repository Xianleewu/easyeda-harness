import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModel as buildHarnessModel } from '../harness/model.mjs';
import { auditDocumentStyle } from '../harness/document_style.mjs';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function auditDocumentStyleFromSnapshot(snapshot) {
	const model = buildHarnessModel(snapshot);
	return auditDocumentStyle({
		...snapshot,
		...model,
		components: snapshot.components || model.parts || [],
		wires: snapshot.wires || [],
		netflags: snapshot.netflags || [],
		texts: snapshot.texts || [],
		rectangles: snapshot.rectangles || [],
		sheetBBox: snapshot.sheetBBox || model.sheetBBox,
	}, { requireModuleFrames: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const inPath = process.argv[2] || 'full_model.json';
	const outPath = process.argv[3];
	const report = auditDocumentStyleFromSnapshot(readJson(inPath));
	if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`document style ${report.pass ? 'OK' : 'FAIL'} moduleFrames=${report.stats.moduleFrames} titles=${report.stats.moduleTitles}`);
	process.exit(report.pass ? 0 : 1);
}
