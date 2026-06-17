// EasyEDA 实时桥接就绪自检（只读）：实时交付链(live-check/deliver/apply --gated)
// 依赖 easyeda-api-skill bridge 连接真实 EasyEDA 编辑器。桥接缺失时给出清晰可操作的
// 启动指引，而不是深处抛出晦涩堆栈。退出码 0=就绪，3=桥接不可达。
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBridge, listEdaWindows } from './bridge_client.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_BRIDGE_CHECK_REPORT || DIR + 'bridge_check_report.json';
const PROBE_TIMEOUT_MS = Number(process.env.EASYEDA_BRIDGE_PROBE_MS || 800);

function windowCount(windows) {
	if (Array.isArray(windows)) return windows.length;
	if (windows && Array.isArray(windows.windows)) return windows.windows.length;
	return 0;
}

async function main() {
	let bridge = null;
	let windows = 0;
	let error = null;
	try {
		bridge = await findBridge(Number(process.env.EASYEDA_BRIDGE_PORT || 0), { timeoutMs: PROBE_TIMEOUT_MS });
		try {
			const listed = await listEdaWindows({ port: bridge.port, timeoutMs: 2000 });
			windows = windowCount(listed.windows);
		} catch { /* window listing is best-effort */ }
	} catch (e) {
		error = e.message;
	}
	const pass = !!bridge;
	const report = {
		generatedAt: new Date().toISOString(),
		pass,
		root: resolve(DIR),
		bridge: bridge ? { port: bridge.port, base: bridge.base, health: bridge.health } : null,
		edaWindows: windows,
		error,
	};
	writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

	if (pass) {
		console.log(`bridge check PASS port=${report.bridge.port} edaWindows=${windows}`);
		console.log(`report -> ${REPORT}`);
		if (windows === 0) {
			console.log('note: bridge is up but no EasyEDA editor window is connected; open the target schematic before live-check.');
		}
		process.exit(0);
	}

	console.error('bridge check FAIL: EasyEDA live bridge not reachable on ports 49620-49629.');
	console.error('Live evidence (live-check / deliver / apply --gated) needs the easyeda-api-skill bridge connected to a real EasyEDA editor.');
	console.error('To enable it:');
	console.error('  1. export http_proxy=http://192.168.32.15:7890   # only if a clone/install needs the proxy');
	console.error('  2. install + start easyeda-api-skill  (https://github.com/easyeda/easyeda-api-skill)');
	console.error('  3. open the target schematic in the EasyEDA Pro editor so the bridge can attach to its window');
	console.error('  4. verify: curl -s http://127.0.0.1:49620/health   (expect "service":"easyeda-bridge")');
	console.error(`report -> ${REPORT}`);
	process.exit(3);
}

main();
