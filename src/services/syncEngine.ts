import { openDB, DBSchema, IDBPDatabase, deleteDB } from 'idb';
import { SupabaseClient } from '@supabase/supabase-js';

interface PharmacyDB extends DBSchema {
 localMeds: {
 key: string;
 value: any;
 indexes: {
 'by-barcode': string;
 'by-name': string;
 'by-company': string;
 };
 };
}

const DB_NAME = 'PharmacyAppDB';
const STORE_NAME = 'localMeds';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PharmacyDB>> | null = null;

// ---------------------------------------------------------------------------
// Derived search fields: written once per record during catalog sync so the
// hot search paths never re-run Arabic/diacritic regex normalization per row.
// Legacy rows written before this field existed simply fall back to live
// normalization (identical results, old cost) until the next re-sync.
// ---------------------------------------------------------------------------
export function withDerivedSearchFields<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    _sn: normalizeSearchText((item as any).name),
    _se: normalizeSearchText((item as any).nameEn),
    _sc: normalizeSearchText((item as any).company_name),
    _sk: normalizeSearchText((item as any).composition_key),
    _sb: normalizeSearchText((item as any).barcode)
  };
}

/** Shared normalization used for company identity keys (filter values). */
export function normalizeCompanyKey(rawCompany: any): string {
  const clean = String(rawCompany ?? 'Unknown Manufacturer').trim();
  let normalizedKey = clean.toLowerCase();
  normalizedKey = normalizedKey.replace(/[.,\/#!$%\^&\*;:{}=\-_~()]/g, " ");
  normalizedKey = normalizedKey.replace(/\b(pharma|pharmaceuticals|laboratories|laboratory|labs|ltd|inc|co|company|s\.?a\.?r\.?l\.?|llc|s\.?a\.?)\b/gi, ' ');
  return normalizedKey.replace(/\s+/g, ' ').trim();
}

function createStores(db: IDBPDatabase<PharmacyDB>) {
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    const store = db.createObjectStore(STORE_NAME, { keyPath: 'sako' });
    store.createIndex('by-barcode', 'barcode');
    store.createIndex('by-name', 'name');
    store.createIndex('by-company', 'company_name');
  }
}

export async function getDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      let db = await openDB<PharmacyDB>(DB_NAME, DB_VERSION, { upgrade: createStores });
      // Recovery: a DB that already exists at DB_VERSION but WITHOUT its store
      // never re-runs the upgrade callback (same-version opens skip upgrade)
      // and stays permanently empty — every catalog operation then throws.
      // The store is this DB's only content, so deleting the empty shell and
      // reopening once is lossless and involves no version/schema migration.
      // If another tab blocks the deletion, fall back to the as-is handle so
      // behavior is no worse than before (downstream catch paths apply).
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        try {
          db.close();
          await Promise.race([
            deleteDB(DB_NAME),
            new Promise(resolve => setTimeout(resolve, 3000))
          ]);
          db = await openDB<PharmacyDB>(DB_NAME, DB_VERSION, { upgrade: createStores });
        } catch (e) {
          console.error('[syncEngine] Storeless catalog DB recovery failed:', e);
        }
      }
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Syncs the catalog from Supabase in batches to bypass the 1,000 row limit.
 */

let isSyncInProgress = false;

export interface CatalogSyncState {
 status: 'NOT_STARTED' | 'SYNCING' | 'PARTIAL' | 'COMPLETE' | 'FAILED';
 lastSako: number;
 loadedCount: number;
 total: number;
}

export function getCatalogSyncState(): CatalogSyncState {
 try {
 const raw = localStorage.getItem('CATALOG_SYNC_STATE');
 if (raw) {
 return JSON.parse(raw);
 }
 } catch (e) {
 console.error("Failed to parse sync state", e);
 }
 return { status: 'NOT_STARTED', lastSako: 0, loadedCount: 0, total: 0 };
}

export function setCatalogSyncState(state: CatalogSyncState) {
 localStorage.setItem('CATALOG_SYNC_STATE', JSON.stringify(state));
}

