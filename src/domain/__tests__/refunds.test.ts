import { describe, it, expect } from 'vitest';
import { buildRefund, mergeRefundedQty } from '../finance/refunds';
import { SaleRecord } from '../../types';

const sale = (over: Partial<SaleRecord> = {}): SaleRecord => ({
  saleId: 'SALE-1',
  timestamp: new Date().toISOString(),
  totalRevenue: 300,
  totalProfit: 90,
  status: 'Paid',
  items: [
    { medId: 'med-a', name: 'Atorvastatin 10mg', quantitySold: 5, priceAtSale: 40, costAtSale: 25 },
    { medId: 'med-b', name: 'Amoxicillin 500mg', quantitySold: 2, priceAtSale: 50, costAtSale: 30 }
  ],
  ...over
} as SaleRecord);

describe('buildRefund', () => {
  it('computes amounts from priceAtSale, not current price', () => {
    const r = buildRefund(sale(), { 'med-a': 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.refundTotal).toBe(80); // 2 × 40
      expect(r.refundLines[0].amount).toBe(80);
      expect(r.fullyRefunded).toBe(false);
    }
  });

  it('flags fullyRefunded when every sold unit of every line is returned', () => {
    const r = buildRefund(sale(), { 'med-a': 5, 'med-b': 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fullyRefunded).toBe(true);
      expect(r.refundTotal).toBe(300); // 5×40 + 2×50
    }
  });

  it('blocks returning more than was sold', () => {
    const r = buildRefund(sale(), { 'med-a': 6 });
    expect(r).toMatchObject({ ok: false, error: 'OVER_RETURN', overMedIds: ['med-a'] });
  });

  it('blocks over-return across multiple partial refunds', () => {
    const once = buildRefund(sale(), { 'med-a': 3 });
    expect(once.ok).toBe(true);
    // 5 sold − 3 already returned = 2 remaining; asking for 3 is over.
    const r = buildRefund(sale({ refundedQty: { 'med-a': 3 } } as any), { 'med-a': 3 });
    expect(r).toMatchObject({ ok: false, error: 'OVER_RETURN', overMedIds: ['med-a'] });
    // 2 is fine.
    expect(buildRefund(sale({ refundedQty: { 'med-a': 3 } } as any), { 'med-a': 2 }).ok).toBe(true);
    void once;
  });

  it('rejects non-integer and zero quantities', () => {
    expect(buildRefund(sale(), { 'med-a': 0 }).ok).toBe(false);
    expect(buildRefund(sale(), { 'med-a': 1.5 }).ok).toBe(false);
    expect(buildRefund(sale(), { 'med-a': -1 }).ok).toBe(false);
  });

  it('rejects an empty selection', () => {
    expect(buildRefund(sale(), {}).ok).toBe(false);
  });

  it('never treats settlements or refund rows as returnable sales', () => {
    expect(buildRefund(sale({ type: 'CREDIT_SETTLEMENT' } as any), { 'med-a': 1 })).toMatchObject({ ok: false, error: 'NOT_A_SALE' });
    expect(buildRefund(sale({ type: 'REFUND' } as any), { 'med-a': 1 })).toMatchObject({ ok: false, error: 'NOT_A_SALE' });
  });

  it('rejects unknown medIds', () => {
    expect(buildRefund(sale(), { 'med-z': 1 }).ok).toBe(false);
  });

  it('supports pending (credit) sales the same as paid ones', () => {
    const r = buildRefund(sale({ status: 'Pending' }), { 'med-b': 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refundTotal).toBe(50);
  });
});

describe('mergeRefundedQty', () => {
  it('merges new lines into existing refundedQty without mutating the sale', () => {
    const s = sale({ refundedQty: { 'med-a': 2 } } as any);
    const merged = mergeRefundedQty(s, [{ medId: 'med-a', name: 'x', qty: 1, amount: 40 }, { medId: 'med-b', name: 'y', qty: 2, amount: 100 }]);
    expect(merged).toEqual({ 'med-a': 3, 'med-b': 2 });
    // input untouched
    expect(s.refundedQty).toEqual({ 'med-a': 2 });
  });
});
