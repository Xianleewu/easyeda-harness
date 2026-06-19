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
			// run 用源式投递(apply_source_run.mjs:setDocumentSource 原子加载官方 full_model.json),
			// 替代旧 create 式 apply_run.mjs(逐条 create 受 EDA 合并丢线)。generate 仍产 full_model.json
			// (源适配器读它投递;旧 af_*.js 被忽略,无害)。源式=门验证的与实际写回的同一模型。
			writer: {
				id: 'aihwdebugger-source-writer',
				generate: 'engine/apply_full.mjs',
				run: 'engine/apply_source_run.mjs',
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
		if (writer.scaffoldOnly === true) {
			hard(findings, 'AW6-writer-scaffold-only', 'pack writer scaffold must be implemented before apply:gated can write to EasyEDA', {
				circuitPack: pack?.id || assembly?.circuitPack || null,
				writer,
			});
		}
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
