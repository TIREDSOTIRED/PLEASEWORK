import { describe, it, expect } from 'vitest';
import { resolveUnitCost, computeMargin, deriveBatchCost } from '../../utils/cost';

describe('resolveUnitCost', () => {
  it('returns real batch acquisition cost with provenance=batch', () => {
    expect(resolveUnitCost(1250)).toEqual({ unitCost: 1250, provenance: 'batch' });
  });

  it('marks missing / zero / invalid cost as unavailable with unitCost 0', () => {
    expect(resolveUnitCost(0)).toEqual({ unitCost: 0, provenance: 'unavailable' });
    expect(resolveUnitCost(undefined)).toEqual({ unitCost: 0, provenance: 'unavailable' });
    expect(resolveUnitCost(null)).toEqual({ unitCost: 0, provenance: 'unavailable' });
    expect(resolveUnitCost(NaN)).toEqual({ unitCost: 0, provenance: 'unavailable' });
    expect(resolveUnitCost(-5)).toEqual({ unitCost: 0, provenance: 'unavailable' });
  });

  it('NEVER fabricates a percentage-based estimate', () => {
    // The old bug: price * 0.7 silently presented as cost.
    const price = 1000;
    const resolved = resolveUnitCost(undefined);
    expect(resolved.unitCost).not.toBe(price * 0.7);
    expect(resolved.provenance).toBe('unavailable');
  });
});

describe('computeMargin', () => {
  it('computes profit and margin from known costs only', () => {
    const m = computeMargin(3000, [
      { quantity: 2, resolved: resolveUnitCost(500) },
      { quantity: 1, resolved: resolveUnitCost(750) },
    ]);
    expect(m.grossProfit).toBe(1250);
    expect(m.marginPct).toBeCloseTo((1250 / 3000) * 100, 6);
    expect(m.unavailableCostLines).toBe(0);
  });

  it('treats unavailable-cost lines as 0 and flags them', () => {
    const m = computeMargin(2000, [
      { quantity: 1, resolved: resolveUnitCost(600) },
      { quantity: 3, resolved: resolveUnitCost(undefined) },
    ]);
    expect(m.grossProfit).toBe(1400); // upper bound
    expect(m.unavailableCostLines).toBe(1);
  });

  it('returns null margin when revenue is zero', () => {
    const m = computeMargin(0, [{ quantity: 1, resolved: resolveUnitCost(10) }]);
    expect(m.marginPct).toBeNull();
    expect(m.grossProfit).toBe(-10);
  });
});

describe('deriveBatchCost — purchase-cost → batch-cost contamination fix', () => {
  // Scenario A: real purchase cost 50, selling price 80.
  it('A: real purchase cost becomes the batch cost, NOT the selling price', () => {
    const { cost, costEstimated } = deriveBatchCost(50);
    expect(cost).toBe(50);
    expect(costEstimated).toBe(false);
    // POS profit on that batch: 80 − 50 = 30 KNOWN profit (batch provenance).
    const m = computeMargin(80, [{ quantity: 1, resolved: resolveUnitCost(cost) }]);
    expect(m.grossProfit).toBe(30);
    expect(m.unavailableCostLines).toBe(0);
  });

  // Scenario B: purchase cost blank, selling price 80.
  it('B: blank purchase cost stays UNKNOWN (0) and flags estimated — no fabricated zero-profit-as-known', () => {
    const { cost, costEstimated } = deriveBatchCost(undefined);
    expect(cost).toBe(0);
    expect(costEstimated).toBe(true);
    // Selling price must NEVER leak in as cost:
    expect(cost).not.toBe(80);
    // POS recognizes an UPPER-BOUND profit with the unknown-cost flag active:
    const m = computeMargin(80, [{ quantity: 1, resolved: resolveUnitCost(cost) }]);
    expect(m.grossProfit).toBe(80); // revenue − 0 known cost (upper bound)
    expect(m.unavailableCostLines).toBe(1);
  });

  it('B2: zero cost is treated exactly like blank', () => {
    expect(deriveBatchCost(0)).toEqual({ cost: 0, costEstimated: true });
  });

  // Scenario D: ScanAdd-created stock without purchase cost.
  it('D: scan-added stock without cost derives unknown, never the selling price', () => {
    expect(deriveBatchCost(null)).toEqual({ cost: 0, costEstimated: true });
    expect(deriveBatchCost(NaN)).toEqual({ cost: 0, costEstimated: true });
  });

  it('never returns a negative or non-finite batch cost', () => {
    expect(deriveBatchCost(-50).cost).toBe(0);
    expect(deriveBatchCost(Infinity).cost).toBe(0);
  });
});
