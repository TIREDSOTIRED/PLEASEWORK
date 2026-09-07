export class IndexedDBStore {
 private static instances = new Map<string, Promise<IDBDatabase>>();
 private static activeTenantId: string = "default";
 private static readonly DB_VERSION = 3;

 public static setTenant(tenantId: string) {
 this.activeTenantId = tenantId;
 }

 public static getActiveTenantId(): string {
 return this.activeTenantId;
 }

 /**
 * Initializes the database in a thread-safe, promise-based manner.
 * Multiple concurrent calls will resolve to the same IDBDatabase promise instance.
 */
 public static getDatabase(): Promise<IDBDatabase> {
  const tenantId = this.activeTenantId;
  if (this.instances.has(tenantId)) {
  return this.instances.get(tenantId)!;
  }

  const dbName = `saidalete_local_db_${tenantId}`;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
  // Access standard indexedDB
  const indexedDB = window.indexedDB || (window as any).mozIndexedDB || (window as any).webkitIndexedDB || (window as any).msIndexedDB;
  if (!indexedDB) {
  reject(new Error("Your browser does not support a stable version of IndexedDB."));
  return;
  }

  const request = indexedDB.open(dbName, this.DB_VERSION);

  // WATCHDOG — a version upgrade BLOCKS while any other tab holds an older
  // connection, and an 'open' that never settles hangs every repo call
  // forever (the phone bug: Add Medicine silently swallowed, mirror-only
  // card wiped on reload). The mirror must FAIL FAST, not hang: reject
  // after 8s or on 'blocked'. Callers treat the mirror as best-effort;
  // Firestore (the source of truth) is never gated on this promise.
  const settled = { done: false };
  const watchdog = setTimeout(() => {
  if (!settled.done) {
  settled.done = true;
  reject(new Error("IndexedDB open timed out (likely an upgrade blocked by another tab — mirror disabled this session; Firestore continues)."));
  }
  }, 8000);

  request.onblocked = () => {
  if (!settled.done) {
  settled.done = true;
  clearTimeout(watchdog);
  reject(new Error("IndexedDB upgrade blocked by another tab. Close other app tabs and reload — Firestore continues meanwhile."));
  }
  };

  request.onerror = (event: any) => {
  if (!settled.done) {
  settled.done = true;
  clearTimeout(watchdog);
  reject(new Error(`Failed to open IndexedDB: ${request.error?.message || event.target.errorCode}`));
  }
  };

  request.onsuccess = () => {
  if (!settled.done) {
  settled.done = true;
  clearTimeout(watchdog);
  resolve(request.result);
  }
  };

  request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
  const db = request.result;

  // 1. drug_master store
  if (!db.objectStoreNames.contains("drug_master")) {
  const drugMasterStore = db.createObjectStore("drug_master", { keyPath: "id" });
  // V3: gtin is NO LONGER unique — the master catalog legitimately contains
  // multiple sako entries sharing one barcode (and comma variants); a unique
  // index made every duplicate-barcode mirror save throw and, worse, abort
  // the authoritative Firestore intake write (POS scan-to-add bug).
  drugMasterStore.createIndex("gtin", "gtin", { unique: false });
  } else if (event.oldVersion < 3) {
  // Upgrade v2 → v3: drop the unique gtin index, recreate it non-unique.
  const drugMasterStore = request.transaction!.objectStore("drug_master");
  if (drugMasterStore.indexNames.contains("gtin")) drugMasterStore.deleteIndex("gtin");
  drugMasterStore.createIndex("gtin", "gtin", { unique: false });
  }

 // 2. drug_batch store
 if (!db.objectStoreNames.contains("drug_batch")) {
 const drugBatchStore = db.createObjectStore("drug_batch", { keyPath: "id" });
 drugBatchStore.createIndex("drugMasterId", "drugMasterId", { unique: false });
 drugBatchStore.createIndex("expiryDate", "expiryDate", { unique: false });
 // Compound index [drugMasterId, isSpoiled]
 drugBatchStore.createIndex("drugMasterId_isSpoiled", ["drugMasterId", "isSpoiled"], { unique: false });
 }

 // 3. inventory_ledger store
 if (!db.objectStoreNames.contains("inventory_ledger")) {
 const ledgerStore = db.createObjectStore("inventory_ledger", { keyPath: "id" });
 ledgerStore.createIndex("timestamp", "timestamp", { unique: false });
 }

 // 4. sync_queue store
 if (!db.objectStoreNames.contains("sync_queue")) {
 const syncQueueStore = db.createObjectStore("sync_queue", { keyPath: "id" });
 syncQueueStore.createIndex("timestamp", "timestamp", { unique: false });
 }
 
 // 5. pending_orders store
 if (!db.objectStoreNames.contains("pending_orders")) {
 const ordersStore = db.createObjectStore("pending_orders", { keyPath: "orderId" });
 ordersStore.createIndex("status", "status", { unique: false });
 ordersStore.createIndex("createdAt", "createdAt", { unique: false });
 }
 
 // 6. pos_transactions store
 if (!db.objectStoreNames.contains("pos_transactions")) {
 const posTransactionsStore = db.createObjectStore("pos_transactions", { keyPath: "transactionId" });
 posTransactionsStore.createIndex("status", "status", { unique: false });
 posTransactionsStore.createIndex("createdAt", "createdAt", { unique: false });
 }
 };
 });

 // Cache the open attempt, but evict it on rejection so a transient
 // failure (private mode, storage pressure, version error) can be retried
 // on the next call instead of poisoning this tenant's DB until reload.
 promise.catch(() => {
 if (this.instances.get(tenantId) === promise) {
 this.instances.delete(tenantId);
 }
 });

 this.instances.set(tenantId, promise);
 return promise;
 }

 /**
 * Helper to execute a database operation wrapped in a Promise.
 */
 public static async getStore(
 storeName: "drug_master" | "drug_batch" | "inventory_ledger" | "sync_queue" | "pending_orders" | "pos_transactions",
 mode: IDBTransactionMode = "readonly"
 ): Promise<{ transaction: IDBTransaction; store: IDBObjectStore }> {
 const db = await this.getDatabase();
 const transaction = db.transaction(storeName, mode);
 const store = transaction.objectStore(storeName);
 return { transaction, store };
 }
}
