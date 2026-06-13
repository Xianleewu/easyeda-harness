import { asArray, REQUIRED_DRAWING_RULES } from './module_contract.mjs';

export const DRAWING_RULE_BINDINGS = {
	'orthogonal-wiring': ['C4', 'C6'],
	'real-net-labels': ['C5', 'C6'],
	'text-clearance': ['C5', 'C21'],
	'module-box-isolation': ['C2', 'C8', 'C9'],
	'no-fake-net-text': ['C5', 'C6'],
	'no-unnecessary-net-ports': ['C5', 'C6'],
};

export function validateDrawingRuleBindings({ drawingRules = REQUIRED_DRAWING_RULES, registeredRuleIds = [] } = {}) {
	const findings = [];
	const registered = new Set(asArray(registeredRuleIds));
	for (const rule of asArray(drawingRules)) {
		const bindings = asArray(DRAWING_RULE_BINDINGS[rule]);
		if (!bindings.length) {
			findings.push({
				rule: 'DR1-drawing-rule-known',
				severity: 'hard',
				category: 'drawing-rule',
				msg: `drawing rule ${rule} has no executable harness rule binding`,
				where: { drawingRule: rule, knownDrawingRules: Object.keys(DRAWING_RULE_BINDINGS) },
			});
			continue;
		}
		const missing = bindings.filter(id => !registered.has(id));
		if (missing.length) {
			findings.push({
				rule: 'DR2-drawing-rule-executable',
				severity: 'hard',
				category: 'drawing-rule',
				msg: `drawing rule ${rule} is declared but required executable harness rules are not registered`,
				where: { drawingRule: rule, bindings, missingRegisteredRules: missing },
			});
		}
	}
	return findings;
}
