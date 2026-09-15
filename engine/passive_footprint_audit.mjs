/*
 * Mechanical audit for small two-terminal resistor/capacitor footprints.
 *
 * The footprint name is deliberately ignored.  EasyEDA libraries commonly contain
 * visually different footprints with the same R0603/C0603 title, so acceptance is
 * based on the exported footprint source: pad count/type, copper envelope and actual
 * top-silkscreen geometry.  Results stay per placed component even when several
 * components share one device or footprint.
 */

const DEFAULT_POLICY = Object.freeze({
	padCount: 2,
	maxCopperLongMil: 110,
	maxCopperShortMil: 60,
	silkEnvelopeToleranceMil: 0.5,
});

function attrMap(component) {
	return new Map((component?.attrs || []).map(a => [a.key, a.value]));
}

export function passiveKind(component) {
	const d = String(component?.designator || attrMap(component).get('Designator') || '').trim();
	if (/^R\d+[A-Z]?$/i.test(d)) return 'resistor';
	if (/^C\d+[A-Z]?$/i.test(d)) return 'capacitor';
	return null;
}

export function parseEasyEdaRecords(source) {
	if (Array.isArray(source)) return source;
	const records = [];
	for (const raw of String(source || '').split('\n')) {
		const sep = raw.indexOf('||');
		if (sep < 0) continue;
		try {
			const head = JSON.parse(raw.slice(0, sep));
			const atom = JSON.parse(raw.slice(sep + 2).replace(/\|$/, ''));
			records.push({ head, atom });
		} catch {
			// A malformed source is reported by analyzeFootprintSource; do not
			// manufacture partial geometry from an unreadable record.
		}
	}
	return records;
}

/**
 * Convert a downloaded EasyEDA library bundle into the document body accepted by
 * LIB_Footprint.updateDocumentSource().  An .elibu export can contain catalogue
 * headers before the actual editable footprint.  The editor API expects only the
 * final drawing document and identifies that document as PCB.
 */
export function editableFootprintDocumentSource(source, { uuid = '' } = {}) {
	const records = parseEasyEdaRecords(source);
	const starts = records.map((record, index) => record?.head?.type === 'DOCHEAD' ? index : -1).filter(index => index >= 0);
	if (!starts.length) throw new Error('Footprint source has no document header');
	const body = records.slice(starts.at(-1)).map(record => ({ head: { ...record.head }, atom: { ...record.atom } }));
	const head = body[0];
	head.atom.docType = 'PCB';
	if (uuid) head.atom.uuid = uuid;
	const output = body.map(record => `${JSON.stringify(record.head)}||${JSON.stringify(record.atom)}|`).join('\n') + '\n';
	const audit = analyzeFootprintSource(output, { maxCopperLongMil: Infinity, maxCopperShortMil: Infinity });
	if (audit.detail.pads !== 2 || !audit.detail.copperBox)
		throw new Error('Editable footprint document lost its two-pad geometry');
	return output;
}

const FOOTPRINT_GEOMETRY_TYPES = new Set(['PAD', 'VIA', 'LINE', 'POLY', 'FILL', 'ARC', 'CIRCLE', 'RECT', 'REGION', 'STRING']);

/**
 * Retain the target library object's live editor header/settings and replace only
 * its drawing primitives with audited donor geometry.  This avoids copying stale
 * version/client identity from a downloaded library export.
 */
export function transplantFootprintGeometry(templateSource, donorSource, { uuid = '', title = '', policy = {} } = {}) {
	const template = parseEasyEdaRecords(templateSource);
	const donor = parseEasyEdaRecords(donorSource);
	if (!template.length || template[0]?.head?.type !== 'DOCHEAD') throw new Error('Target footprint template has no document header');
	const geometry = donor.filter(record => FOOTPRINT_GEOMETRY_TYPES.has(record?.head?.type));
	if (!geometry.length) throw new Error('Donor footprint has no drawing geometry');
	const kept = template.filter(record => !FOOTPRINT_GEOMETRY_TYPES.has(record?.head?.type) && record?.head?.type !== 'ELE_PLACEHOLDER')
		.map(record => ({ head: { ...record.head }, atom: { ...record.atom } }));
	kept[0].atom.docType = 'PCB';
	if (uuid) kept[0].atom.uuid = uuid;
	if (title) for (const record of kept) if (record?.head?.type === 'ATTR' && record?.atom?.key === 'Footprint') record.atom.value = title;
	let ticket = Math.max(0, ...kept.map(record => Number(record?.head?.ticket) || 0));
	const copied = geometry.map(record => ({ head: { ...record.head, ticket: ++ticket }, atom: { ...record.atom } }));
	const output = [...kept, ...copied].map(record => `${JSON.stringify(record.head)}||${JSON.stringify(record.atom)}|`).join('\n') + '\n';
	const audit = analyzeFootprintSource(output, policy);
	if (!audit.conform) throw new Error(`Transplanted footprint fails audit: ${JSON.stringify(audit.deviations)}`);
	return { source: output, audit };
}

