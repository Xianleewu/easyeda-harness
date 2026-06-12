import { REPEATED_GROUPS } from '../module_registry.mjs';
import { CONFIG } from '../config.mjs';

const BINDING_KEYS = ['Symbol', 'Device', 'Footprint'];

function attrsByKey(part) {
	return new Map((part.attrs || []).map(a => [String(a.key || ''), a]));
}

function bindingValue(part, key) {
	const attr = attrsByKey(part).get(key);
	return attr ? (attr.value ?? null) : null;
}

function hasLiveLibraryAttrs(part) {
	return (part.attrs || []).some(a => BINDING_KEYS.includes(String(a.key || '')));
}

function approvedNames(expected) {
	return new Set((expected.names || []).map(v => String(v || '').trim()).filter(Boolean));
}

export function c13LibraryBinding(m) {
	const F = [];
	const byRef = new Map((m.parts || []).map(p => [p.designator, p]));
	for (const [ref, expected] of Object.entries(CONFIG.libraryBinding?.expectedByRef || {})) {
		const part = byRef.get(ref);
		if (!part) continue;
		const allowedNames = approvedNames(expected);
		const observedNames = [
			part.name,
			part.value,
			bindingValue(part, 'Name'),
			bindingValue(part, 'Value'),
		].map(v => String(v || '').trim()).filter(Boolean);
		for (const value of observedNames) {
			if (allowedNames.size && !allowedNames.has(value)) {
				F.push({
					rule: 'C13.3-approved-library-name',
					severity: 'hard',
					category: 'state',
					msg: `${ref} name/value must match approved library device`,
					where: { designator: ref, expected: [...allowedNames], actual: value },
				});
			}
		}
		if (!hasLiveLibraryAttrs(part)) continue;
		for (const key of BINDING_KEYS) {
			const actual = bindingValue(part, key);
			const want = expected[key];
			if (want == null) continue;
			if (actual == null || actual === '') {
				F.push({
					rule: 'C13.4-missing-library-binding',
					severity: 'hard',
					category: 'state',
					msg: `${ref} ${key} binding is missing from live library component`,
					where: { designator: ref, key, expected: want, actual },
				});
				continue;
			}
			if (actual === want) continue;
			F.push({
				rule: 'C13.2-known-library-binding',
				severity: 'hard',
				category: 'state',
				msg: `${ref} ${key} binding must match approved library device`,
				where: { designator: ref, key, expected: want, actual },
			});
		}
	}
	for (const group of REPEATED_GROUPS) {
		for (const [leftRef, rightRef] of group.roleMap || []) {
			const left = byRef.get(leftRef);
			const right = byRef.get(rightRef);
			if (!left || !right) continue;
			if (left.value !== right.value || left.name !== right.name) continue;
			for (const key of BINDING_KEYS) {
				const leftValue = bindingValue(left, key);
				const rightValue = bindingValue(right, key);
				if (leftValue !== rightValue) {
					F.push({
						rule: 'C13.1-repeated-binding-drift',
						severity: 'hard',
						category: 'state',
						msg: `${rightRef} ${key} binding differs from ${leftRef}`,
						where: { group: group.name, leftRef, rightRef, key, leftValue, rightValue },
					});
				}
			}
		}
	}
	return F;
}