export async function syncCatalogFromSupabase(
 supabase: SupabaseClient,
 onProgressCallback: (loadedCount: number, estimatedTotal: number) => void,
 onLog: (msg: string, type: 'info' | 'error' | 'success') => void
): Promise<void> {
 if (isSyncInProgress) {
 onLog("Sync is already in progress. Ignoring concurrent request.", 'info');
 return;
 }
 isSyncInProgress = true;

 const BATCH_SIZE = 1000;
 
 try {
 let state = getCatalogSyncState();

 onLog("Connecting to Supabase table 'MEDS'...", 'info');
 
 // 1. Get total count to ensure accuracy
 const { count, error: countError } = await supabase
 .from('MEDS')
 .select('*', { count: 'exact', head: true });

 if (countError) {
 state.status = 'FAILED';
 setCatalogSyncState(state);
 onLog(`Database Connection: FAILED - ${countError.message} (Code: ${countError.code})`, 'error');
 if (countError.details) {
 onLog(`Details: ${countError.details}`, 'error');
 }
 throw countError;
 }

 if (count === 0 || count === null) {
 onLog(`Database Connection: SUCCESS, but total remote records found is ${count}. Sync stopped.`, 'error');
 throw new Error(`No records found in remote database.`);
 }

  onLog(`Database Connection: SUCCESS`, 'success');
  onLog(`Remote catalog connected.`, 'info');

 const db = await getDB();
 const localTotal = await db.count(STORE_NAME);

 // If completely done
 if (state.status === 'COMPLETE') {
 if (localTotal >= count) {
 onLog(`Catalog already fully synchronized (${localTotal}/${count}).`, 'success');
 onProgressCallback(count, count);
 return;
 } else {
 onLog(`Resuming catalog setup...`, 'info');
 state.status = 'PARTIAL';
 }
 }

 // Initialize or resume
 state.total = count;
 state.status = 'SYNCING';
 setCatalogSyncState(state);

 let lastSako = state.lastSako || 0;
 let loadedCount = state.loadedCount || 0;
 
 // Fallback: if IndexedDB was wiped but localStorage wasn't, reset
 if (localTotal === 0 && lastSako > 0) {
 lastSako = 0;
 loadedCount = 0;
 }

 onProgressCallback(loadedCount, count);
 
 // 2. Fetch in batches using keyset pagination
 while (true) {
 onLog(`Fetching chunk (after sako: ${lastSako})...`, 'info');

 const { data, error } = await supabase
 .from('MEDS')
 .select('*')
 .order('sako', { ascending: true })
 .gt('sako', lastSako)
 .limit(BATCH_SIZE);

 if (error) {
 state.status = 'FAILED';
 setCatalogSyncState(state);
 onLog(`Error fetching chunk: ${error.message} (Code: ${error.code})`, 'error');
 if (error.details) {
 onLog(`Details: ${error.details}`, 'error');
 }
 throw error;
 }

 if (!data || data.length === 0) {
 onLog("No more data received. Finishing sync.", 'info');
 break;
 }
 
 onLog(`Received ${data.length} rows. Writing to IndexedDB...`, 'info');

 // Bulk insert into IndexedDB
 const tx = db.transaction(STORE_NAME, 'readwrite');
 const store = tx.objectStore(STORE_NAME);
 
 for (const item of data) {
  await store.put(withDerivedSearchFields(item));
 }
 
 await tx.done;

// Catalog content changed: the companies cache must be rebuilt.
invalidateCompaniesCache();

 // Update checkpoint after successful write
 lastSako = data[data.length - 1].sako;
 loadedCount += data.length;

 state.lastSako = lastSako;
 state.loadedCount = loadedCount;
 state.status = 'PARTIAL';
 setCatalogSyncState(state);

  const currentLocalTotal = await db.count(STORE_NAME);
  onLog(`Batch saved for offline use.`, 'success');

 onProgressCallback(loadedCount, count);

 if (data.length < BATCH_SIZE) {
 // Last batch
 break;
 }
 }

 // Verify completeness
 const finalLocalTotal = await db.count(STORE_NAME);
 if (finalLocalTotal >= count) {
 state.status = 'COMPLETE';
 setCatalogSyncState(state);
 onLog(`Catalog ready for offline use.`, 'success');
 } else {
 onLog(`Catalog setup incomplete — will resume automatically.`, 'error');
 }

 } catch (err: any) {
 onLog(`Sync process failed: ${err.message || String(err)}`, 'error');
 throw err; // Re-throw to let the caller handle UI state
 } finally {
 isSyncInProgress = false;
 }
}

