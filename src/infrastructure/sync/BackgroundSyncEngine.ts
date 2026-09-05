import { NetworkSentinel } from "../network/NetworkSentinel";
import { IInventoryRepository } from "../../domain/inventory/IInventoryRepository";
import { IndexedDbInventoryRepository } from "../storage/IndexedDbInventoryRepository";
import { IndexedDbB2BOrderRepository } from "../storage/IndexedDbB2BOrderRepository";
import { setDoc, doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
 import { IndexedDBStore } from '../storage/IndexedDBStore';
 import { deriveBatchCost } from '../../utils/cost';

// Max delivery attempts per queued payload before it is parked (kept in the queue,
// never deleted, no longer retried automatically). Prevents infinite retry loops
// against a permanently unavailable endpoint and stops one broken item from
// blocking the rest of the queue forever.
const MAX_PAYLOAD_ATTEMPTS = 5;

export class BackgroundSyncEngine {
 private static instance: BackgroundSyncEngine | null = null;
 public isSyncing: boolean = false;
 public lastSuccessfulSync: Date | null = null;
 private localRepo: IInventoryRepository;
 private b2bRepo: IndexedDbB2BOrderRepository;
 private sentinel: NetworkSentinel;
 private retryTimeoutId: any = null;
 private retryDelayMs: number = 5000;
 private syncCallbacks: ((status: { isSyncing: boolean; lastSync: Date | null; error?: string }) => void)[] = [];
 // In-memory attempt counters, seeded from localStorage so counts survive page reloads.
 private payloadAttempts: Record<string, number> | null = null;

 private constructor(repo?: IInventoryRepository) {
 this.localRepo = repo || new IndexedDbInventoryRepository();
 this.b2bRepo = new IndexedDbB2BOrderRepository();
 this.sentinel = NetworkSentinel.getInstance();

 this.sentinel.onStatusChange(async (isOnline) => {
 if (isOnline) {
 console.log("Network online detected by Sync Engine. Triggering sync loop.");
 await this.triggerSyncLoop().catch(console.error);
 }
 });
 }

 public static getInstance(repo?: IInventoryRepository): BackgroundSyncEngine {
 if (!this.instance) {
 this.instance = new BackgroundSyncEngine(repo);
 } else if (repo) {
 this.instance.localRepo = repo;
 }
 return this.instance;
 }

 public onSyncStateChange(callback: (status: { isSyncing: boolean; lastSync: Date | null; error?: string }) => void): () => void {
 this.syncCallbacks.push(callback);
 callback({ isSyncing: this.isSyncing, lastSync: this.lastSuccessfulSync });
 return () => {
 this.syncCallbacks = this.syncCallbacks.filter(c => c !== callback);
 };
 }

 private notifySyncCallbacks(error?: string): void {
 for (const callback of this.syncCallbacks) {
 try {
 callback({ isSyncing: this.isSyncing, lastSync: this.lastSuccessfulSync, error });
 } catch (err) {
 console.error("Error executing sync state callback:", err);
 }
 }
 }

 public async registerSyncTask(taskType: string, payload: any): Promise<void> {
 if (taskType === 'SYNC_B2B_ORDER') {
 const isOnline = await this.sentinel.verifyTrueInternetHealth();
 if (isOnline) {
 this.triggerSyncLoop().catch(console.error);
 }
 }
 }

 public stop(): void {
 if (this.retryTimeoutId) {
 clearTimeout(this.retryTimeoutId);
 this.retryTimeoutId = null;
 }
 this.isSyncing = false;
 }

 /**
 * Recoverability affordance for parked payloads: clears their attempt counters
 * so the next sync loop retries them. NEVER deletes queued data — parked items
 * remain in the local sync_queue until a real backend accepts them.
 */
 public retryParkedPayloads(): number {
 const attempts = this.getPayloadAttempts();
 const parkedIds = Object.keys(attempts).filter(id => attempts[id] >= MAX_PAYLOAD_ATTEMPTS);
 parkedIds.forEach(id => this.clearPayloadFailures(id));
 if (parkedIds.length > 0) {
 console.log(`BackgroundSyncEngine: ${parkedIds.length} parked payload(s) re-armed for retry.`);
 }
 return parkedIds.length;
 }

 /** Ops visibility: how many queued items are currently parked (failed permanently). */
 public getParkedPayloadCount(): number {
 const attempts = this.getPayloadAttempts();
 return Object.values(attempts).filter(a => a >= MAX_PAYLOAD_ATTEMPTS).length;
 }

 // ---- Payload attempt tracking (failed items stay queued & inspectable) ----

 private getAttemptsKey(): string {
 return `sync_payload_attempts_${IndexedDBStore.getActiveTenantId()}`;
 }

 private getPayloadAttempts(): Record<string, number> {
 if (this.payloadAttempts === null) {
 try {
 this.payloadAttempts = JSON.parse(localStorage.getItem(this.getAttemptsKey()) || "{}");
 } catch {
 this.payloadAttempts = {};
 }
 }
 return this.payloadAttempts;
 }

 private persistPayloadAttempts(): void {
 try {
 localStorage.setItem(this.getAttemptsKey(), JSON.stringify(this.payloadAttempts || {}));
 } catch { /* storage unavailable: counters remain valid in memory for this session */ }
 }

 private recordPayloadFailure(payloadId: string): number {
 const attempts = this.getPayloadAttempts();
 attempts[payloadId] = (attempts[payloadId] || 0) + 1;
 this.persistPayloadAttempts();
 return attempts[payloadId];
 }

 /** Immediately parks a payload that was permanently rejected by the server. */
 private parkPayload(payloadId: string, reason: string): void {
 const attempts = this.getPayloadAttempts();
 attempts[payloadId] = MAX_PAYLOAD_ATTEMPTS;
 this.persistPayloadAttempts();
 console.warn(`BackgroundSyncEngine: payload ${payloadId} parked permanently (${reason}). It remains in the local sync queue for inspection.`);
 }

 private clearPayloadFailures(payloadId: string): void {
 const attempts = this.getPayloadAttempts();
 if (attempts[payloadId] !== undefined) {
 delete attempts[payloadId];
 this.persistPayloadAttempts();
 }
 }

 public async triggerSyncLoop(): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') return;

 if (this.isSyncing) return;

 if (this.retryTimeoutId) {
 clearTimeout(this.retryTimeoutId);
 this.retryTimeoutId = null;
 }

 const isOnline = await this.sentinel.verifyTrueInternetHealth();
 if (!isOnline) {
 console.log("BackgroundSyncEngine: Aborting sync. True internet is not available.");
 this.notifySyncCallbacks("Offline: True internet ping failed.");
 return;
 }

 this.isSyncing = true;
 this.notifySyncCallbacks();

 let transientFailure = false;

 try {
 const queue = await this.localRepo.getSyncQueue();
 const b2bOrders = await this.b2bRepo.getPendingOrders();

 const attempts = this.getPayloadAttempts();
 // Parked payloads (max attempts reached) are skipped but never deleted —
 // EXCEPT legacy ADD_MEDICINE payloads, which are always actionable because
 // they can be fulfilled directly against Firestore (see below).
 const actionablePayloads = queue.filter(p =>
 (attempts[p.id] || 0) < MAX_PAYLOAD_ATTEMPTS ||
 (p.data && p.data.action === 'ADD_MEDICINE')
 );
 const parkedCount = queue.length - actionablePayloads.length;

 if (actionablePayloads.length === 0 && b2bOrders.length === 0) {
 this.isSyncing = false;
 this.lastSuccessfulSync = new Date();
 this.retryDelayMs = 5000;
 if (parkedCount > 0) {
 console.warn(`BackgroundSyncEngine: ${parkedCount} queued payload(s) exceeded max retry attempts and are parked in the local sync queue for inspection.`);
 this.notifySyncCallbacks(`${parkedCount} queued item(s) failed permanently. Data kept locally.`);
 } else {
 this.notifySyncCallbacks();
 }
 return;
 }

 // Sync general payload queue — each payload is isolated so one broken item
 // can no longer block the rest of the queue.
 for (const payload of actionablePayloads) {
 // ---- Legacy ADD_MEDICINE payloads: fulfilled natively against Firestore.
 // Idempotent: if a batch with this intake's batch number already exists,
 // the operation was already applied — just dequeue.
 const pAction = payload.data && payload.data.action;
 const pMed = pAction === 'ADD_MEDICINE' ? payload.data.medicine : null;
 if (pMed) {
 try {
 const tenantId = IndexedDBStore.getActiveTenantId();
 const safeId = String(pMed.id || '').replace(/\//g, '_');
 const batchNumber = String(pMed.batchNumber || 'N/A');
 const batchesRef = collection(db, 'tenants', tenantId, 'storage_inventory', safeId, 'batches');
 const existingBatches = await getDocs(batchesRef);
 const alreadyApplied = existingBatches.docs.some(d => (d.data().batchNumber || '') === batchNumber);

 if (!alreadyApplied) {
 const nowIso = new Date().toISOString();
 const medRef = doc(db, 'tenants', tenantId, 'storage_inventory', safeId);
 const medSnap = await getDoc(medRef);
 const invData = { ...pMed, pharmacyId: tenantId };
 if (medSnap.exists()) {
 const existingStock = medSnap.data().stock || 0;
 await setDoc(medRef, { ...invData, stock: existingStock + Number(pMed.stock || 0), lastUpdated: nowIso }, { merge: true });
 } else {
 await setDoc(medRef, { ...invData });
 }
 const legacyBatchId = `legacy-${payload.id}`;
 await setDoc(doc(db, 'tenants', tenantId, 'storage_inventory', safeId, 'batches', legacyBatchId), {
  batchId: legacyBatchId, medId: safeId, batchNumber,
  expiryDate: new Date(pMed.expiryDate || Date.now() + 31536000000).toISOString(),
  // Cost provenance: legacy records carry no acquisition cost — unknown (0 +
  // estimated), never the selling price (batch-cost-profit fix).
  cost: deriveBatchCost((pMed as any).costPrice).cost,
  costEstimated: deriveBatchCost((pMed as any).costPrice).costEstimated,
  stock: Number(pMed.stock) || 0, isSpoiled: false, lastUpdated: nowIso
 }, { merge: true });
 }

 await this.localRepo.dequeuePayload(payload.id);
 this.clearPayloadFailures(payload.id);
 console.log(`BackgroundSyncEngine: legacy ADD_MEDICINE ${safeId} applied and dequeued.`);
 } catch (medErr: any) {
 transientFailure = true;
 this.recordPayloadFailure(payload.id);
 console.warn('Legacy ADD_MEDICINE fulfillment failed:', medErr?.message);
 }
 continue;
 }

 const controller = new AbortController();
 const timeoutId = setTimeout(() => controller.abort(), 5000);

 try {
 const response = await fetch("/api/v1/sync/reconcile", {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 "X-Vector-Clock": JSON.stringify(payload.vectorClock),
 "X-Causal-Id": payload.id,
 "X-Timestamp": payload.timestamp instanceof Date ? payload.timestamp.toISOString() : new Date(payload.timestamp).toISOString()
 },
 body: JSON.stringify(payload.data),
 signal: controller.signal
 });

 // Success requires a real 200 with a JSON body. Static hosts sometimes
 // answer soft-404s with status 200 + an HTML error page — accepting that
 // as success would silently discard unsent data, which is never allowed.
 const contentType = String(response.headers.get("content-type") || "");
 const isGenuineJsonSuccess = response.status === 200 && contentType.includes("application/json");

 if (isGenuineJsonSuccess) {
 await this.localRepo.dequeuePayload(payload.id);
 this.clearPayloadFailures(payload.id);
 } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
 // Permanent rejection (e.g. 400/404/410): do not retry forever.
 this.parkPayload(payload.id, `server rejected with status ${response.status}`);
 } else {
 transientFailure = true;
 const attemptCount = this.recordPayloadFailure(payload.id);
 if (attemptCount >= MAX_PAYLOAD_ATTEMPTS) {
 console.warn(`BackgroundSyncEngine: payload ${payload.id} reached max retry attempts (${MAX_PAYLOAD_ATTEMPTS}) after status ${response.status}. Parked in queue.`);
 }
 }
 } catch (sendErr: any) {
 // Timeout / network error: transient by nature, counted against the retry cap.
 transientFailure = true;
 const attemptCount = this.recordPayloadFailure(payload.id);
 if (attemptCount >= MAX_PAYLOAD_ATTEMPTS) {
 console.warn(`BackgroundSyncEngine: payload ${payload.id} reached max retry attempts (${MAX_PAYLOAD_ATTEMPTS}) after send failure. Parked in queue.`);
 }
 } finally {
 clearTimeout(timeoutId);
 }
 }

 // Sync B2B Orders (real Firestore path — unchanged behavior)
 for (const order of b2bOrders) {
 try {
 const orderRef = doc(db, "b2b_orders", order.orderId);
 const orderDoc = await getDoc(orderRef);
 if (!orderDoc.exists()) {
 // Ensure we don't upload local syncStatus to Firestore
 const { syncStatus, ...uploadData } = order;
 await setDoc(orderRef, uploadData);
 } else {
 console.log(`Order ${order.orderId} already exists on server. Skipping overwrite.`);
 }
 await this.b2bRepo.markOrderSynced(order.orderId);
 } catch (err: any) {
 console.error(`Failed to sync B2B order ${order.orderId}:`, err?.message);
 transientFailure = true;
 }
 }

 this.isSyncing = false;
 if (!transientFailure) {
 this.lastSuccessfulSync = new Date();
 this.retryDelayMs = 5000;
 this.notifySyncCallbacks();
 } else {
 this.notifySyncCallbacks("Some queued operations could not be delivered yet. Retrying with backoff.");
 this.scheduleBackoffRetry();
 }

 } catch (err: any) {
 console.error("Sync loop halted with error:", err.message);
 this.isSyncing = false;
 this.notifySyncCallbacks(err.message);
 this.scheduleBackoffRetry();
 }
 }

 private scheduleBackoffRetry(): void {
 if (this.retryTimeoutId) return;
 this.retryTimeoutId = setTimeout(async () => {
 this.retryTimeoutId = null;
 this.retryDelayMs = Math.min(this.retryDelayMs * 2, 60000);
 await this.triggerSyncLoop().catch(console.error);
 }, this.retryDelayMs);
 }
}
