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

   // FRESH-DB FALLBACK: a schema-version upgrade (v2→v3) BLOCKS while any
   // other tab holds an older connection — often for hours on phones with
   // background tabs — which killed sync ("خطأ في المزامنة") and intake
   // mirror saves on the device. The mirror is disposable (Firestore is the
   // source of truth), so on blocked/timeout we simply open a MIGRATED
   // suffixed database that no legacy connection can block, once per tenant.
   return this.openNamed(dbName).catch((err: Error) => {
   if (this.migratedTenants.has(tenantId)) throw err;
   this.migratedTenants.add(tenantId);
   console.warn('[idb] open blocked/timed out — falling back to migrated database:', err.message);
   const fallbackName = `${dbName}_m3`;
   const p = this.openNamed(fallbackName);
   this.instances.set(tenantId, p);
   return p;
   }).then((db) => {
   const p = Promise.resolve(db);
   this.instances.set(tenantId, p);
   return db;
   });
  }

  private static migratedTenants: Set<string> = new Set();

  private static openNamed(dbName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
  // Access standard indexedDB
  const indexedDB = window.indexedDB || (window as any).mozIndexedDB || (window as any).webkitIndexedDB || (window as any).msIndexedDB;
  if (!indexedDB) {
  reject(new Error("Your browser does not support a stable version of IndexedDB."));
  return;
  }

  const request = indexedDB.open(dbName, this.DB_VERSION);

  // WATCHDOG — reject fast on blocked upgrades or stuck opens instead of
  // hanging every repo call forever. Callers treat the mirror as
  // best-effort; Firestore (the source of truth) is never gated here.
  const settled = { done: false };
  const watchdog = setTimeout(() => {
  if (!settled.done) {
  settled.done = true;
  reject(new Error("IndexedDB open timed out (likely an upgrade blocked by another tab)."));
  }
  }, 8000);

  request.onblocked = () => {
  if (!settled.done) {
  settled.done = true;
  clearTimeout(watchdog);
  reject(new Error("IndexedDB upgrade blocked by another tab."));
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
