import { executeJsFile, saveImageResult, saveJsonResult } from './bridge_client.mjs';

function argValue(name, fallback = '') {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const jsFile = argValue('--js');
const outFile = argValue('--out');
const windowId = argValue('--window-id', process.env.EASYEDA_WINDOW_ID || '');
const preferredPort = Number(argValue('--port', process.env.EASYEDA_BRIDGE_PORT || '0'));
const mode = argValue('--mode', 'json');

if (!jsFile) {
	console.error('usage: node engine/bridge_exec.mjs --js <script.js> [--out file] [--mode json|image] [--window-id id] [--port n]');
	process.exit(2);
}

if (mode === 'image') {
	if (!outFile) throw new Error('--out is required for image mode');
	await saveImageResult({ jsFile, outFile, windowId, port: preferredPort });
	console.log(`SAVED ${outFile}`);
} else {
	const result = outFile
		? await saveJsonResult({ jsFile, outFile, windowId, port: preferredPort })
		: (await executeJsFile(jsFile, { windowId, port: preferredPort })).result;
	const text = JSON.stringify(result, null, 2);
	if (outFile) {
		console.log(`SAVED ${outFile}`);
	} else {
		console.log(text);
	}
}
