import type { B2BOrder } from '../../domain/b2b';

/**
 * Warehouse financial event — first pilot-safe pass (B2B revenue visibility).
 *
 * ONE event per dispatched order, written by the SELLER (earning) tenant in
 * the SAME atomic writeBatch as the FEFO stock deduction, so an event can
 * never exist without its matching physical movement and vice versa.
 *
 * Idempotency: the event id is deterministic (`fin_{orderId}`) — dispatch
 * retries resolve to the same document; combined with the duplicate-dispatch
 * status guard there is exactly one event per order. Buyer receipt writes
 * nothing (no double revenue).
 *
 * COGS truth: accumulated from the ACTUAL FEFO allocations' batch
 * acquisition costs. A batch with no recorded cost contributes 0 and raises
 * the `cogsUnknown` flag instead of fabricating a value (same provenance
 * contract as POS sales' `resolveUnitCost`).
 *
 * Receivables (v1, no settlement flow yet): `receivableAmount` carries the
 * credit portion — aggregating it later yields the seller's receivable
 * balance. Cash events contribute 0. Historical orders without
 * `paymentMethod` are treated as Cash (fail-safe: never invents debt).
 *
 * Canonical vocabulary matches POS: 'Cash' | 'Credit'.
 */

export type FinancialEventType = 'b2b_sale';

export interface B2BDispatchAllocation {
  /** Batch acquisition unit cost (may be 0/unrecorded → unknown). */
  unitCost: number;
  quantityToDeduct: number;
}

export interface B2BDispatchItemInput {
  /** Immutable per-unit price snapshot taken at order time. */
  costAtOrder: number;
  /** Quantity actually deducted at dispatch (approved ?? requested). */
  quantityDispatched: number;
}

export interface B2BFinancialEvent {
  id: string;
  type: FinancialEventType;
  /** The EARNING tenant — the only writer of this event. */
  tenantId: string;
  counterpartyId: string;
  counterpartyName: string;
  linkedRef: string;
  dispatchToken: string;
  amount: number;
  receivableAmount: number;
  method: 'Cash' | 'Credit';
  cogsAmount: number;
  cogsUnknown: boolean;
  itemCount: number;
  occurredAt: string;
  createdAt: string;
}

export function buildB2BDispatchEvent(spec: {
  order: Pick<B2BOrder, 'orderId' | 'buyerTenantId' | 'buyerName' | 'paymentMethod'>;
  sellerTenantId: string;
  items: B2BDispatchItemInput[];
  /** FEFO allocations per item, parallel to `items`. */
  allocationsByItem: B2BDispatchAllocation[][];
  dispatchToken: string;
  occurredAt: string;
}): B2BFinancialEvent {
  const { order, sellerTenantId, items, allocationsByItem, dispatchToken, occurredAt } = spec;

  let amount = 0;
  items.forEach(it => {
    amount += (Number(it.costAtOrder) || 0) * (Number(it.quantityDispatched) || 0);
  });

  let cogsAmount = 0;
  let cogsUnknown = false;
  allocationsByItem.forEach(allocs => {
    (allocs || []).forEach(a => {
      const unit = Number(a.unitCost) || 0;
      const qty = Number(a.quantityToDeduct) || 0;
      if (unit > 0) {
        cogsAmount += unit * qty;
      } else {
        cogsUnknown = true;
      }
    });
  });

  // Historical orders have no paymentMethod — fail safe to Cash (never
  // invents a receivable). Checkout normalizes 'cash'/'credit' → canonical.
  const method: 'Cash' | 'Credit' = order.paymentMethod === 'Credit' ? 'Credit' : 'Cash';
  const amountNum = Number(amount.toFixed(2));

  return {
    id: `fin_${order.orderId}`,
    type: 'b2b_sale',
    tenantId: sellerTenantId,
    counterpartyId: order.buyerTenantId || '',
    counterpartyName: order.buyerName || '',
    linkedRef: order.orderId,
    dispatchToken: dispatchToken || '',
    amount: amountNum,
    receivableAmount: method === 'Credit' ? amountNum : 0,
    method,
    cogsAmount: Number(cogsAmount.toFixed(2)),
    cogsUnknown,
    itemCount: items.length,
    occurredAt,
    createdAt: occurredAt
  };
}
