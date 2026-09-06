import { describe, it, expect } from 'vitest';
import {
  planMedicineMetadataUpdate,
  planBatchMetadataUpdate
} from '../inventory/metadataEdits';

describe('planMedicineMetadataUpdate', () => {
  it('plans valid price/threshold/supplier changes with from/to audit trail', () => {
    const r = planMedicineMetadataUpdate(
      { price: 100, minThreshold: 5, supplier: 'Old Co' },
      { price: '125.5', minThreshold: 8, supplier: '  New Co  ' }
    );
    expect(r.errors).toEqual([]);
    expect(r.plan.writes).toEqual({ price: 125.5, minThreshold: 8, supplier: 'New Co' });
    expect(r.plan.changes.map(c => c.field)).toEqual(['price', 'minThreshold', 'supplier']);
    expect(r.plan.changes[0]).toEqual({ field: 'price', from: 100, to: 125.5 });
    expect(r.plan.changes[2].to).toBe('New Co');
  });

  it('rejects negative and non-numeric price', () => {
    expect(planMedicineMetadataUpdate({ price: 100 }, { price: -1 }).errors[0].field).toBe('price');
    expect(planMedicineMetadataUpdate({ price: 100 }, { price: 'abc' }).errors[0].field).toBe('price');
  });

  it('rejects non-integer or negative minThreshold', () => {
    expect(planMedicineMetadataUpdate({ minThreshold: 5 }, { minThreshold: 2.5 }).errors[0].field).toBe('minThreshold');
    expect(planMedicineMetadataUpdate({ minThreshold: 5 }, { minThreshold: -3 }).errors[0].field).toBe('minThreshold');
    expect(planMedicineMetadataUpdate({ minThreshold: 5 }, { minThreshold: 0 }).errors).toEqual([]);
  });

  it('ignores non-whitelisted keys — stock can never ride along', () => {
    const r = planMedicineMetadataUpdate(
      { price: 100 },
      { price: 120, stock: 999, history: [], batchNumber: 'X' } as any
    );
    expect(r.errors).toEqual([]);
    expect(r.plan.writes).toEqual({ price: 120 });
    expect(r.plan.writes).not.toHaveProperty('stock');
    expect(r.plan.writes).not.toHaveProperty('history');
  });

  it('returns empty plan when nothing changed', () => {
    const r = planMedicineMetadataUpdate({ price: 100, supplier: 'A' }, { price: 100, supplier: 'A' });
    expect(r.errors).toEqual([]);
    expect(r.plan.changes).toEqual([]);
    expect(r.plan.writes).toEqual({});
  });
});

describe('planBatchMetadataUpdate', () => {
  it('sets a known cost (>0) with costEstimated=false', () => {
    const r = planBatchMetadataUpdate({ cost: 0, costEstimated: true }, { cost: '250' });
    expect(r.errors).toEqual([]);
    expect(r.plan.writes).toEqual({ cost: 250, costEstimated: false });
    expect(r.plan.changes[0]).toEqual({ field: 'cost', from: 0, to: 250 });
  });

  it('treats explicit 0 and empty string as Unknown, never a known zero cost', () => {
    const known = { cost: 90, costEstimated: false };
    const r0 = planBatchMetadataUpdate(known, { cost: 0 });
    expect(r0.plan.writes).toEqual({ cost: 0, costEstimated: true });
    expect(r0.plan.changes[0].to).toBe('Unknown');

    const rE = planBatchMetadataUpdate(known, { cost: '  ' });
    expect(rE.plan.writes).toEqual({ cost: 0, costEstimated: true });

    // already Unknown → no-op
    const rNoop = planBatchMetadataUpdate({ cost: 0, costEstimated: true }, { cost: 0 });
    expect(rNoop.plan.changes).toEqual([]);
  });

  it('rejects negative and non-numeric cost', () => {
    expect(planBatchMetadataUpdate({ cost: 0 }, { cost: -5 }).errors[0].field).toBe('cost');
    expect(planBatchMetadataUpdate({ cost: 0 }, { cost: 'abc' }).errors[0].field).toBe('cost');
  });

  it('trims batchNumber and rejects blank/whitespace-only values', () => {
    const ok = planBatchMetadataUpdate({ batchNumber: 'OLD' }, { batchNumber: '  NEW-1 ' });
    expect(ok.plan.writes).toEqual({ batchNumber: 'NEW-1' });

    expect(planBatchMetadataUpdate({ batchNumber: 'OLD' }, { batchNumber: '   ' }).errors[0].field).toBe('batchNumber');
    expect(planBatchMetadataUpdate({ batchNumber: 'OLD' }, { batchNumber: '' }).errors[0].field).toBe('batchNumber');
  });

  it('converts expiry to ISO, rejects invalid dates, and allows clearing to Unknown (P1 #5)', () => {
    const r = planBatchMetadataUpdate({ expiryDate: '2026-01-01T00:00:00.000Z' }, { expiryDate: '2027-06-15' });
    expect(r.errors).toEqual([]);
    expect(r.plan.writes.expiryDate).toBe(new Date('2027-06-15').toISOString());

    expect(planBatchMetadataUpdate({ expiryDate: 'x' }, { expiryDate: 'not-a-date' }).errors[0].field).toBe('expiryDate');
    // Blank = explicit clear → expiry honestly becomes Unknown
    const cleared = planBatchMetadataUpdate({ expiryDate: '2026-01-01T00:00:00.000Z' }, { expiryDate: '' });
    expect(cleared.errors).toEqual([]);
    expect(cleared.plan.writes.expiryDate).toBe('');
    expect(cleared.plan.changes[0].to).toBe('Unknown');
    // Clearing when already unknown is a no-op
    const noop = planBatchMetadataUpdate({ expiryDate: '' }, { expiryDate: '' });
    expect(noop.plan.writes.expiryDate).toBeUndefined();
  });

  it('never writes stock — even if a caller smuggles it in', () => {
    const r = planBatchMetadataUpdate({ cost: 0 }, { cost: 100, stock: 999 } as any);
    expect(r.plan.writes).toEqual({ cost: 100, costEstimated: false });
    expect(r.plan.writes).not.toHaveProperty('stock');
  });

  it('returns empty plan when nothing changed', () => {
    const r = planBatchMetadataUpdate(
      { batchNumber: 'B-1', expiryDate: new Date('2027-01-01').toISOString(), cost: 90, costEstimated: false },
      { batchNumber: 'B-1', expiryDate: '2027-01-01', cost: 90 }
    );
    expect(r.errors).toEqual([]);
    expect(r.plan.changes).toEqual([]);
  });
});
