import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_PORT_MIN = 49620;
const DEFAULT_PORT_MAX = 49629;

export async function findBridge(preferred = Number(process.env.EASYEDA_BRIDGE_PORT || 0), { timeoutMs = 1200 } = {}) {
	const ports = [];
	if (preferred > 0) ports.push(preferred);
	for (let p = DEFAULT_PORT_MIN; p <= DEFAULT_PORT_MAX; p++) if (p !== preferred) ports.push(p);
	for (const port of ports) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
			const health = await r.json();
			if (health.service === 'easyeda-bridge') return { port, base: `http://127.0.0.1:${port}`, health };
		} catch {}
	}
	throw new Error(`EasyEDA bridge service not found on ports ${DEFAULT_PORT_MIN}-${DEFAULT_PORT_MAX}`);
}

export async function listEdaWindows({ port = 0, timeoutMs = 3000 } = {}) {
	const bridge = await findBridge(port, { timeoutMs });
	const r = await fetch(`${bridge.base}/eda-windows`, { signal: AbortSignal.timeout(timeoutMs) });
	const windows = await r.json();
	return { bridge, windows };
}

export async function executeCode(code, {
	port = Number(process.env.EASYEDA_BRIDGE_PORT || 0),
	windowId = process.env.EASYEDA_WINDOW_ID || '',
	timeoutMs = 120000,
} = {}) {
	const bridge = await findBridge(port);
	const payload = { code: String(code || '').replace(/^\uFEFF/, '') };
	if (windowId) payload.windowId = windowId;
	const resp = await fetch(`${bridge.base}/execute`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await resp.json();
	if (!resp.ok || body.success === false) {
		throw new Error(`EXEC_FAIL: ${JSON.stringify(body)}`);
	}
	return { bridge, body, result: body.result };
}

export async function executeJsFile(jsFile, options = {}) {
	const code = readFileSync(jsFile, 'utf8');
	return executeCode(code, options);
}

export async function saveJsonResult({ jsFile, outFile, ...options }) {
	const { result } = await executeJsFile(jsFile, options);
	writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
	return result;
}

export async function saveImageResult({ jsFile, outFile, ...options }) {
	const { result } = await executeJsFile(jsFile, options);
	if (!result?.b64) throw new Error(`NO_IMAGE_B64: ${JSON.stringify(result)}`);
	writeFileSync(outFile, Buffer.from(result.b64, 'base64'));
	return { type: result.type || '', size: result.size || 0, outFile };
}
