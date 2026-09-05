/**
 * Truthful cost provenance for sales analytics.
 *
 * Replaces the former silent fabrication `priceAtSale * 0.7` with explicit
 * provenance: a sale line's cost is either the REAL acquisition cost recorded
 * on the dispensed batch, or it is explicitly marked UNAVAILABLE (never an
 * invented estimate). Analytics remain structurally compatible: numeric
 * fields stay numeric; new provenance flags describe how to read them.
 */

export type CostProvenance = 'batch' | 'unavailable';

export interface ResolvedUnitCost {
  /** Known batch acquisition cost, or 0 when unavailable (never fabricated). */
  unitCost: number;
  provenance: CostProvenance;
}

export function resolveUnitCost(rawCost: number | null | undefined): ResolvedUnitCost {
  const c = Number(rawCost);
  if (Number.isFinite(c) && c > 0) {
    return { unitCost: c, provenance: 'batch' };
  }
  return { unitCost: 0, provenance: 'unavailable' };
}

/**
 * Batch-cost derivation for NEW batches (intake, scan-add, legacy mirrors).
 * The existing cost-provenance vocabulary applied at batch-creation time:
 * a recorded purchase cost (> 0) becomes the batch cost; a missing/zero cost
 * is UNKNOWN (0 + costEstimated) — NEVER the selling price, NEVER a catalog
 * retail fallback. Historical batches are untouched.
 */
export function deriveBatchCost(costPrice: number | null | undefined): { cost: number; costEstimated: boolean } {
  const resolved = resolveUnitCost(costPrice);
  return { cost: resolved.unitCost, costEstimated: resolved.provenance === 'unavailable' };
}

export interface MarginSummary {
  /** Revenue minus KNOWN costs only. When unavailable costs exist this is an upper bound. */
  grossProfit: number;
  /** grossProfit / revenue * 100, null when revenue is zero. */
  marginPct: number | null;
  /** Number of sold lines whose real cost was unavailable. */
  unavailableCostLines: number;
}

export function computeMargin(
  revenue: number,
  lines: { quantity: number; resolved: ResolvedUnitCost }[]
): MarginSummary {
  const knownCostTotal = lines.reduce((sum, l) => l.resolved.provenance === 'batch' ? sum + l.quantity * l.resolved.unitCost : sum, 0);
  const unavailableCostLines = lines.filter(l => l.resolved.provenance === 'unavailable').length;
  const grossProfit = revenue - knownCostTotal;
  return {
    grossProfit,
    marginPct: revenue > 0 ? ((revenue - knownCostTotal) / revenue) * 100 : null,
    unavailableCostLines
  };
}
