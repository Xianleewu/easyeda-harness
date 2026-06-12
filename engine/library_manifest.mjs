import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BINDING_KEYS = ['Symbol', 'Device', 'Footprint'];

function attrsByKey(part) {
	return new Map((part.attrs || []).map(a => [String(a.key || a.name || ''), a]));
}

function attrValue(part, key) {
	const attr = attrsByKey(part).get(key);
	return attr ? (attr.value ?? '') : '';
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'library-manifest', msg, where });
}

function partMap(snapshot) {
	return new Map((snapshot?.components || []).map(part => [part.designator, part]));
}

export function buildLibraryManifest(snapshot, opts = {}) {
	const parts = {};
	for (const part of snapshot?.components || []) {
		const entry = {
			name: part.name || '',
			value: part.value || '',
			addIntoBom: part.addIntoBom === true,
			addIntoPcb: part.addIntoPcb === true,
		};
		for (const key of opts.bindingKeys || BINDING_KEYS) entry[key] = attrValue(part, key);
		parts[part.designator] = entry;
	}
	return {
		generatedFrom: opts.generatedFrom || 'snapshot',
		purpose: opts.purpose || 'Approved EasyEDA library bindings',
		bindingKeys: [...(opts.bindingKeys || BINDING_KEYS)],
		parts,
	};
}

export function auditLibraryManifest(snapshot, manifest, opts = {}) {
	const findings = [];
	const keys = manifest?.bindingKeys || BINDING_KEYS;
	const approved = manifest?.parts || {};
	const actualByRef = partMap(snapshot);
	let checkedParts = 0;
	let checkedBindings = 0;

	for (const [ref, want] of Object.entries(approved)) {
		const part = actualByRef.get(ref);
		if (!part) {
			hard(findings, 'LIB-MANIFEST-MISSING-PART', `${ref} is missing from live schematic`, { designator: ref });
			continue;
		}
		checkedParts++;
		for (const boolKey of ['addIntoBom', 'addIntoPcb']) {
			if (part[boolKey] !== want[boolKey]) {
				hard(findings, 'LIB-MANIFEST-BOM-PCB', `${ref} ${boolKey} must match approved commercial state`, {
					designator: ref,
					key: boolKey,
					expected: want[boolKey],
					actual: part[boolKey],
				});
			}
		}
		for (const textKey of opts.compareTextKeys || ['name', 'value']) {
			if ((part[textKey] || '') !== (want[textKey] || '')) {
				hard(findings, 'LIB-MANIFEST-NAME-VALUE', `${ref} ${textKey} must match approved library part`, {
					designator: ref,
					key: textKey,
					expected: want[textKey] || '',
					actual: part[textKey] || '',
				});
			}
		}
		for (const key of keys) {
			checkedBindings++;
			const actual = attrValue(part, key);
			const expected = want[key] || '';
			if (!actual) {
				hard(findings, 'LIB-MANIFEST-MISSING-BINDING', `${ref} ${key} binding is missing`, {
					designator: ref,
					key,
					expected,
					actual,
				});
				continue;
			}
			if (actual !== expected) {
				hard(findings, 'LIB-MANIFEST-BINDING', `${ref} ${key} binding must match approved library manifest`, {
					designator: ref,
					key,
					expected,
					actual,
				});
			}
		}
	}

	if (opts.failOnExtraParts !== false) {
		const approvedRefs = new Set(Object.keys(approved));
		for (const ref of actualByRef.keys()) {
			if (!approvedRefs.has(ref)) hard(findings, 'LIB-MANIFEST-EXTRA-PART', `${ref} is not in approved library manifest`, { designator: ref });
		}
	}

	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: {
			approvedParts: Object.keys(approved).length,
			actualParts: actualByRef.size,
			checkedParts,
			checkedBindings,
		},
		findings,
	};
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const [snapshotPath, manifestPath] = process.argv.slice(2);
	const result = auditLibraryManifest(readJson(snapshotPath), readJson(manifestPath));
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.pass ? 0 : 1);
}
