/**
 * Metadata edit planners — pure validation + write planning for inventory
 * metadata corrections (Phase 3).
 *
 * WHY: metadata edits (purchase cost, batch expiry, batch number, supplier,
 * price, threshold) must never touch stock quantities, never fabricate values,
 * and must be auditable. These planners return an explicit write payload plus
 * a from/to change list for the audit log; they never perform I/O.
 *
 * Data-model rule enforced here: batch problems are fixed on the batch, never
 * by overwriting medicine-level fields, and medicine planners only accept a
 * strict whitelist of fields.
 */

export interface FieldError {
  field: string;
  message: string;
}

export interface MetadataChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface MetadataPlan {
  writes: Record<string, unknown>;
  changes: MetadataChange[];
}

export interface MetadataPlanResult {
  errors: FieldError[];
  plan: MetadataPlan;
}

const isoOf = (v: unknown): string | null => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v ?? '').trim()));

/** Treat 0/absent cost as Unknown (0 + costEstimated) — matches deriveBatchCost semantics. */
function normalizeCost(current: unknown): { cost: number; costEstimated: boolean } {
  const c = Number(current);
  return Number.isFinite(c) && c > 0 ? { cost: c, costEstimated: false } : { cost: 0, costEstimated: true };
}

/**
 * Medicine-level metadata edit. Whitelist: price, minThreshold, supplier.
 * Stock/history are structurally impossible to include — unknown keys are ignored.
 */
export function planMedicineMetadataUpdate(
  current: { price?: unknown; minThreshold?: unknown; supplier?: unknown },
  patch: { price?: unknown; minThreshold?: unknown; supplier?: unknown }
): MetadataPlanResult {
  const errors: FieldError[] = [];
  const writes: Record<string, unknown> = {};
  const changes: MetadataChange[] = [];

  if (patch.price !== undefined) {
    const p = num(patch.price);
    if (!Number.isFinite(p) || p < 0) {
      errors.push({ field: 'price', message: 'Enter a valid non-negative selling price' });
    } else if (p !== (Number(current.price) || 0)) {
      writes.price = p;
      changes.push({ field: 'price', from: current.price, to: p });
    }
  }

  if (patch.minThreshold !== undefined) {
    const m = num(patch.minThreshold);
    if (!Number.isFinite(m) || m < 0 || !Number.isInteger(m)) {
      errors.push({ field: 'minThreshold', message: 'Threshold must be a whole number ≥ 0' });
    } else if (m !== (Number(current.minThreshold) || 0)) {
      writes.minThreshold = m;
      changes.push({ field: 'minThreshold', from: current.minThreshold, to: m });
    }
  }

  if (patch.supplier !== undefined) {
    const s = String(patch.supplier).trim();
    if (s !== String(current.supplier ?? '')) {
      writes.supplier = s;
      changes.push({ field: 'supplier', from: current.supplier ?? '', to: s });
    }
  }

  return { errors, plan: { writes, changes } };
}

/**
 * Batch-level metadata edit. Whitelist: batchNumber, expiryDate, cost.
 * Never includes stock. Cost 0/empty is explicit Unknown (costEstimated: true).
 */
export function planBatchMetadataUpdate(
  current: { batchNumber?: unknown; expiryDate?: unknown; cost?: unknown; costEstimated?: unknown },
  patch: { batchNumber?: unknown; expiryDate?: unknown; cost?: unknown }
): MetadataPlanResult {
  const errors: FieldError[] = [];
  const writes: Record<string, unknown> = {};
  const changes: MetadataChange[] = [];

  if (patch.batchNumber !== undefined) {
    const b = String(patch.batchNumber).trim();
    if (!b) {
      errors.push({ field: 'batchNumber', message: 'Batch number cannot be blank' });
    } else if (b !== String(current.batchNumber ?? '')) {
      writes.batchNumber = b;
      changes.push({ field: 'batchNumber', from: current.batchNumber ?? '', to: b });
    }
  }

  if (patch.expiryDate !== undefined) {
    if (String(patch.expiryDate).trim() === '') {
      errors.push({ field: 'expiryDate', message: 'Enter a valid expiry date' });
    } else {
      const iso = isoOf(patch.expiryDate);
      if (!iso) {
        errors.push({ field: 'expiryDate', message: 'Enter a valid expiry date' });
      } else if (iso !== String(current.expiryDate ?? '')) {
        writes.expiryDate = iso;
        changes.push({ field: 'expiryDate', from: current.expiryDate ?? '', to: iso });
      }
    }
  }

  if (patch.cost !== undefined) {
    const raw = String(patch.cost ?? '').trim();
    if (raw === '') {
      // Explicit clear → back to Unknown
      const cur = normalizeCost(current.cost);
      if (cur.cost !== 0 || cur.costEstimated !== true) {
        writes.cost = 0;
        writes.costEstimated = true;
        changes.push({ field: 'cost', from: current.cost ?? null, to: 'Unknown' });
      }
    } else {
      const c = num(raw);
      if (!Number.isFinite(c) || c < 0) {
        errors.push({ field: 'cost', message: 'Enter a valid non-negative purchase cost' });
      } else if (c === 0) {
        // Zero is NOT a known purchase cost — it means Unknown
        const cur = normalizeCost(current.cost);
        if (cur.cost !== 0 || cur.costEstimated !== true) {
          writes.cost = 0;
          writes.costEstimated = true;
          changes.push({ field: 'cost', from: current.cost ?? null, to: 'Unknown' });
        }
      } else {
        const cur = normalizeCost(current.cost);
        if (cur.cost !== c || cur.costEstimated !== false) {
          writes.cost = c;
          writes.costEstimated = false;
          changes.push({ field: 'cost', from: current.cost ?? null, to: c });
        }
      }
    }
  }

  return { errors, plan: { writes, changes } };
}