/**
 * Returns all medicines from the local IndexedDB, optionally limited by count.
 * Used for full directory views where we want everything.
 */
export async function getAllLocalMeds(maxResults?: number): Promise<any[]> {
 try {
 const db = await getDB();
 const tx = db.transaction(STORE_NAME, 'readonly');
 const store = tx.objectStore(STORE_NAME);
 let cursor = await store.openCursor();
 const results: any[] = [];
 
 while (cursor && (maxResults === undefined || results.length < maxResults)) {
 results.push(cursor.value);
 cursor = await cursor.continue();
 }
 return results;
 } catch (err) {
 console.error("Failed to get all local meds:", err);
 return [];
 }
}

/**
 * Returns all unique companies/manufacturers from the IndexedDB.
 * Result is cached per session; the cache is invalidated whenever catalog
 * synchronization writes new records (never stale across syncs).
 */
let companiesCache: { name: string, count: number }[] | null = null;

export function invalidateCompaniesCache(): void {
  companiesCache = null;
}

export async function getUniqueCompaniesLocal(): Promise<{ name: string, count: number }[]> {
  if (companiesCache) {
    return companiesCache;
  }
  try {
  const db = await getDB();
  // KEY-ONLY pass over the 'by-company' index: counts entries per normalized
  // company key WITHOUT deserializing any record bodies. The legacy full-cursor
  // scan normalized `MANUFACTURER || manufacturer || Manufacturer || COMPANY ||
  // company || company_name`, but synced MEDS rows only ever carry
  // `company_name`, so the index keys are the complete picture — the only rows
  // missing from the index are those with NULL/empty company_name, which the
  // legacy fallback bucketed under 'Unknown Manufacturer'.
  const totalRows = await db.count(STORE_NAME);
  const tx = db.transaction(STORE_NAME, 'readonly');
  const companyIndex = tx.objectStore(STORE_NAME).index('by-company');
  const map = new Map<string, number>();
  const bump = (key: string) => map.set(key, (map.get(key) || 0) + 1);
  let keyCursor = await companyIndex.openKeyCursor();
  let indexedEntries = 0;
  while (keyCursor) {
  indexedEntries++;
  const raw = keyCursor.key;
  if (typeof raw === 'string' && raw.trim() !== '') {
  bump(normalizeCompanyKey(raw) || 'Unknown');
  } else {
  // Empty-string keys and non-string values were falsy in the legacy
  // chain, i.e. they landed in the same 'Unknown Manufacturer' bucket.
  bump('unknown manufacturer');
  }
  keyCursor = await keyCursor.continue();
  }
  const unindexed = totalRows - indexedEntries;
  if (unindexed > 0) bump('unknown manufacturer');

  companiesCache = Array.from(map.entries()).map(([k, v]) => ({ name: k, count: v }));
  return companiesCache;
  } catch (err) {
  console.error("Failed to get unique companies:", err);
  return [];
  }
}
export async function countLocalMeds(): Promise<number> {
 try {
 const db = await getDB();
 return await db.count(STORE_NAME);
 } catch (err) {
 console.error('Error counting local meds:', err);
 return 0;
 }
}

/**
 * Normalizes a barcode string while strictly preserving leading zeroes and string type.
 */
