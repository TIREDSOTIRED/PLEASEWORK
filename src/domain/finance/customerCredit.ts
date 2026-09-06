/**
 * Retail customer credit — P1 receivable math over the EXISTING ledger model.
 *
 * The financial model already records credit sales as ledger docs with
 * status 'Pending' (RootNavigator.firestoreCompleteSale) and the LedgerTab
 * counts them as outstanding debt. This module adds the append-only
 * settlement layer ON TOP of that model:
 *
 *   - credit sale  = existing ledger doc (status 'Pending', customerName)
 *   - settlement   = NEW append-only ledger doc (type 'CREDIT_SETTLEMENT')
 *
 * No sale document is ever rewritten or deleted. Balances are always
 * computed: outstanding(customer) = Σ pending sale totals − Σ settlement
 * amounts for that customer.
 */

export interface LedgerSaleLike {
  saleId?: string;
  status?: string;
  paymentMethod?: string;
  totalRevenue?: number;
  customerName?: string;
  timestamp?: string;
  /** P2 #13 — refund money already returned against this sale. */
  refundTotal?: number;
}

export interface SettlementLike {
  type?: string;
  customerName?: string;
  amountPaid?: number;
}

export interface CustomerBalance {
  customerName: string;
  billedTotal: number;
  settledTotal: number;
  outstanding: number;
  openSaleIds: string[];
}

export const UNNAMED_CUSTOMER = 'Unnamed customer';

/**
 * Compute per-customer outstanding balances from raw ledger rows.
 * Sales count toward debt only when they are real credit sales
 * (status 'Pending'). Settlements are ledger docs of type
 * 'CREDIT_SETTLEMENT' carrying customerName + amountPaid.
 */
export function computeCustomerBalances(
  ledgerRows: (LedgerSaleLike & SettlementLike)[]
): CustomerBalance[] {
  const map = new Map<string, CustomerBalance>();

  const bucket = (customerName: string): CustomerBalance => {
    let b = map.get(customerName);
    if (!b) {
      b = { customerName, billedTotal: 0, settledTotal: 0, outstanding: 0, openSaleIds: [] };
      map.set(customerName, b);
    }
    return b;
  };

  for (const row of ledgerRows || []) {
    if (row && row.type === 'CREDIT_SETTLEMENT') {
      const name = (row.customerName || '').trim() || UNNAMED_CUSTOMER;
      bucket(name).settledTotal += Number(row.amountPaid) || 0;
      continue;
    }
    if (!row || row.status !== 'Pending') continue;
    const revenue = Number(row.totalRevenue) || 0;
    if (revenue <= 0) continue;
    const name = (row.customerName || '').trim() || UNNAMED_CUSTOMER;
    const b = bucket(name);
    // P2 #13 — partially refunded credit sales still owe the remainder;
    // fully refunded ones flip to status 'Refunded' and exit above.
    b.billedTotal += revenue - (Number(row.refundTotal) || 0);
    if (row.saleId) b.openSaleIds.push(row.saleId);
  }

  for (const b of map.values()) {
    b.outstanding = Math.max(0, b.billedTotal - b.settledTotal);
  }

  return [...map.values()]
    .filter(b => b.billedTotal > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}
