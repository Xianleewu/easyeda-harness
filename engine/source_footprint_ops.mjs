// Generic source primitive for a verified footprint-only replacement.  The
// caller owns all circuit-specific refs and UUIDs; this module only enforces
// identity preservation and emits the catalog-audit contract.

function attrsByComponent(records) {
	const out = new Map();
	for (const record of records || []) if (record?.head?.type === 'ATTR' && record.atom?.parentId) {
		if (!out.has(record.atom.parentId)) out.set(record.atom.parentId, new Map());
		out.get(record.atom.parentId).set(record.atom.key, record);
	}
	return out;
}

export function rebindSourceFootprints(records, edit, replacements, { source = 'verified footprint-only replacement' } = {}) {
	if (!(edit instanceof Map)) throw new Error('Footprint rebind requires the transaction edit Map');
	if (!Array.isArray(replacements) || !replacements.length) throw new Error('Footprint rebind requires replacements');
	const attrs = attrsByComponent(records);
	const byRef = new Map();
	for (const [componentId, own] of attrs) {
		const ref = String(own.get('Designator')?.atom?.value || '').trim();
		if (ref) byRef.set(ref, { componentId, own });
	}
	const repairs = {}, rows = [];
	for (const item of replacements) {
		const ref = String(item?.ref || '').trim(), before = item?.beforeUuid ?? null, current = String(item?.afterUuid || '').trim();
		if (!ref || !current) throw new Error('Each footprint replacement needs ref and afterUuid');
		const placed = byRef.get(ref);
		if (!placed) throw new Error(`Footprint replacement component missing: ${ref}`);
		const attr = placed.own.get('Footprint');
		if (!attr) throw new Error(`Footprint attribute missing: ${ref}`);
		if ((attr.atom.value ?? null) !== before) throw new Error(`Footprint baseline changed for ${ref}`);
		edit.set(attr.head.id, { ...attr.atom, value: current });
		repairs[ref] = { verified: true, source: String(item.source || source), changes: { Footprint: { before, current } } };
		rows.push({ ref, componentId: placed.componentId, footprintAttrId: attr.head.id, before, current });
	}
	return { repairs, rows };
}
