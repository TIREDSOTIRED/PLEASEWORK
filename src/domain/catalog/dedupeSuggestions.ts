/**
 * P2 #10 — duplicate catalog entries.
 *
 * The master catalog contains the same physical product registered more than
 * once (e.g. ATORVATIN-10 at 90 and 130 SYP from different import batches).
 * Presenting both to a pharmacist forces a blind choice between identical
 * medicines. This helper collapses EXACT duplicates for display:
 *
 *   - same barcode / registeredCode, OR
 *   - same normalized trade name AND same normalized composition
 *
 * It NEVER merges medicines with different identity keys — those are
 * genuinely distinct products and stay distinct. The first occurrence (the
 * catalog's own ordering, cheapest-first in practice) wins.
 */

export interface CatalogLikeEntry {
  id?: string | number;
  catalogId?: string | number;
  code?: string | number;
  barcode?: string | number | null;
  registeredCode?: string | number | null;
  name?: string | null;
  name_en?: string | null;
  tradeNameEn?: string | null;
  composition?: string | null;
  composition_key?: string | null;
  genericName?: string | null;
}

const norm = (v: unknown): string =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const identityKeyOf = (e: CatalogLikeEntry): string | null => {
  const barcode = norm(e.barcode || e.registeredCode);
  if (barcode) return `bc:${barcode}`;
  const trade = norm(e.tradeNameEn || e.name_en || e.name);
  const comp = norm(e.composition || e.composition_key || e.genericName);
  if (trade && comp) return `nm:${trade}|${comp}`;
  if (trade) return `nm:${trade}`;
  return null;
};

/** Remove exact-duplicate catalog entries, preserving original order. */
export function dedupeCatalogSuggestions<T extends CatalogLikeEntry>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries || []) {
    const key = identityKeyOf(e);
    const docKey = `doc:${norm(e.id ?? e.catalogId ?? e.code)}`;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    seen.add(docKey); // different docs of the SAME product are still duplicates
    out.push(e);
  }
  return out;
}
