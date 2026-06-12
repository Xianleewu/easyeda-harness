import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function runBridgeSave({ dir, jsFile, outFile, windowId = '', stdio = 'inherit' }) {
	const args = ['-ExecutionPolicy', 'Bypass', '-File', `${dir}run-save.ps1`, '-JsFile', jsFile, '-OutFile', outFile];
	if (windowId) args.push('-WindowId', windowId);
	const ps = spawnSync('powershell', args, { encoding: 'utf8', cwd: dir, stdio });
	if (ps.status !== 0) {
		throw new Error(`run-save failed for ${jsFile}: ${ps.stdout || ps.stderr}`);
	}
	return JSON.parse(readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''));
}
