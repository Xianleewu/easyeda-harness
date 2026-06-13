export const ACTION_SCHEMA_VERSION = 1;
export const VALID_CHECK_STATUS = new Set(['pass', 'fail', 'missing', 'available']);

export function actionId(index) {
	return `act_${String(index + 1).padStart(3, '0')}`;
}

export function sourceFromObserved(observed, fallback = 'unknown') {
	return observed?.rule || observed?.gate || observed?.area || fallback;
}

export function titleFromAction(action) {
	return action.title || action.action || action.repairHint || action.area || 'repair action';
}

export function targetFromAction(action) {
	if (action.target) return action.target;
	if (action.area) return { kind: 'area', id: action.area };
	return { kind: 'workflow', id: 'unknown' };
}

export function normalizeAction(action, index) {
	const evidence = Array.isArray(action.evidence) ? action.evidence : [];
	const observed = action.observed || {};
	return {
		...action,
		id: action.id || actionId(index),
		priority: action.priority ?? index + 1,
		severity: action.severity || observed.severity || 'hard',
		source: action.source || sourceFromObserved(observed, action.area || 'unknown'),
		title: titleFromAction(action),
		target: targetFromAction(action),
		evidence,
		suggestedFix: action.suggestedFix || {
			kind: action.nextCommand ? 'rerun-command' : 'manual-edit',
			command: action.nextCommand || null,
			files: action.editFiles || evidence,
		},
	};
}

export function normalizeChecks(checks) {
	const out = {};
	for (const [key, value] of Object.entries(checks || {})) {
		out[key] = {
			...value,
			status: VALID_CHECK_STATUS.has(value?.status) ? value.status : 'missing',
			evidence: value?.evidence || null,
		};
	}
	return out;
}

export function normalizeNextActions(result) {
	const actions = (result.actions || []).map(normalizeAction);
	return {
		schemaVersion: ACTION_SCHEMA_VERSION,
		generatedAt: result.generatedAt,
		pass: actions.length === 0,
		mode: result.mode || result.checks?.acceptance?.mode || 'local-only',
		checks: normalizeChecks(result.checks || {}),
		actions,
	};
}

export function validateNextActions(result) {
	const findings = [];
	function hard(rule, msg, where = {}) {
		findings.push({ rule, severity: 'hard', category: 'action-schema', msg, where });
	}
	if (!result || typeof result !== 'object') {
		hard('AS1-object', 'next_actions.json must be a JSON object');
		return findings;
	}
	if (result.schemaVersion !== ACTION_SCHEMA_VERSION) hard('AS2-schema-version', 'next_actions.json schemaVersion must be 1', { schemaVersion: result.schemaVersion });
	if (typeof result.generatedAt !== 'string') hard('AS3-generated-at', 'next_actions.json needs generatedAt');
	if (typeof result.pass !== 'boolean') hard('AS4-pass-bool', 'next_actions.json pass must be boolean', { pass: result.pass });
	if (!result.mode || typeof result.mode !== 'string') hard('AS5-mode', 'next_actions.json needs mode');
	if (!result.checks || typeof result.checks !== 'object') hard('AS6-checks', 'next_actions.json checks must be an object');
	for (const [key, check] of Object.entries(result.checks || {})) {
		if (!VALID_CHECK_STATUS.has(check?.status)) hard('AS7-check-status', `${key} check has invalid status`, { key, status: check?.status });
		if (!('evidence' in (check || {}))) hard('AS8-check-evidence', `${key} check must include evidence`, { key });
	}
	if (!Array.isArray(result.actions)) hard('AS9-actions-array', 'next_actions.json actions must be an array');
	const ids = new Set();
	for (const [index, action] of (result.actions || []).entries()) {
		if (!action.id) hard('AS10-action-id', 'action needs id', { index });
		else if (ids.has(action.id)) hard('AS11-action-id-unique', `duplicate action id: ${action.id}`, { id: action.id });
		else ids.add(action.id);
		for (const key of ['severity', 'source', 'title', 'target']) {
			if (action[key] === undefined || action[key] === null || action[key] === '') hard('AS12-action-required-field', `action ${action.id || index} needs ${key}`, { action: action.id || index, key });
		}
		if (!Array.isArray(action.evidence)) hard('AS13-action-evidence-array', `action ${action.id || index} evidence must be an array`, { action: action.id || index });
		if (action.evidence?.length === 0) hard('AS14-action-evidence-present', `action ${action.id || index} must reference evidence files`, { action: action.id || index });
	}
	if (result.pass !== ((result.actions || []).length === 0)) {
		hard('AS15-pass-actions-consistent', 'pass must be true only when actions is empty', { pass: result.pass, actionCount: (result.actions || []).length });
	}
	return findings;
}
