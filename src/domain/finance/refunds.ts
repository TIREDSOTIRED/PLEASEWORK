/**
 * Refunds/returns — P2 #13. Append-only reversal over the EXISTING ledger
 * model, mirroring the CREDIT_SETTLEMENT design:
 *
 *   - original sale = existing ledger doc (status 'Paid' | 'Pending')
 *   - return        = NEW append-only ledger doc (type 'REFUND', negative
 *                     totalRevenue) + compensating stock return
 *
 * No sale document is ever deleted. The original sale accumulates
 * `refundedQty` (per medId) and `refundTotal` so over-returning is
 * impossible and partial refunds are natural. Money math always uses
 * `priceAtSale` — the price the customer actually paid — never the
 * item's current price.
 */

export interface RefundSaleItemLike {
  medId: string;
  name?: string;
  quantitySold?: number;
  priceAtSale?: number;
  /** Sales-first: line was sold without managed inventory — no stock return. */
  unmanaged?: boolean;
}

export interface RefundSaleLike {
  saleId?: string;
  type?: string;
  status?: string;
  items?: RefundSaleItemLike[];
  refundedQty?: Record<string, number>;
  refundTotal?: number;
  customerName?: string;
}

export interface RefundLine {
  medId: string;
  name: string;
  qty: number;
  amount: number;
}

export interface RefundResult {
  ok: boolean;
  error?: 'NOT_A_SALE' | 'NO_SALE_ID' | 'EMPTY_RETURN' | 'INVALID_QTY' | 'OVER_RETURN';
  overMedIds?: string[];
  refundTotal?: number;
  refundLines?: RefundLine[];
  fullyRefunded?: boolean;
}

/**
 * Validate a return request against a sale and compute the refund record
 * contents. Pure — no Firestore, no side effects.
 */
export function buildRefund(
  sale: RefundSaleLike,
  returnQtys: Record<string, number>,
  reason?: string
): RefundResult {
  // Settlements and prior refund rows are not returnable inventory events.
  if (!sale || (sale.type && sale.type !== 'POS Sale')) return { ok: false, error: 'NOT_A_SALE' };
  if (!sale.saleId) return { ok: false, error: 'NO_SALE_ID' };

  const items = sale.items || [];
  const requestedMedIds = Object.keys(returnQtys || {}).filter(id => Number(returnQtys[id]) > 0);
  if (!requestedMedIds.length) return { ok: false, error: 'EMPTY_RETURN' };

  const overMedIds: string[] = [];
  const refundLines: RefundLine[] = [];

  for (const medId of requestedMedIds) {
    const qty = Number(returnQtys[medId]);
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'INVALID_QTY' };

    const saleItem = items.find(i => i.medId === medId);
    if (!saleItem) return { ok: false, error: 'INVALID_QTY' };

    const already = Number(sale.refundedQty?.[medId]) || 0;
    const sold = Number(saleItem.quantitySold) || 0;
    if (qty > sold - already) {
      overMedIds.push(medId);
      continue;
    }

    const unitPrice = Number(saleItem.priceAtSale) || 0;
    refundLines.push({
      medId,
      name: saleItem.name || medId,
      qty,
      amount: unitPrice * qty
    });
  }

  if (overMedIds.length) return { ok: false, error: 'OVER_RETURN', overMedIds };

  const refundTotal = refundLines.reduce((s, l) => s + l.amount, 0);

  // Fully refunded when every sold unit of every line has been returned.
  const fullyRefunded = items.every(i => {
    const sold = Number(i.quantitySold) || 0;
    const returned = (Number(sale.refundedQty?.[i.medId]) || 0) + (returnQtys[i.medId] || 0);
    return returned >= sold;
  });

  // `reason` rides along for the audit trail but never alters the math.
  void reason;

  return { ok: true, refundTotal, refundLines, fullyRefunded };
}

/**
 * The merged refundedQty map to persist on the ORIGINAL sale document after
 * a successful refund (pure merge, no mutation of the input sale).
 */
export function mergeRefundedQty(
  sale: RefundSaleLike,
  refundLines: RefundLine[]
): Record<string, number> {
  const merged: Record<string, number> = { ...(sale.refundedQty || {}) };
  for (const line of refundLines) {
    merged[line.medId] = (Number(merged[line.medId]) || 0) + line.qty;
  }
  return merged;
}
