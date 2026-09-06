/**
 * B2B seller resolution — P0 fix for silently-broken purchase orders.
 *
 * The marketplace feed groups offers by the DENORMALIZED seller fields on the
 * offer document (sellerTenantId / sellerName). Legacy offers were written
 * before sellerTenantId existed (or under a tenant that was later renamed or
 * retired), so a PO built from those fields could point at a ghost seller:
 * the buyer sees PENDING forever and the real seller never receives anything.
 *
 * Authoritative source of truth = the live `tenants/{id}` document.
 * An offer is orderable ONLY when its sellerTenantId is a real, non-ghost id
 * AND that tenant document exists. Everything else is "currently unavailable"
 * and must fail LOUDLY instead of creating a broken order.
 */

export const GHOST_SELLER_IDS: ReadonlySet<string> = new Set([
  'wh_default',
  'default-warehouse',
  'unknown-warehouse',
  'dev_warehouse_id',
  'dev_retail_id'
]);

export interface OfferSellerRef {
  sellerTenantId?: string | null;
  sellerName?: string | null;
  offerKind?: string | null;
}

export interface AuthoritativeTenant {
  id: string;
  name?: string;
  displayName?: string;
  tenantType?: string;
  verifiedLocation?: string;
  location?: { city?: string } | string;
}

export type SellerResolution =
  | {
      ok: true;
      sellerTenantId: string;
      sellerName: string;
      sellerCity?: string;
      sellerType: string;
    }
  | { ok: false; reason: 'missing-id' | 'ghost-id' | 'tenant-not-found' };

/** Cheap id-shape check (no I/O) — usable synchronously in UI guards. */
export function isResolvableSellerId(id?: string | null): boolean {
  const v = String(id ?? '').trim();
  return v.length > 0 && !GHOST_SELLER_IDS.has(v);
}

/**
 * Combine an offer's denormalized seller identity with the authoritative
 * tenant document. The live tenant doc wins for id/name/type; the offer's
 * denormalized name is only a display fallback for the moment a doc exists.
 */
export function resolveOfferSeller(
  offer: OfferSellerRef,
  tenantDoc: AuthoritativeTenant | null | undefined
): SellerResolution {
  const id = String(offer.sellerTenantId ?? '').trim();

  if (!id) return { ok: false, reason: 'missing-id' };
  if (GHOST_SELLER_IDS.has(id)) return { ok: false, reason: 'ghost-id' };
  if (!tenantDoc || tenantDoc.id !== id) return { ok: false, reason: 'tenant-not-found' };

  const sellerName =
    tenantDoc.displayName?.trim() ||
    tenantDoc.name?.trim() ||
    String(offer.sellerName ?? '').trim() ||
    'Wholesale Seller';

  const city =
    typeof tenantDoc.location === 'string'
      ? tenantDoc.location
      : tenantDoc.verifiedLocation ||
        tenantDoc.location?.city ||
        undefined;

  return {
    ok: true,
    sellerTenantId: id,
    sellerName,
    sellerCity: city,
    sellerType: tenantDoc.tenantType || 'WHOLESALE_WAREHOUSE'
  };
}
