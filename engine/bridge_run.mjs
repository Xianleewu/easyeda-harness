import { saveJsonResult, executeJsFile } from './bridge_client.mjs';

export async function runBridgeSave({ jsFile, outFile, windowId = '', timeoutMs = 120000 }) {
	return saveJsonResult({ jsFile, outFile, windowId, timeoutMs });
}

export async function runBridge({ jsFile, windowId = '', timeoutMs = 120000 }) {
	return executeJsFile(jsFile, { windowId, timeoutMs });
}
