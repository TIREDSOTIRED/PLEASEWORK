import { describe, it, expect } from 'vitest';
import { buildB2BDispatchEvent } from '../b2b/recordB2BFinancialEvent';

/**
 * Pilot-safe B2B financial event pass:
 * exactly ONE seller event per dispatched order, revenue at DISPATCH,
 * truthful COGS (never fabricated), cash → no receivable, credit → receivable.
 */

const baseOrder = {
  orderId: 'PO-1234-5678',
  buyerTenantId: 'tenant_buyer',
  buyerName: 'Dahe Pharmacy',
  paymentMethod: 'Cash' as const
};

const items = [
  { costAtOrder: 5000, quantityDispatched: 10 },
  { costAtOrder: 2000, quantityDispatched: 4 }
];

const allocations = [
  [
    { unitCost: 3000, quantityToDeduct: 10 } // one batch covers all
  ],
  [
    { unitCost: 1200, quantityToDeduct: 3 },
    { unitCost: 1500, quantityToDeduct: 1 }
  ]
];

describe('b2b financial event — recognition & idempotency', () => {
  it('computes revenue from the immutable order price snapshots and dispatched quantities', () => {
    const e = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'DISPATCH-001', occurredAt: '2026-09-05T10:00:00Z'
    });
    expect(e.amount).toBe(5000 * 10 + 2000 * 4); // 58000
    expect(e.type).toBe('b2b_sale');
    expect(e.tenantId).toBe('tenant_seller');
    expect(e.linkedRef).toBe('PO-1234-5678');
  });

  it('has a DETERMINISTIC id — dispatch retries resolve to the same single event', () => {
    const a = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'DISPATCH-001', occurredAt: '2026-09-05T10:00:00Z'
    });
    const b = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'DISPATCH-999', occurredAt: '2026-09-05T11:00:00Z'
    });
    expect(a.id).toBe('fin_PO-1234-5678');
    expect(b.id).toBe(a.id);
  });
});

describe('b2b financial event — cash vs credit receivables', () => {
  it('cash order contributes ZERO receivable', () => {
    const e = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'D', occurredAt: 't'
    });
    expect(e.method).toBe('Cash');
    expect(e.receivableAmount).toBe(0);
  });

  it('credit order contributes its full amount to the receivable', () => {
    const e = buildB2BDispatchEvent({
      order: { ...baseOrder, paymentMethod: 'Credit' }, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'D', occurredAt: 't'
    });
    expect(e.method).toBe('Credit');
    expect(e.receivableAmount).toBe(e.amount);
  });

  it('HISTORICAL orders without paymentMethod are treated as Cash (never invents debt)', () => {
    const { paymentMethod, ...historical } = baseOrder;
    const e = buildB2BDispatchEvent({
      order: historical, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'D', occurredAt: 't'
    });
    expect(e.method).toBe('Cash');
    expect(e.receivableAmount).toBe(0);
  });
});

describe('b2b financial event — COGS truthfulness', () => {
  it('sums real batch acquisition costs from the actual FEFO allocations', () => {
    const e = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items, allocationsByItem: allocations, dispatchToken: 'D', occurredAt: 't'
    });
    expect(e.cogsAmount).toBe(3000 * 10 + 1200 * 3 + 1500 * 1); // 33600
    expect(e.cogsUnknown).toBe(false);
  });

  it('a batch with no recorded cost contributes 0 and raises the unknown flag — never fabricated', () => {
    const e = buildB2BDispatchEvent({
      order: baseOrder, sellerTenantId: 'tenant_seller',
      items: [{ costAtOrder: 5000, quantityDispatched: 10 }],
      allocationsByItem: [[
        { unitCost: 3000, quantityToDeduct: 6 },
        { unitCost: 0, quantityToDeduct: 4 } // cost never recorded
      ]],
      dispatchToken: 'D', occurredAt: 't'
    });
    expect(e.cogsAmount).toBe(18000); // known part only
    expect(e.cogsUnknown).toBe(true);
  });
});
