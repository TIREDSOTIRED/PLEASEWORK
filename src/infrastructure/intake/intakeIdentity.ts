import { normalizeBarcode } from '../../services/syncEngine';

/**
 * Intake identity resolution (Intake Identity Fragmentation fix).
 *
 * Problem this module solves: the same physical product could reach
 * `tenants/{tenantId}/storage_inventory` under several competing document
 * identities depending on the intake path:
 *
 *   - docs created from a publish-time catalog `code` slug (e.g. `atorvastatin10mg/ctab`)
 *   - catalog-search restock, whose id came from `mapMedicine`:
 *     `sako || barcode || name + array-index`
 *   - manual intake: `custom_bc_<barcode>` / `custom_nm_<name>`
 *   - worst case: `BAR-<Date.now()>` minted for items with no barcode
 *
 * `firestoreAddMedicine` only probed the COMPUTED doc id, so a restock whose
 * catalog id regime differed from the existing card's id regime minted a
 * second inventory document for the same barcode, fragmenting stock, batches
 * and marketplace offers.
 *
 * Canonical rule (smallest safe identity contract):
 *   1. An EXISTING tenant storage_inventory document is authoritative —
 *      intake must resolve to it and never silently create a second physical
 *      identity for the same product.
 *   2. Resolution order:
 *        a. doc-id probe of the incoming catalog id (sanitized),
 *        b. tenant-scoped exact match on normalized barcode,
 *        c. deterministic creation id: stable catalog id, else
 *           `custom_bc_<barcode>`, else `custom_nm_<name>` — never row
 *           order / array index / timestamp.
 *   3. Barcode matching normalizes through `normalizeBarcode` (leading
 *      zeroes, zero-width chars, quotes, trailing commas) and splits
 *      multi-code strings ("111,222") into candidates.
 *   4. Synthetic barcodes (`BAR-<ts>`, `custom_*`) are data pollution, not
 *      physical identity — they never match or mint ids.
 *   5. Tenant isolation is structural: the injected lookup queries
 *      `tenants/{tenantId}/storage_inventory` only.
 *
 * Firestore IO is injected via `IntakeLookup` so the decision logic stays
 * pure and unit-testable; the production adapter lives in RootNavigator.
 */

export const SYNTHETIC_BARCODE_PATTERN = /^(BAR-\d{6,}|custom_)/i;

export interface IntakeInventoryDoc {
  id: string;
  data: Record<string, any>;
}

export interface IntakeLookup {
  getByDocId(safeId: string): Promise<IntakeInventoryDoc | null>;
  getByBarcode(barcode: string): Promise<IntakeInventoryDoc[]>;
}

export interface IntakeResolution {
  safeMedId: string;
  catalogId: string;
  matchedBy: 'docId' | 'barcode' | 'none';
  existing?: IntakeInventoryDoc;
  barcodeMatches?: IntakeInventoryDoc[];
  unstableCatalogIdRejected?: boolean;
}

