import { writeBatch, doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { MetadataChange } from '../../domain/inventory/metadataEdits';

/**
 * Persist a metadata-only correction to ONE existing batch.
 *
 * - Never touches stock, never creates a batch — corrects the batch doc in place.
 * - Atomic: batch update + inventory_audit_logs entry in one commit (same
 *   pattern as DiscrepancyReconciliationModal).
 * - Callers must pass the exact `writes` payload from planBatchMetadataUpdate.
 */
export async function updateBatchMetadata(args: {
  tenantId: string;
  medId: string;
  batchId: string;
  /** Whitelisted, pre-validated writes (cost/costEstimated/batchNumber/expiryDate only). */
  writes: Record<string, unknown>;
  /** from/to trail for the audit log (from the same plan). */
  changes: Array<MetadataChange>;
  userEmail?: string;
}): Promise<void> {
  if (!db) throw new Error('Database unavailable (offline build)');
  if (!args.changes.length) return; // nothing to persist

  const wb = writeBatch(db);
  wb.update(
    doc(db, 'tenants', args.tenantId, 'storage_inventory', args.medId, 'batches', args.batchId),
    { ...args.writes, lastUpdated: new Date().toISOString() }
  );
  wb.set(doc(collection(db, 'tenants', args.tenantId, 'inventory_audit_logs')), {
    type: 'BATCH_METADATA',
    medId: args.medId,
    batchId: args.batchId,
    changes: args.changes,
    userEmail: args.userEmail || 'unknown',
    timestamp: serverTimestamp()
  });
  await wb.commit();
}
