import { existsSync, readFileSync } from 'node:fs';

export const REPAIR_LOOP_SCHEMA_VERSION = 1;

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function uniq(items) {
	return [...new Set(items.filter(Boolean))];
}

export function readJsonIfExists(root, file) {
	const path = `${root.replace(/\\/g, '/')}/${file}`;
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
	} catch (e) {
		return { parseError: e.message, file };
	}
}

function fixKind(action) {
	return action.suggestedFix?.kind || action.fixKind || (action.nextCommand ? 'manual-edit-rerun' : 'manual-edit');
}

function actionSource(action) {
	return action.source || action.rule || action.observed?.rule || action.gate || action.area || 'unknown';
}

function normalizeRepairAction(action, index, sourceFile) {
	const evidence = uniq([
		...asArray(action.evidence),
		...asArray(action.inspectFiles),
		sourceFile,
	]);
	return {
		id: action.id || `repair_${String(index + 1).padStart(3, '0')}`,
		priority: action.priority ?? index + 1,
		area: action.area || action.target?.id || 'unknown',
		source: actionSource(action),
		title: action.title || action.message || action.action || action.repairHint || 'repair action',
		fixKind: fixKind(action),
		editFiles: uniq(asArray(action.editFiles).concat(asArray(action.suggestedFix?.files))),
		inspectFiles: uniq(asArray(action.inspectFiles).concat(evidence)),
		evidence,
		nextCommand: action.nextCommand || action.suggestedFix?.command || null,
		observed: action.observed || {
			gate: action.gate || null,
			rule: action.rule || action.source || null,
			message: action.message || action.title || action.action || null,
			where: action.where || null,
		},
	};
}

function collectActions(repairActions, nextActions) {
	const repair = asArray(repairActions?.actions).map((action, index) => normalizeRepairAction(action, index, 'repair_actions.json'));
	const next = asArray(nextActions?.actions).map((action, index) => normalizeRepairAction(action, index, 'next_actions.json'));
	const byKey = new Map();
	for (const action of [...repair, ...next]) {
		const key = `${action.area}:${action.source}:${action.title}`;
		if (!byKey.has(key)) {
			byKey.set(key, action);
			continue;
		}
		const existing = byKey.get(key);
		byKey.set(key, {
			...existing,
			editFiles: uniq([...existing.editFiles, ...action.editFiles]),
			inspectFiles: uniq([...existing.inspectFiles, ...action.inspectFiles]),
			evidence: uniq([...existing.evidence, ...action.evidence]),
			nextCommand: existing.nextCommand || action.nextCommand,
		});
	}
	return [...byKey.values()].sort((a, b) => a.priority - b.priority || a.area.localeCompare(b.area));
}

function groupActions(actions) {
	const groups = new Map();
	for (const action of actions) {
		const key = action.fixKind;
		if (!groups.has(key)) {
			groups.set(key, {
				fixKind: key,
				count: 0,
				areas: [],
				editFiles: [],
				inspectFiles: [],
				evidence: [],
				nextCommands: [],
				actions: [],
			});
		}
		const group = groups.get(key);
		group.count += 1;
		group.areas = uniq([...group.areas, action.area]);
		group.editFiles = uniq([...group.editFiles, ...action.editFiles]);
		group.inspectFiles = uniq([...group.inspectFiles, ...action.inspectFiles]);
		group.evidence = uniq([...group.evidence, ...action.evidence]);
		group.nextCommands = uniq([...group.nextCommands, action.nextCommand]);
		group.actions.push({
			id: action.id,
			area: action.area,
			source: action.source,
			title: action.title,
			editFiles: action.editFiles,
			inspectFiles: action.inspectFiles,
			nextCommand: action.nextCommand,
		});
	}
	return [...groups.values()].sort((a, b) => b.count - a.count || a.fixKind.localeCompare(b.fixKind));
}

export function buildRepairLoopPlan({ repairActions = null, nextActions = null, maxIterations = 1, write = false } = {}) {
	const actions = collectActions(repairActions, nextActions);
	const pass = actions.length === 0;
	const nextCommand = actions.find(action => action.nextCommand)?.nextCommand || 'node bin/easyeda-gsd.mjs accept project_spec.json';
	return {
		schemaVersion: REPAIR_LOOP_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		mode: write ? 'write-requested-unsupported' : 'read-only',
		pass,
		writeRequested: write,
		automaticWriteSupported: false,
		maxIterations,
		actionCount: actions.length,
		groups: groupActions(actions),
		actions,
		nextStep: pass
			? 'no repair actions open'
			: `edit the listed contracts, deterministic sources, or rules; then run ${nextCommand}`,
	};
}

export function loadRepairLoopPlan(root, options = {}) {
	const repairActions = readJsonIfExists(root, 'repair_actions.json');
	const nextActions = readJsonIfExists(root, 'next_actions.json');
	return buildRepairLoopPlan({
		repairActions,
		nextActions,
		maxIterations: options.maxIterations ?? 1,
		write: options.write === true,
	});
}