function padBox(pad) {
	const shape = pad?.defaultPad;
	if (!shape || !Number.isFinite(shape.width) || !Number.isFinite(shape.height)) return null;
	const cx = Number(pad.centerX), cy = Number(pad.centerY);
	if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
	const angle = ((Number(pad.padAngle) || 0) + (Number(pad.relativeAngle) || 0)) % 180;
	const quarterTurn = Math.abs(angle) > 45 && Math.abs(angle) < 135;
	const w = quarterTurn ? shape.height : shape.width;
	const h = quarterTurn ? shape.width : shape.height;
	return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

function silkBox(atom) {
	const xs = [], ys = [];
	const point = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
	const walk = path => {
		if (!Array.isArray(path)) return;
		if (path[0] === 'CIRCLE') {
			const [, x, y, radius] = path;
			if ([x, y, radius].every(Number.isFinite)) { xs.push(x - radius, x + radius); ys.push(y - radius, y + radius); }
			return;
		}
		if (Array.isArray(path[0])) { for (const sub of path) walk(sub); return; }
		point(path[0], path[1]);
		for (let i = 2; i < path.length;) {
			const op = path[i++];
			if (op === 'ARC') i++;
			if (op === 'L' || op === 'ARC') { point(path[i], path[i + 1]); i += 2; }
			else if (Number.isFinite(op) && Number.isFinite(path[i])) { point(op, path[i]); i++; }
		}
	};
	walk(atom?.path);
	if (!xs.length) return null;
	const half = Math.max(0, Number(atom.width) || 0) / 2;
	return {
		minX: Math.min(...xs) - half, minY: Math.min(...ys) - half,
		maxX: Math.max(...xs) + half, maxY: Math.max(...ys) + half,
	};
}

function union(boxes) {
	if (!boxes.length) return null;
	return boxes.reduce((a, b) => ({
		minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
	}));
}

function outside(inner, outer, tolerance) {
	return inner.minX < outer.minX - tolerance || inner.minY < outer.minY - tolerance ||
		inner.maxX > outer.maxX + tolerance || inner.maxY > outer.maxY + tolerance;
}

export function analyzeFootprintSource(source, policy = {}) {
	const p = { ...DEFAULT_POLICY, ...policy };
	const records = parseEasyEdaRecords(source);
	const pads = records.filter(r => r?.head?.type === 'PAD').map(r => r.atom);
	const padBoxes = pads.map(padBox).filter(Boolean);
	const copper = union(padBoxes);
	const silk = records
		.filter(r => r?.atom?.layerId === 3 && ['POLY', 'LINE', 'FILL'].includes(r?.head?.type))
		.map(r => ({ type: r.head.type, box: silkBox(r.atom) })).filter(x => x.box);
	const deviations = [];
	if (!records.length) deviations.push({ kind: 'footprint-source-missing-or-unreadable' });
	if (pads.length !== p.padCount) deviations.push({ kind: 'pad-count', actual: pads.length, expected: p.padCount });
	if (pads.some(x => x.hole != null || x.layerId !== 1)) deviations.push({ kind: 'not-two-terminal-smd' });
	if (!copper) deviations.push({ kind: 'pad-geometry-missing' });
	let copperLongMil = null, copperShortMil = null;
	if (copper) {
		const spans = [copper.maxX - copper.minX, copper.maxY - copper.minY].sort((a, b) => b - a);
		[copperLongMil, copperShortMil] = spans;
		if (copperLongMil > p.maxCopperLongMil || copperShortMil > p.maxCopperShortMil) {
			deviations.push({ kind: 'copper-envelope-too-large', copperLongMil, copperShortMil,
				maxCopperLongMil: p.maxCopperLongMil, maxCopperShortMil: p.maxCopperShortMil });
		}
		for (const [index, item] of silk.entries()) if (outside(item.box, copper, p.silkEnvelopeToleranceMil)) {
			deviations.push({ kind: 'outer-top-silkscreen', index, primitive: item.type, box: item.box });
		}
	}
	return {
		conform: deviations.length === 0,
		deviations,
		detail: { records: records.length, pads: pads.length, topSilkPrimitives: silk.length,
			copperLongMil, copperShortMil, copperBox: copper, policy: p },
	};
}

export function sanitizePassiveFootprintSource(source, { uuid = '', title = '', policy = {} } = {}) {
	const records = parseEasyEdaRecords(source);
	if (!records.length) throw new Error('Cannot sanitize an empty or unreadable footprint source');
	const before = analyzeFootprintSource(records, policy);
	if (before.detail.pads !== 2 || !before.detail.copperBox)
		throw new Error('Passive footprint sanitization requires exactly two readable SMD pads');
	const outer = new Set(before.deviations.filter(d => d.kind === 'outer-top-silkscreen').map(d => d.index));
	let silkIndex = 0;
	const kept = records.filter(record => {
		const isSilk = record?.atom?.layerId === 3 && ['POLY', 'LINE', 'FILL'].includes(record?.head?.type);
		if (!isSilk) return true;
		const remove = outer.has(silkIndex++);
		return !remove;
	}).map(record => ({ head: { ...record.head }, atom: { ...record.atom } }));
	for (const record of kept) {
		if (uuid && record.head.type === 'DOCHEAD') record.atom.uuid = uuid;
		if (title && record.head.type === 'META') record.atom.title = title;
	}
	const output = kept.map(record => `${JSON.stringify(record.head)}||${JSON.stringify(record.atom)}|`).join('\n') + '\n';
	const after = analyzeFootprintSource(output, policy);
	if (!after.conform) throw new Error(`Sanitized passive footprint still fails: ${JSON.stringify(after.deviations)}`);
	const hasDocumentHeader = kept.some(record => record?.head?.type === 'DOCHEAD');
	return { source: output, editableSource: hasDocumentHeader ? editableFootprintDocumentSource(output, { uuid }) : null,
		removedTopSilk: outer.size, before, after };
}

function evidenceFor(table, ref, footprintUuid) {
	if (!table) return undefined;
	if (table instanceof Map) return table.get(ref) ?? table.get(footprintUuid);
	return table[ref] ?? table[footprintUuid];
}

export function auditPassiveFootprints(components, {
	resolvedByRef = {}, sourcesByFootprint = {}, electricalByRef = {}, policy = {}, policyByRef = {},
} = {}) {
	const rows = [];
	for (const component of components || []) {
		const kind = passiveKind(component);
		if (!kind) continue;
		const attrs = attrMap(component);
		const ref = component.designator || attrs.get('Designator');
		const resolved = evidenceFor(resolvedByRef, ref) || {};
		const footprintUuid = resolved.footprintUuid || resolved.uuid || attrs.get('Footprint') || '';
		const source = resolved.source || evidenceFor(sourcesByFootprint, ref, footprintUuid);
		const electrical = evidenceFor(electricalByRef, ref) || null;
		const itemPolicy = evidenceFor(policyByRef, ref, footprintUuid) || electrical?.footprintPolicy || {};
		const footprint = analyzeFootprintSource(source, { ...policy, ...itemPolicy });
		const electricalStatus = String(electrical?.status || '').toUpperCase();
		const electricalConform = electricalStatus === 'PASS';
		rows.push({
			ref, kind, value: component.value || attrs.get('Value') || '', footprintUuid,
			footprintConform: footprint.conform, electricalConform,
			conform: footprint.conform && electricalConform,
			footprint, electrical: electrical || { status: 'MISSING', note: 'Per-item electrical evidence is required.' },
		});
	}
	return {
		conform: rows.every(r => r.conform),
		footprintConform: rows.every(r => r.footprintConform),
		electricalConform: rows.every(r => r.electricalConform),
		detail: { checked: rows.length, footprintPass: rows.filter(r => r.footprintConform).length,
			electricalPass: rows.filter(r => r.electricalConform).length },
		rows,
	};
}
