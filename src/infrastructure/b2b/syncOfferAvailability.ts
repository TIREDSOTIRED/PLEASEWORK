import { db } from '../firebase';
import {
  doc,
  getDoc,
  getDocs,
  query,
  where,
  collection,
  increment
} from 'firebase/firestore';
import type { DocumentData, DocumentReference, WriteBatch } from 'firebase/firestore';

/**
 * Option B (offer-stock propagation): mirror an inventory delta onto the
 * wholesale offer(s) of the same SKU so «المخزون المعروض» tracks real stock
 * across POS sales, external sales, stock corrections, intake and B2B
 * dispatch — closing the 395-vs-402 drift class found in QA.
 *
 * - Primary target: the deterministic offer id every publisher writes under
 *   (`off_{tenantId}_{safeCatalogId}` — WarehouseOffersTab + SurplusPublishModal).
 *   Fallback: legacy docs from older builds, located by
 *   sellerTenantId + catalogId + active (same shape as the old dispatch sync).
 * - The normal path writes increment(±delta) inside the CALLER's writeBatch:
 *   atomic with the inventory mutation, and immune to the lost-update race
 *   the old read-then-write-absolute dispatch code had.
 * - Floor guard: when a decrement would take availability to <= 0 the helper
 *   writes an absolute 0 + active:false instead. That rare branch trades the
 *   increment race for a correct floor — the offer can never sit negative or
 *   stay active with nothing behind it.
 * - Never creates offer documents: stock movement on a medicine with no
 *   offer is a no-op (a bare increment would create a husk doc missing
 *   sellerTenantId/catalogId and surface as a garbage marketplace card).
 * - All read failures are swallowed: offer sync must never abort or gate the
 *   inventory mutation that triggered it (offline POS sales rely on this).
 *
 * Callers must await this BEFORE batch.commit() so the offer write joins the
 * same atomic batch as the inventory deduction.
 */
export async function syncOffersInBatch(spec: {
  batch: WriteBatch;
  tenantId: string;
  safeCatalogId: string;
  delta: number;
}): Promise<void> {
  const { batch, tenantId, safeCatalogId, delta } = spec;
  if (!db || !tenantId || !safeCatalogId || !Number(delta)) return;
  const nowIso = new Date().toISOString();
  try {
    const primaryRef = doc(db, 'wholesale_offers', `off_${tenantId}_${safeCatalogId}`);
    const primarySnap = await getDoc(primaryRef);
    if (primarySnap.exists()) {
      applyAvailabilityDelta(batch, primaryRef, primarySnap.data(), delta, nowIso);
      return;
    }
    // Legacy fallback: older builds published under different doc ids.
    const legacySnap = await getDocs(query(
      collection(db, 'wholesale_offers'),
      where('sellerTenantId', '==', tenantId),
      where('catalogId', '==', safeCatalogId),
      where('active', '==', true)
    ));
    legacySnap.forEach(offerDoc => {
      if (offerDoc.id === primaryRef.id) return;
      applyAvailabilityDelta(batch, offerDoc.ref, offerDoc.data(), delta, nowIso);
    });
  } catch (err) {
    console.warn('Offer availability sync skipped:', err);
  }
}

function applyAvailabilityDelta(
  batch: WriteBatch,
  offerRef: DocumentReference<DocumentData>,
  data: DocumentData,
  delta: number,
  nowIso: string
): void {
  const current = Number(data.availableQuantity ?? data.stock ?? 0) || 0;
  if (delta < 0 && current + delta <= 0) {
    // Floor: drain to zero and deactivate so buyers stop seeing a dead offer.
    batch.set(offerRef, {
      availableQuantity: 0,
      stock: 0,
      active: false,
      updatedAt: nowIso
    }, { merge: true });
    return;
  }
  batch.set(offerRef, {
    availableQuantity: increment(delta),
    stock: increment(delta),
    updatedAt: nowIso
  }, { merge: true });
}