export function normalizeBarcode(barcode: string | number | null | undefined): string {
 if (barcode === null || barcode === undefined) return '';
 return String(barcode)
 .trim()
 .replace(/[\r\n\t]/g, '')
 .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width characters
 .replace(/^['"]+|['"]+$/g, '') // strip surrounding quotes
 .replace(/,$/, '')
 .trim();
}

/**
 * Finds a medicine by barcode in the local IndexedDB (PharmacyAppDB -> localMeds).
 * Searches via index first, and falls back to scanning cursor for comma-separated barcodes, GTINs, or sako.
 */
export async function findLocalMedByBarcode(rawBarcode: string | number): Promise<any | null> {
 const code = normalizeBarcode(rawBarcode);
 if (!code) return null;

 const strippedCode = code.replace(/^0+/, '');

 try {
 const db = await getDB();
 const tx = db.transaction(STORE_NAME, 'readonly');
 const store = tx.objectStore(STORE_NAME);

 // 1. Direct index lookup on 'by-barcode'
 try {
 const index = store.index('by-barcode');
 const directMatch = await index.get(code);
 if (directMatch) {
 return directMatch;
 }
 if (strippedCode && strippedCode !== code) {
 const strippedMatch = await index.get(strippedCode);
 if (strippedMatch) return strippedMatch;
 }
 } catch (e) {
 // index might be missing or error
 }

 // 2. Direct sako lookup (numeric or string key)
 try {
 const sakoNum = Number(code);
 if (!isNaN(sakoNum) && sakoNum > 0) {
 const sakoMatch = await store.get(sakoNum as any);
 if (sakoMatch) return sakoMatch;
 }
 const sakoStrMatch = await store.get(code as any);
 if (sakoStrMatch) return sakoStrMatch;
 } catch (e) {}

 // 2.5. KEY-ONLY scan of the by-barcode index: catches multi-code
 // ("a,b;c"), formatted or zero-padded barcode strings WITHOUT
 // deserializing 20k+ record bodies — index keys are plain strings.
 // Matching rules mirror the legacy fallback exactly; barcodes stay
 // strings end-to-end (never Number()/parseInt()).
 try {
 const barcodeIndex = store.index('by-barcode');
 let keyCursor = await barcodeIndex.openKeyCursor();
 const hitPrimaryKeys: IDBValidKey[] = [];
 while (keyCursor) {
 const bcRaw = typeof keyCursor.key === 'string' ? keyCursor.key : String(keyCursor.key ?? '');
 if (bcRaw) {
 const normBc = normalizeBarcode(bcRaw);
 let matched = normBc === code || (strippedCode !== '' && normBc.replace(/^0+/, '') === strippedCode);
 if (!matched && (bcRaw.includes(',') || bcRaw.includes(' ') || bcRaw.includes(';'))) {
 const parts = bcRaw.split(/[,;\s]+/).map(normalizeBarcode);
 matched = parts.includes(code) || (strippedCode !== '' && parts.some(p => p.replace(/^0+/, '') === strippedCode));
 }
 if (matched) hitPrimaryKeys.push(keyCursor.primaryKey);
 }
 keyCursor = await keyCursor.continue();
 }
 for (const pk of hitPrimaryKeys) {
 const rec = await store.get(pk as any);
 if (rec) return rec;
 }
 } catch (e) {
 // index might be missing or error — legacy full scan below still covers it
 }

 // 3. Scan cursor for comma-separated barcodes, formatted barcodes, GTINs, or code fields
 let cursor = await store.openCursor();
 while (cursor) {
 const item = cursor.value;
 if (item) {
 // Barcode check
 const itemBc = item.barcode !== undefined && item.barcode !== null ? String(item.barcode) : '';
 if (itemBc) {
 const normItemBc = normalizeBarcode(itemBc);
 if (normItemBc === code) {
 return item;
 }
 if (strippedCode && normItemBc.replace(/^0+/, '') === strippedCode) {
 return item;
 }
 if (itemBc.includes(',') || itemBc.includes(' ') || itemBc.includes(';')) {
 const splitCodes = itemBc.split(/[,;\s]+/).map(normalizeBarcode);
 if (splitCodes.includes(code)) {
 return item;
 }
 if (strippedCode && splitCodes.some(c => c.replace(/^0+/, '') === strippedCode)) {
 return item;
 }
 }
 }

 // Code / GTIN check
 const itemCode = item.code !== undefined && item.code !== null ? String(item.code) : '';
 if (itemCode) {
 const normItemCode = normalizeBarcode(itemCode);
 if (normItemCode === code || (strippedCode && normItemCode.replace(/^0+/, '') === strippedCode)) {
 return item;
 }
 }

 const itemGtin = item.gtin !== undefined && item.gtin !== null ? String(item.gtin) : '';
 if (itemGtin) {
 const normGtin = normalizeBarcode(itemGtin);
 if (normGtin === code || (strippedCode && normGtin.replace(/^0+/, '') === strippedCode)) {
 return item;
 }
 }

 // Sako check
 const itemSako = item.sako !== undefined && item.sako !== null ? String(item.sako) : '';
 if (itemSako && (itemSako.trim() === code || itemSako.trim() === strippedCode)) {
 return item;
 }

 // ID check
 const itemId = item.id !== undefined && item.id !== null ? String(item.id) : '';
 if (itemId && (itemId.trim() === code || itemId.trim() === strippedCode)) {
 return item;
 }
 }
 cursor = await cursor.continue();
 }

 return null;
 } catch (err) {
 console.error('Error in findLocalMedByBarcode:', err);
 return null;
 }
}

/**
 * Searches the local IndexedDB using a fuzzy match on name or company_name, 
 * or an exact match on barcode.
 */

export function normalizeSearchText(text: string | null | undefined): string {
 if (!text) return '';
 return String(text)
 .toLowerCase()
 .trim()
 .replace(/[\u064B-\u065F]/g, '') // Remove diacritics
 .replace(/\u0640/g, '') // Remove tatweel
 .replace(/[أإآ]/g, 'ا') // Normalize Alif
 .replace(/ة/g, 'ه') // Normalize Teh Marbuta to Heh
 .replace(/ي/g, 'ى'); // Normalize Yeh to Alef Maksura
}

export async function searchLocalMeds(searchTerm: string, maxResults: number = 50, companyFilter?: string): Promise<any[]> {
  try {
  const db = await getDB();
  const term = normalizeSearchText(searchTerm);
  
  // Exact English check
  const isExactEnglishMatch = (val: any) => val ? String(val).toLowerCase().trim() === searchTerm.toLowerCase().trim() : false;

  // Per-row field accessor: prefers the precomputed derived fields (_sn/_se/
  // _sc/_sk/_sb) written during catalog sync; legacy rows without them fall
  // back to live normalization with IDENTICAL results (old cost only).
  const fieldsOf = (item: any) => ({
  normName: item._sn !== undefined ? item._sn : normalizeSearchText(item.name),
  normNameEn: item._se !== undefined ? item._se : normalizeSearchText(item.nameEn),
  normCompany: item._sc !== undefined ? item._sc : normalizeSearchText(item.company_name),
  normComposition: item._sk !== undefined ? item._sk : normalizeSearchText(item.composition_key),
  normBarcode: item._sb !== undefined ? item._sb : normalizeSearchText(item.barcode)
  });
  
  // Advanced ranking queues
  const exactMatches: any[] = [];
  const exactEnglishMatches: any[] = [];
  const startsWithMatches: any[] = [];
  const containsMatches: any[] = [];

  const classify = (item: any) => {
  const f = fieldsOf(item);

  if (term === '') {
  containsMatches.push(item);
  return;
  }

  if (f.normName === term) {
  exactMatches.push(item);
  } else if (isExactEnglishMatch(item.nameEn)) {
  exactEnglishMatches.push(item);
  } else if (f.normName.startsWith(term) || f.normNameEn.startsWith(term)) {
  startsWithMatches.push(item);
  } else {
  const match =
  f.normBarcode.includes(term) ||
  f.normName.includes(term) ||
  f.normNameEn.includes(term) ||
  f.normCompany.includes(term) ||
  f.normComposition.includes(term);
  if (match) containsMatches.push(item);
  }
  };

  if (companyFilter) {
  // -----------------------------------------------------------------
  // Company-filtered path via the EXISTING 'by-company' index.
  // The index stores RAW company_name values while callers pass the
  // normalized company key, so we first resolve matching raw keys with a
  // KEY-ONLY cursor pass (no record-body deserialization; distinct
  // companies number in the hundreds, not 22k), then stream only that
  // company's records through the identical ranking classifier.
  // -----------------------------------------------------------------
  const tx = db.transaction(STORE_NAME, 'readonly');
  const companyIndex = tx.objectStore(STORE_NAME).index('by-company');
  let keyCursor = await companyIndex.openKeyCursor();
  const rawKeys: IDBValidKey[] = [];
  // A raw company key appears in the index ONCE PER ROW (hundreds of duplicate
  // entries for large manufacturers). Each distinct raw key must be queried
  // exactly once or every row gets classified once per duplicate entry
  // (n² work and duplicated results — e.g. a 561-row company produced
  // 561 copies of each product and a ~60s load).
  const seenRawKeys = new Set<string>();
  while (keyCursor) {
  if (normalizeCompanyKey(keyCursor.key) === companyFilter && !seenRawKeys.has(String(keyCursor.key))) {
  seenRawKeys.add(String(keyCursor.key));
  rawKeys.push(keyCursor.key);
  }
  keyCursor = await keyCursor.continue();
  }
  for (const rawKey of rawKeys) {
  let rangeCursor = await companyIndex.openCursor(IDBKeyRange.only(rawKey));
  while (rangeCursor) {
  classify(rangeCursor.value);
  rangeCursor = await rangeCursor.continue();
  }
  }
  } else {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  let cursor = await store.openCursor();
  
  while (cursor) {
  classify(cursor.value);
  
  // Stop scanning if we have enough high-quality matches
  if ((exactMatches.length + exactEnglishMatches.length + startsWithMatches.length + containsMatches.length) > maxResults * 3) {
  // We scan a bit more than maxResults to allow sorting
  break;
  }
  
  cursor = await cursor.continue();
  }
  }
  
  // Preserve the previous full-scan encounter order (= ascending store key)
  // within every ranking queue so combined output is byte-for-byte
  // equivalent no matter which traversal produced the candidates.
  const bySako = (a: any, b: any) => (Number(a.sako) || 0) - (Number(b.sako) || 0);
  exactMatches.sort(bySako);
  exactEnglishMatches.sort(bySako);
  startsWithMatches.sort(bySako);
  containsMatches.sort(bySako);

  // Combine and limit
  const combined = [...exactMatches, ...exactEnglishMatches, ...startsWithMatches, ...containsMatches];
  return combined.slice(0, maxResults);
  } catch (err) {
  console.error('Error searching local meds:', err);
  return [];
  }
}

/**
 * Clears the local database store.
 */
export async function clearLocalDatabase(): Promise<void> {
  try {
  const db = await getDB();
  await db.clear(STORE_NAME);
  invalidateCompaniesCache();
  // CRITICAL: the store is now empty — drop the COMPLETE flag or every future
  // login on this origin will skip re-syncing and see a permanent empty catalog.
  try { localStorage.removeItem('CATALOG_SYNC_STATE'); } catch {}
  } catch (err) {
 console.error('Error clearing local database:', err);
 throw err;
 }
}


export async function verifyCatalogCompleteness(supabase: any) {
 try {
 const db = await getDB();
 const localCount = await db.count(STORE_NAME);
 
 // get unique local IDs
 const tx = db.transaction(STORE_NAME, 'readonly');
 const store = tx.objectStore(STORE_NAME);
 let cursor = await store.openCursor();
 
 let firstLocalId = null;
 let lastLocalId = null;
 const localIds = new Set();
 let duplicates = 0;
 
 while (cursor) {
 if (!firstLocalId || cursor.value.sako < firstLocalId) firstLocalId = cursor.value.sako;
 if (!lastLocalId || cursor.value.sako > lastLocalId) lastLocalId = cursor.value.sako;
 
 if (localIds.has(cursor.value.sako)) {
 duplicates++;
 } else {
 localIds.add(cursor.value.sako);
 }
 cursor = await cursor.continue();
 }
 
 const state = getCatalogSyncState();
 
 const { count, error } = await supabase
 .from('MEDS')
 .select('*', { count: 'exact', head: true });
 
 const expectedCount = count || 0;
 
 return {
 SUPABASE_EXPECTED_COUNT: expectedCount,
 LOCAL_COUNT: localCount,
 UNIQUE_LOCAL_ID_COUNT: localIds.size,
 DUPLICATE_LOCAL_IDS: duplicates,
 FIRST_LOCAL_ID: firstLocalId,
 LAST_LOCAL_ID: lastLocalId,
 SYNC_STATUS: state.status,
 LAST_CHECKPOINT: state.lastSako,
 IS_COMPLETE: localIds.size === expectedCount && expectedCount > 0
 };
 } catch (err) {
 console.error("Verification failed", err);
 return null;
 }
}
