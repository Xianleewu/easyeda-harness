/* Per-placement supplier/device binding audit for footprint-only exceptions. */

const IDENTITY_KEYS = Object.freeze([
  'deviceUuid', 'symbolUuid', 'supplier', 'supplierId', 'manufacturer', 'manufacturerId',
]);
const REQUIRED_IDENTITY_KEYS = new Set(['deviceUuid', 'symbolUuid', 'supplier', 'supplierId', 'manufacturerId']);

function value(part, key) {
  if (part?.[key] != null) return String(part[key]);
  const aliases = {
    deviceUuid: ['Device'], symbolUuid: ['Symbol'], footprintUuid: ['Footprint'],
    supplier: ['Supplier'], supplierId: ['Supplier Part'], manufacturer: ['Manufacturer'],
    manufacturerId: ['Manufacturer Part'],
  };
  const attrs = part?.attrs instanceof Map
    ? part.attrs
    : new Map((part?.attrs || []).map(a => [a.key, a.value]));
  for (const alias of aliases[key] || []) if (attrs.has(alias)) return String(attrs.get(alias) ?? '');
  return '';
}

function tableGet(table, ref) {
  return table instanceof Map ? table.get(ref) : table?.[ref];
}

export function auditSupplierBindings(beforeParts, currentParts, {
  footprintOverridesByRef = {}, requireSupplierIdentity = true,
} = {}) {
  const before = new Map((beforeParts || []).map(p => [String(p.ref || p.designator || ''), p]));
  const current = new Map((currentParts || []).map(p => [String(p.ref || p.designator || ''), p]));
  const allRefs = [...new Set([...before.keys(), ...current.keys()])].filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = [];

  for (const ref of allRefs) {
    const prior = before.get(ref), placed = current.get(ref);
    const deviations = [];
    if (!prior) deviations.push({ kind: 'baseline-placement-missing' });
    if (!placed) deviations.push({ kind: 'current-placement-missing' });
    if (!prior || !placed) {
      rows.push({ ref, conform: false, deviations });
      continue;
    }

    const identity = {};
    for (const key of IDENTITY_KEYS) {
      const oldValue = value(prior, key), newValue = value(placed, key);
      identity[key] = newValue;
      if (oldValue !== newValue) deviations.push({ kind: 'identity-changed', key, before: oldValue, current: newValue });
      if (!newValue && (['deviceUuid', 'symbolUuid'].includes(key) ||
          (requireSupplierIdentity && REQUIRED_IDENTITY_KEYS.has(key)))) {
        deviations.push({ kind: 'identity-missing', key });
      }
    }

    const beforeFootprint = value(prior, 'footprintUuid');
    const currentFootprint = value(placed, 'footprintUuid');
    let footprintDisposition = 'catalog-binding-preserved';
    let footprintEvidence = null;
    if (!beforeFootprint || !currentFootprint) deviations.push({ kind: 'footprint-missing', before: beforeFootprint, current: currentFootprint });
    else if (beforeFootprint !== currentFootprint) {
      footprintDisposition = 'directed-override';
      footprintEvidence = tableGet(footprintOverridesByRef, ref) || null;
      if (!footprintEvidence) deviations.push({ kind: 'footprint-override-evidence-missing', before: beforeFootprint, current: currentFootprint });
      else {
        if (String(footprintEvidence.beforeFootprint || '') !== beforeFootprint ||
            String(footprintEvidence.currentFootprint || '') !== currentFootprint) {
          deviations.push({ kind: 'footprint-override-pair-mismatch', before: beforeFootprint, current: currentFootprint });
        }
        if (footprintEvidence.conform !== true) deviations.push({ kind: 'footprint-override-not-conform' });
      }
    }

    rows.push({
      ref, conform: deviations.length === 0, deviations, identity,
      beforeFootprint, currentFootprint, footprintDisposition, footprintEvidence,
    });
  }

  return {
    conform: rows.length > 0 && rows.every(r => r.conform),
    detail: {
      checked: rows.length,
      passed: rows.filter(r => r.conform).length,
      directedOverrides: rows.filter(r => r.footprintDisposition === 'directed-override').length,
    },
    rows,
  };
}
