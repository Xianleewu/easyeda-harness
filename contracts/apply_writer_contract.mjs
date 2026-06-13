import { existsSync } from 'node:fs';
import { isBundledAihwdebuggerRegistry } from '../engine/project_mode.mjs';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'apply-writer', msg, where });
}

export function resolveApplyWriter({ assembly, pack, root }) {
	const findings = [];
	const bundled = isBundledAihwdebuggerRegistry(assembly);
	const writer = pack?.writer || null;
	if (bundled) {
		return {
			pass: true,
			mode: 'bundled-aihwdebugger',
			writer: {
				id: 'aihwdebugger-low-level-writer',
				generate: 'engine/apply_full.mjs',
				run: 'engine/apply_run.mjs',
			},
			severity: { hard: 0, soft: 0, info: 0 },
			findings,
		};
	}
	if (!writer || typeof writer !== 'object') {
		hard(findings, 'AW1-pack-writer-declared', 'external circuit packs must declare an apply writer before apply:gated can write to EasyEDA', {
			circuitPack: pack?.id || assembly?.circuitPack || null,
		});
	} else {
		if (!writer.id) hard(findings, 'AW2-writer-id', 'pack writer must have a stable id', { writer });
		if (!writer.generate || typeof writer.generate !== 'string') hard(findings, 'AW3-writer-generate-entrypoint', 'pack writer must declare a generate entrypoint', { writer });
		if (!writer.run || typeof writer.run !== 'string') hard(findings, 'AW4-writer-run-entrypoint', 'pack writer must declare a run entrypoint', { writer });
		for (const [key, rel] of Object.entries({ generate: writer.generate, run: writer.run })) {
			if (rel && typeof rel === 'string' && !existsSync(`${root.replace(/\\/g, '/')}/${rel}`)) {
				hard(findings, 'AW5-writer-entrypoint-exists', 'pack writer entrypoint must exist before apply:gated can write', {
					circuitPack: pack?.id || null,
					key,
					rel,
				});
			}
		}
	}
	return {
		pass: findings.length === 0,
		mode: 'external-pack-writer',
		writer,
		severity: { hard: findings.length, soft: 0, info: 0 },
		findings,
	};
}
