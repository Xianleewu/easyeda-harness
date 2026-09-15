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

// Some bridge versions decode each HTTP chunk separately. ASCII JSON keeps a
// split UTF-8 sequence from silently corrupting document text at that boundary.
export function encodeBridgePayload(payload) {
	return JSON.stringify(payload).replace(/[^\x00-\x7f]/g, c =>
		'\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const WRITE_CONTEXTS = new Set([
	'source-transaction', 'catalog-seed', 'api-transaction',
	'delivery-transaction', 'rollback-transaction', 'pcb-transaction',
]);

const MUTATION_SIGNATURES = [
	/\bsetDocumentSource\s*\(/,
	/\bsch_Document\.save\s*\(/,
	/\b(?:sch|pcb)_Primitive[A-Za-z0-9_]*\.(?:create|delete|modify|update)\s*\(/,
	/\bdmt_(?:Schematic|Pcb|Board)[A-Za-z0-9_]*\.(?:create|delete|copy|modify|update|rename)\s*\(/,
	/\blib_[A-Za-z0-9_]+\.(?:create|copy|delete|modify|updateDocumentSource)\s*\(/,
];

export function bridgeMutationSignatures(code) {
	const source = String(code || '');
	return MUTATION_SIGNATURES.filter(re => re.test(source)).map(re => re.source);
}

export function assertBridgeWriteAuthorized(code, writeContext = '') {
	const signatures = bridgeMutationSignatures(code);
	if (!signatures.length) return { mutating: false, signatures: [] };
	if (!WRITE_CONTEXTS.has(writeContext)) {
		throw new Error('LIVE_WRITE_BLOCKED: mutating EasyEDA calls must run inside wf commit, wf seed, or wf api transaction');
	}
	return { mutating: true, signatures };
}

export function assertBridgeWindow(requestedWindowId, body) {
	const requested = String(requestedWindowId || '');
	const actual = String(body?.windowId || '');
	if (requested && actual !== requested) {
		throw new Error(`BRIDGE_WINDOW_MISMATCH: requested ${requested}, received ${actual || '<missing>'}`);
	}
	return actual;
}

export async function executeCode(code, {
	port = Number(process.env.EASYEDA_BRIDGE_PORT || 0),
	windowId = process.env.EASYEDA_WINDOW_ID || '',
	timeoutMs = 120000,
	writeContext = '',
} = {}) {
	assertBridgeWriteAuthorized(code, writeContext);
	const bridge = await findBridge(port, { timeoutMs });
	const payload = { code: String(code || '').replace(/^\uFEFF/, '') };
	if (windowId) payload.windowId = windowId;
	const resp = await fetch(`${bridge.base}/execute`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', connection: 'close' },
		body: encodeBridgePayload(payload),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await resp.json();
	if (!resp.ok || body.success === false) {
		throw new Error(`EXEC_FAIL: ${JSON.stringify(body)}`);
	}
	assertBridgeWindow(windowId, body);
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
