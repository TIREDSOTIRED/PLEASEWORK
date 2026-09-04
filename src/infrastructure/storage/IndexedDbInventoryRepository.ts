import { DrugMaster, DrugBatch } from "../../domain/inventory";
import { LedgerEntry } from "../../domain/ledger";
import { IInventoryRepository } from "../../domain/inventory/IInventoryRepository";
import { IndexedDBStore } from "./IndexedDBStore";

export class IndexedDbInventoryRepository implements IInventoryRepository {
 /**
 * Saves or updates a DrugMaster record in IndexedDB.
 */
 public async saveDrugMaster(drug: DrugMaster): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { throw new Error("No active tenant"); }

 const { store } = await IndexedDBStore.getStore("drug_master", "readwrite");
 
 return new Promise<void>((resolve, reject) => {
 const record = {
 id: drug.id,
 gtin: drug.gtin,
 englishName: drug.englishName,
 arabicName: drug.arabicName,
 requiresColdChain: drug.requiresColdChain,
 maxSafeTemperature: drug.maxSafeTemperature
 };

 const request = store.put(record);

 request.onsuccess = () => resolve();
 request.onerror = () => {
 reject(new Error(`Failed to save DrugMaster: ${request.error?.message}`));
 };
 });
 }

 /**
 * Saves or updates a DrugBatch record in IndexedDB.
 */
 public async saveDrugBatch(batch: DrugBatch): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { throw new Error("No active tenant"); }

 const { store } = await IndexedDBStore.getStore("drug_batch", "readwrite");
 
 return new Promise<void>((resolve, reject) => {
 const record = {
 id: batch.id,
 drugMasterId: batch.drugMasterId,
 batchNumber: batch.batchNumber,
 expiryDate: batch.expiryDate,
 ownerBaseCost: batch.ownerBaseCost,
 currentRemainingQuantity: batch.currentRemainingQuantity,
 isSpoiled: batch.isSpoiled
 };

 const request = store.put(record);

 request.onsuccess = () => resolve();
 request.onerror = () => {
 reject(new Error(`Failed to save DrugBatch: ${request.error?.message}`));
 };
 });
 }

 /**
 * Retrieves unspoiled batches for a given drug master ID using the compound IndexedDB index.
 */
 public async getValidBatchesForDrug(drugMasterId: string): Promise<DrugBatch[]> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { return []; }

 // Strict key validation: IDBKeyRange.only throws DataError on non-string keys
 // (callers may pass undefined-adjacent garbage from loose catalog fields).
 if (!drugMasterId || typeof drugMasterId !== 'string' || !drugMasterId.trim()) {
 return [];
 }
 const db = await IndexedDBStore.getDatabase();
 const transaction = db.transaction("drug_batch", "readonly");
 const store = transaction.objectStore("drug_batch");
 
 // Querying unspoiled batches (isSpoiled = false) for the specific drugMasterId
 const index = store.index("drugMasterId_isSpoiled");
 
 try {
 const range = IDBKeyRange.only([drugMasterId, false]);
 
 return new Promise<DrugBatch[]>((resolve, reject) => {
 const request = index.openCursor(range);
 const batches: DrugBatch[] = [];

 request.onsuccess = (event: any) => {
 const cursor = event.target.result;
 if (cursor) {
 const data = cursor.value;
 const batchDate = typeof data.expiryDate === "string" ? new Date(data.expiryDate) : data.expiryDate;
 batches.push(new DrugBatch(
 data.id,
 data.drugMasterId,
 data.batchNumber,
 batchDate,
 data.ownerBaseCost,
 data.currentRemainingQuantity,
 !!data.isSpoiled
 ));
 cursor.continue();
 } else {
 resolve(batches);
 }
 };
 request.onerror = () => {
 reject(new Error(`Failed to retrieve valid batches: ${request.error?.message}`));
 };
 });
 } catch(e) {
 console.warn("Invalid IDBKeyRange parameter", e);
 return [];
 }
 }

 /**
 * Hydrates the global React state by joining drug_master and drug_batch.
 */
 public async hydrateReactState(): Promise<any[]> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { return []; }

 const db = await IndexedDBStore.getDatabase();
 const tx = db.transaction(["drug_master", "drug_batch"], "readonly");
 const masterStore = tx.objectStore("drug_master");
 const batchStore = tx.objectStore("drug_batch");

 const masters: any[] = await new Promise((resolve, reject) => {
 const req = masterStore.getAll();
 req.onsuccess = () => resolve(req.result || []);
 req.onerror = () => reject(req.error);
 });

 const batches: any[] = await new Promise((resolve, reject) => {
 const req = batchStore.getAll();
 req.onsuccess = () => resolve(req.result || []);
 req.onerror = () => reject(req.error);
 });

 return masters.map(master => {
 const drugBatches = batches.filter(b => b.drugMasterId === master.id && !b.isSpoiled);
 const totalStock = drugBatches.reduce((sum, b) => sum + (b.currentRemainingQuantity || 0), 0);
 
 // We take the earliest expiry and batch number from valid batches if any exist
 const sortedBatches = drugBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
 const firstBatch = sortedBatches[0];

 return {
 id: master.id,
 catalogId: master.id,
 name: master.englishName || master.arabicName,
 barcode: master.gtin,
 quantity: totalStock,
 stock: totalStock,
 minThreshold: master.requiresColdChain ? 10 : 5,
 price: firstBatch ? firstBatch.ownerBaseCost * 1.3 : 0, // Roughly standard margin
 expiryDate: firstBatch ? (typeof firstBatch.expiryDate === 'string' ? firstBatch.expiryDate : firstBatch.expiryDate.toISOString()) : new Date().toISOString(),
 location: "",
 shelfLocation: "",
 batchNumber: firstBatch ? firstBatch.batchNumber : "N/A",
 genericName: master.englishName,
 category: "General",
 dosageForm: "Tablet",
 strength: "",
 supplier: "",
 ownerId: "",
 lastUpdated: new Date().toISOString(),
 history: []
 };
 });
 }

 /**
 * Searches local medicine catalog by name or barcode
 */
 public async searchLocalMeds(query: string = ""): Promise<any[]> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { return []; }

 const allMeds = await this.hydrateReactState();
 if (!query) {
 return allMeds.slice(0, 30);
 }
 const lowerQuery = query.toLowerCase().trim();
 return allMeds.filter(med => 
 med.name?.toLowerCase().includes(lowerQuery) || 
 med.barcode?.includes(lowerQuery) ||
 med.genericName?.toLowerCase().includes(lowerQuery)
 ).slice(0, 30);
 }

 /**
 * Commits a ledger entry and updates all affected batches within an atomic readwrite transaction.
 * If any single write fails, the entire transaction is aborted to preserve database integrity.
 */
 public async commitLedgerTransaction(entry: LedgerEntry, updatedBatches: DrugBatch[]): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { throw new Error("No active tenant"); }

 const db = await IndexedDBStore.getDatabase();
 const transaction = db.transaction(["inventory_ledger", "drug_batch"], "readwrite");

 return new Promise<void>((resolve, reject) => {
 transaction.oncomplete = () => {
 resolve();
 };

 transaction.onerror = () => {
 reject(new Error(`Transaction failed and aborted: ${transaction.error?.message || "Unknown error"}`));
 };

 transaction.onabort = () => {
 reject(new Error("Transaction was aborted manually due to write failure."));
 };

 try {
 const ledgerStore = transaction.objectStore("inventory_ledger");
 const batchStore = transaction.objectStore("drug_batch");

 // Write ledger entry
 const plainEntry = {
 id: entry.id,
 batchId: entry.batchId,
 employeeId: entry.employeeId,
 timestamp: entry.timestamp,
 action: entry.action,
 quantity: entry.quantity,
 reportedWholesaleCost: entry.reportedWholesaleCost,
 reportedRetailPrice: entry.reportedRetailPrice,
 ownerBaseCost: entry.ownerBaseCost,
 costVariance: entry.costVariance,
 expectedProfit: entry.expectedProfit
 };

 const ledgerRequest = ledgerStore.put(plainEntry);
 ledgerRequest.onerror = () => {
 transaction.abort();
 };

 // Write updated drug batches
 for (const batch of updatedBatches) {
 const plainBatch = {
 id: batch.id,
 drugMasterId: batch.drugMasterId,
 batchNumber: batch.batchNumber,
 expiryDate: batch.expiryDate,
 ownerBaseCost: batch.ownerBaseCost,
 currentRemainingQuantity: batch.currentRemainingQuantity,
 isSpoiled: batch.isSpoiled
 };

 const batchRequest = batchStore.put(plainBatch);
 batchRequest.onerror = () => {
 transaction.abort();
 };
 }
 } catch (err) {
 transaction.abort();
 reject(err);
 }
 });
 }

 /**
 * Enqueues an un-synced payload to the sync_queue store.
 */
 public async enqueuePayload(payload: {
 id: string;
 timestamp: Date;
 vectorClock: { [nodeId: string]: number };
 data: any;
 }): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { throw new Error("No active tenant"); }

 const { store } = await IndexedDBStore.getStore("sync_queue", "readwrite");

 return new Promise<void>((resolve, reject) => {
 const request = store.put({
 id: payload.id,
 timestamp: payload.timestamp,
 vectorClock: payload.vectorClock,
 data: payload.data
 });

 request.onsuccess = () => resolve();
 request.onerror = () => {
 reject(new Error(`Failed to enqueue sync payload: ${request.error?.message}`));
 };
 });
 }

 /**
 * Retrieves all payloads currently in the sync_queue, sorted chronologically by timestamp index.
 */
 public async getSyncQueue(): Promise<{
 id: string;
 timestamp: Date;
 vectorClock: { [nodeId: string]: number };
 data: any;
 }[]> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { return []; }

 const db = await IndexedDBStore.getDatabase();
 const transaction = db.transaction("sync_queue", "readonly");
 const store = transaction.objectStore("sync_queue");
 const index = store.index("timestamp");

 return new Promise((resolve, reject) => {
 const request = index.openCursor(null, "next"); // ascending order (chronological)
 const results: any[] = [];

 request.onsuccess = (event: any) => {
 const cursor = event.target.result;
 if (cursor) {
 results.push(cursor.value);
 cursor.continue();
 } else {
 resolve(results);
 }
 };

 request.onerror = () => {
 reject(new Error(`Failed to retrieve sync queue: ${request.error?.message}`));
 };
 });
 }

 /**
 * Deletes a payload from the sync_queue upon successful server reconciliation.
 */
 public async dequeuePayload(id: string): Promise<void> {
 if (IndexedDBStore.getActiveTenantId() === 'default') { return; }

 const { store } = await IndexedDBStore.getStore("sync_queue", "readwrite");

 return new Promise<void>((resolve, reject) => {
 const request = store.delete(id);

 request.onsuccess = () => resolve();
 request.onerror = () => {
 reject(new Error(`Failed to dequeue sync payload ${id}: ${request.error?.message}`));
 };
 });
 }
}
