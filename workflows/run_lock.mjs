import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function lockDir(root, name) {
	return `${root.replace(/\\/g, '/').replace(/\/$/, '')}/.easyeda-harness-${name}.lock`;
}

function readLock(path) {
	try {
		return JSON.parse(readFileSync(`${path}/owner.json`, 'utf8').replace(/^\uFEFF/, ''));
	} catch {
		return null;
	}
}

function isStale(meta, maxAgeMs) {
	if (!meta?.createdAt) return false;
	const age = Date.now() - Date.parse(meta.createdAt);
	return Number.isFinite(age) && age > maxAgeMs;
}

export function acquireRunLock(root, options = {}) {
	const name = options.name || 'workflow';
	const envKey = options.envKey || 'EASYEDA_GSD_LOCK_TOKEN';
	const maxAgeMs = Number(options.maxAgeMs || process.env.EASYEDA_GSD_LOCK_MAX_AGE_MS || DEFAULT_MAX_AGE_MS);
	const path = lockDir(root, name);
	const inheritedToken = process.env[envKey];
	if (inheritedToken) {
		return { path, token: inheritedToken, owned: false, release() {} };
	}

	const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const meta = {
		token,
		pid: process.pid,
		command: [basename(process.execPath), ...process.argv.slice(1)].join(' '),
		createdAt: new Date().toISOString(),
	};

	try {
		mkdirSync(path);
		writeFileSync(`${path}/owner.json`, JSON.stringify(meta, null, 2), 'utf8');
		process.env[envKey] = token;
		return {
			path,
			token,
			owned: true,
			release() {
				if (process.env[envKey] === token) delete process.env[envKey];
				const current = readLock(path);
				if (current?.token === token) rmSync(path, { recursive: true, force: true });
			},
		};
	} catch (e) {
		if (e?.code === 'EEXIST') {
			const current = readLock(path);
			if (isStale(current, maxAgeMs)) {
				rmSync(path, { recursive: true, force: true });
				return acquireRunLock(root, options);
			}
			const detail = current ? ` pid=${current.pid} command="${current.command}" createdAt=${current.createdAt}` : '';
			throw new Error(`stateful EasyEDA harness command is already running (${path}).${detail}`);
		}
		throw e;
	}
}