/** Firestore doc ids forbid '/'; mirror the existing sanitization. */
export function sanitizeDocId(raw: string): string {
  return String(raw || '').replace(/\//g, '_');
}

/**
 * Candidates for barcode-based identity resolution, in priority order.
 * Synthetic placeholders (BAR-<timestamp>, custom_*) and empties are
 * rejected; multi-code source strings split on comma/semicolon/whitespace.
 */
export function intakeBarcodeCandidates(raw: string | number | null | undefined): string[] {
  const canonical = normalizeBarcode(raw);
  if (!canonical || SYNTHETIC_BARCODE_PATTERN.test(canonical)) return [];
  const parts = canonical
    .split(/[,;\s]+/)
    .map(p => p.replace(/^['"]+|['"]+$/g, '').replace(/,$/,'').trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/**
 * `mapMedicine`'s worst-case fallback id (`${name}_${arrayIndex}`) and
 * generated timestamp ids (`med-<Date.now()>`, `med_<Date.now()>`) are
 * position/time-dependent and must never become a physical inventory
 * document id on CREATE. Numeric ids (sako) are stable.
 */
export function isUnstableCatalogId(catalogId: string): boolean {
  const id = String(catalogId || '').trim();
  if (!id) return false;
  if (/^\d+$/.test(id)) return false; // sako
  return /_\d+$/.test(id) || /[-_]\d{9,}$/.test(id); // name_index, med-<ts>
}

/**
 * Deterministic manual identity — the same scheme StockIntakeModal uses, so
 * manual and programmatic paths converge on the same id for the same input.
 */
export function deterministicManualId(kind: 'bc' | 'nm', key: string): string {
  const sanitized = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[/\\]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 120)
    .replace(/\.\./g, '_');
  return `custom_${kind}_${sanitized || 'unnamed'}`;
}

/**
 * Resolve the canonical inventory identity an intake should write against.
 *
 * Order: (1) doc-id probe of incoming catalog id — an existing document is
 * authoritative even when its id regime differs; (2) tenant-scoped exact
 * barcode match — deterministic pick (incoming catalog id first, then lowest
 * doc id) with all matches reported so fragmentation stays visible;
 * (3) deterministic create id, rejecting unstable `name_index` catalog ids.
 */
export async function resolveIntakeTarget(spec: {
  catalogId?: string;
  id?: string;
  barcode?: string | number;
  name?: string;
  lookup: IntakeLookup;
}): Promise<IntakeResolution> {
  const { lookup, barcode, name } = spec;

  const rawCatalogId = [spec.catalogId, spec.id]
    .map(v => (v === undefined || v === null ? '' : String(v).trim()))
    .find(Boolean) || '';

  // 1. Authoritative doc-id probe (catalog id regimes: code slug, sako, barcode).
  if (rawCatalogId) {
    const probed = new Set<string>([sanitizeDocId(rawCatalogId), sanitizeDocId(rawCatalogId.replace(/\//g, '_'))]);
    for (const safeId of probed) {
      const hit = await lookup.getByDocId(safeId);
      if (hit) {
        return {
          safeMedId: hit.id,
          catalogId: hit.data.catalogId || rawCatalogId,
          matchedBy: 'docId',
          existing: hit
        };
      }
    }
  }

  // 2. Tenant-scoped exact barcode match.
  const bcCandidates = intakeBarcodeCandidates(barcode);
  for (const bc of bcCandidates) {
    const docs = await lookup.getByBarcode(bc);
    if (docs.length > 0) {
      const preferredId = sanitizeDocId(rawCatalogId);
      const chosen =
        docs.find(d => d.id === preferredId) ||
        docs.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
      return {
        safeMedId: chosen.id,
        catalogId: chosen.data.catalogId || rawCatalogId,
        matchedBy: 'barcode',
        existing: chosen,
        barcodeMatches: docs
      };
    }
  }

  // 3. Deterministic create id — never row order, array index or timestamp.
  const unstable = rawCatalogId ? isUnstableCatalogId(rawCatalogId) : false;
  if (rawCatalogId && !unstable) {
    return {
      safeMedId: sanitizeDocId(rawCatalogId),
      catalogId: rawCatalogId,
      matchedBy: 'none'
    };
  }
  if (bcCandidates.length > 0) {
    return {
      safeMedId: deterministicManualId('bc', bcCandidates[0]),
      catalogId: rawCatalogId,
      matchedBy: 'none',
      unstableCatalogIdRejected: unstable
    };
  }
  return {
    safeMedId: deterministicManualId('nm', String(name || '').trim()),
    catalogId: rawCatalogId,
    matchedBy: 'none',
    unstableCatalogIdRejected: unstable
  };
}

/**
 * Merge payload for restocking an EXISTING inventory identity: incoming
 * catalog enrichment rides along, but the existing document's id/catalogId
 * stay authoritative and stock is summed, never replaced.
 */
export function buildRestockUpdate(
  existing: Record<string, any>,
  incoming: Record<string, any>,
  addStock: number,
  nowIso: string
): Record<string, any> {
  const existingStock = Number(existing.stock) || 0;
  return {
    ...incoming,
    id: existing.id,
    catalogId: existing.catalogId || incoming.catalogId,
    stock: existingStock + (Number(addStock) || 0),
    lastUpdated: nowIso
  };
}
