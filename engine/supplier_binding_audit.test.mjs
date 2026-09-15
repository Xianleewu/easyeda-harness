import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSupplierBindings } from './supplier_binding_audit.mjs';

const part = (ref, footprintUuid = 'fp-catalog') => ({
  ref, deviceUuid: 'dev', symbolUuid: 'sym', footprintUuid,
  supplier: 'supplier', supplierId: 'supplier-part', manufacturer: 'maker', manufacturerId: 'mpn',
});

test('passes an unchanged complete catalog binding per placement', () => {
  const report = auditSupplierBindings([part('R1')], [part('R1')]);
  assert.equal(report.conform, true);
  assert.equal(report.rows[0].footprintDisposition, 'catalog-binding-preserved');
});

test('accepts only an exact evidence-backed directed footprint override', () => {
  const report = auditSupplierBindings([part('C1')], [part('C1', 'fp-small')], {
    footprintOverridesByRef: { C1: {
      beforeFootprint: 'fp-catalog', currentFootprint: 'fp-small', conform: true,
    } },
  });
  assert.equal(report.conform, true);
  assert.equal(report.detail.directedOverrides, 1);
});

test('fails closed when override evidence is missing or names the wrong UUID pair', () => {
  const missing = auditSupplierBindings([part('R1')], [part('R1', 'fp-small')]);
  assert.equal(missing.conform, false);
  assert.equal(missing.rows[0].deviations[0].kind, 'footprint-override-evidence-missing');
  const wrong = auditSupplierBindings([part('R1')], [part('R1', 'fp-small')], {
    footprintOverridesByRef: { R1: { beforeFootprint: 'other', currentFootprint: 'fp-small', conform: true } },
  });
  assert.equal(wrong.conform, false);
  assert.ok(wrong.rows[0].deviations.some(d => d.kind === 'footprint-override-pair-mismatch'));
});

test('fails when supplier identity or symbol/device identity changes', () => {
  const changed = { ...part('U1'), supplierId: 'different', symbolUuid: 'different-symbol' };
  const report = auditSupplierBindings([part('U1')], [changed]);
  assert.equal(report.conform, false);
  assert.deepEqual(report.rows[0].deviations.filter(d => d.kind === 'identity-changed').map(d => d.key), ['symbolUuid', 'supplierId']);
});

test('allows a catalog record with no manufacturer display name when its MPN is present', () => {
  const before = { ...part('D1'), manufacturer: '' };
  const report = auditSupplierBindings([before], [{ ...before }]);
  assert.equal(report.conform, true);
});

test('fails missing placement coverage through the ref union', () => {
  const report = auditSupplierBindings([part('R1'), part('R2')], [part('R1'), part('R3')]);
  assert.equal(report.conform, false);
  assert.equal(report.detail.checked, 3);
  assert.ok(report.rows.find(r => r.ref === 'R2').deviations.some(d => d.kind === 'current-placement-missing'));
  assert.ok(report.rows.find(r => r.ref === 'R3').deviations.some(d => d.kind === 'baseline-placement-missing'));
});
