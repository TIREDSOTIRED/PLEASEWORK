import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../application/auth/AuthContext';
import { HeartPulse, LogOut, Loader2, Camera, LayoutDashboard, ShoppingCart, Package, ScanLine, BarChart3, Settings as SettingsIcon, Activity, Menu, Search, Building2, Sparkles, Globe, Inbox, Tag, Store, Pill, ShoppingBag, FileText, BookOpen, Sun, Moon, MoreHorizontal, ChevronDown } from "lucide-react";
import DashboardTab from "./DashboardTab";
import AnalyticsTab from '../../components/AnalyticsTab';
import SalesAnalyticsTab from '../../components/SalesAnalyticsTab';
import POSCashierView from '../../components/POSCashierView';
import InventoryTab from '../../components/InventoryTab';
import LedgerTab from '../../components/LedgerTab';
import ScanAddTab from '../../components/ScanAddTab';
import SettingsTab from '../../components/SettingsTab';
import ItemViewTab from '../../components/ItemViewTab';
import DiscrepancyReconciliationModal from '../../components/DiscrepancyReconciliationModal';
import CompaniesDirectoryTab from '../../components/CompaniesDirectoryTab';
import PharmacyOnboarding from '../../components/onboarding/PharmacyOnboarding';
import RequiredOrganizationProfileModal from '../../components/auth/RequiredOrganizationProfileModal';
import OrganizationProfileEditModal from '../../components/profile/OrganizationProfileEditModal';
import AuthScreen from '../../components/auth/AuthScreen';
import WarehouseInventoryTab from '../../components/warehouse/WarehouseInventoryTab';
import { isTenantProfileComplete } from '../../domain/tenant';

import WarehouseOffersTab from '../../components/warehouse/WarehouseOffersTab';
import WarehouseIngestionTab from '../../components/warehouse/WarehouseIngestionTab';
import B2BQueueTab from '../../components/warehouse/B2BQueueTab';
import B2BMarketplaceTab from '../../components/B2BMarketplaceTab';
import { Medicine, SaleRecord } from '../../types';
import { db } from '../../infrastructure/firebase';
import { doc, updateDoc, setDoc, collection, addDoc, getDoc, query, where, getDocs, writeBatch, arrayUnion, deleteDoc } from 'firebase/firestore';
import { IndexedDbInventoryRepository } from '../../infrastructure/storage/IndexedDbInventoryRepository';
import { syncOffersInBatch } from '../../infrastructure/b2b/syncOfferAvailability';
import { resolveIntakeTarget, buildRestockUpdate } from '../../infrastructure/intake/intakeIdentity';
import { POSTransactionService, POSTransactionRecord } from '../../infrastructure/storage/POSTransactionService';
import { BackgroundSyncEngine } from '../../infrastructure/sync/BackgroundSyncEngine';
import { DrugMaster, DrugBatch } from '../../domain/inventory';
import { RegisterApplicationService } from '../../application/RegisterApplicationService';
import { FEFOStockAllocator } from '../../domain/services';
import { StockEngine, AdjustmentPlan } from '../../domain/services/StockEngine';
import { persistMirror } from '../../utils/localMirror';
import { buildRefund, mergeRefundedQty } from '../../domain/finance/refunds';
 import { resolveUnitCost } from '../../utils/cost';
 import { deriveBatchCost } from '../../utils/cost';
import { HardwareIntegrationService } from '../../infrastructure/hardware/HardwareIntegrationService';
import FullScreenScannerTab from '../../components/FullScreenScannerTab';
import RoleSwitcher from '../../components/RoleSwitcher';
import SyncStatusWidget from '../../components/SyncStatusWidget';
import { useTenantTheme } from '../../components/ThemeContext';
import ScannerModePickerModal, { ScannerMode } from '../../components/scanner/ScannerModePickerModal';
import CentralScannerModal from '../../components/scanner/CentralScannerModal';
import { Modal } from '../../components/ui/Modal';
import { useCatalog } from '../../context/CatalogContext';
import { useUI } from '../../context/UIContext';

interface RootNavigatorProps {
 medicines: Medicine[];
 setMedicines: any;
 salesLogs: SaleRecord[];
 setSalesLogs?: any;
 /** True until the first inventory snapshot arrives (drives Ledger skeletons). */
 isLoadingInventory?: boolean;
 developerMode: boolean;
 triggerToast?: (msg: string, type: 'success' | 'info' | 'error') => void;
 lang?: 'en' | 'ar';
 setLang?: (l: 'en' | 'ar') => void;
}

export default function RootNavigator({
 medicines,
 setMedicines,
 salesLogs,
 setSalesLogs,
 isLoadingInventory = false,
 developerMode,
 triggerToast: propTriggerToast,
 lang: propLang,
 setLang: propSetLang
}: RootNavigatorProps) {
 const ui = useUI();
 const lang = propLang || ui.lang || 'ar';
 const setLang = propSetLang || ui.setLang;
 const triggerToast = propTriggerToast || ui.triggerToast;

 const { currentSession, activePharmacy, overrideDevState, loginWithGoogle, loginWithEmail, signUpWithEmail, logout, isLoading, error } = useAuth();
 const [inventoryView, setInventoryView] = useState<'inventory' | 'ledger'>('inventory');
 const [activeTab, setActiveTab] = useState<'checkout'|'catalog'|'b2b_marketplace'|'inventory'|'analytics'|'settings'|'scan'|'camera'|'warehouse_inventory'|'warehouse_ingestion'|'b2b_queue'|'warehouse_orders'|'warehouse_offers'>('checkout');
 const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
 // "More" sidebar fold — auto-open when a folded tab is active (P3 nav declutter).
 const [showMoreTabs, setShowMoreTabs] = useState(() => ['b2b_marketplace', 'b2b_queue'].includes(activeTab as string));
 // Organization profile editor (identity system)
 const [profileEditOpen, setProfileEditOpen] = useState(false);
 const [pendingPosScan, setPendingPosScan] = useState<{ code: string; timestamp: number } | null>(null);
 const [pendingIntakeScan, setPendingIntakeScan] = useState<{ code: string; timestamp: number } | null>(null);
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [isSignUp, setIsSignUp] = useState(false);
 const { theme, setTheme } = useTenantTheme();
 const [isOnline, setIsOnline] = useState(navigator.onLine);
 
 // Central Scanner Picker & Modal States
 const [isScannerPickerOpen, setIsScannerPickerOpen] = useState(false);
 const [isScannerModalOpen, setIsScannerModalOpen] = useState(false);
 const [scannerMode, setScannerMode] = useState<ScannerMode>('SELL');
 const { catalogRaw: catalogData } = useCatalog();

 // InventoryTab states
 const [searchQuery, setSearchQuery] = useState('');
 const [categoryFilter, setCategoryFilter] = useState('All');
 const [reconcileMedicine, setReconcileMedicine] = useState<Medicine | null>(null);

 // Clinical dark/light theme — persisted, system preference as default
 // Clinical dark/light theme — single source of truth is UIContext
 // (persisted as app-theme; index.html head script applies it pre-paint).
 const isDarkTheme = ui.theme === 'dark';

 // Shared toggle element for desktop sidebar + mobile header.
 const themeToggle = (
 <button
 type="button"
 onClick={() => ui.setTheme(isDarkTheme ? 'light' : 'dark')}
 title={isDarkTheme ? 'Light mode' : 'Dark mode'}
 aria-label="Toggle dark mode"
 className="w-9 h-9 shrink-0 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-brand-300 flex items-center justify-center transition-colors cursor-pointer"
 >
 {isDarkTheme ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
 </button>
 );

 const [sortBy, setSortBy] = useState<'name' | 'stock' | 'expiryDate' | 'lastUpdated'>('name');
 const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
 
 // Generic handlers

 // ---------------------------------------------------------------------------
 // StockEngine: debounced, coalescing quick-adjust pipeline. UI taps update
 // local state instantly; the engine commits ONE atomic batch per medicine
 // shortly after the last tap, FEFO-resolved against fresh server batches.
 // Pending deltas persist per tenant and resume on next boot.
 // ---------------------------------------------------------------------------
 class FirestoreStockEngine extends StockEngine {
  async readBatches(tenantId: string, medId: string) {
  const { collection, getDocs } = await import('firebase/firestore');
  if (!db) return [];
  const snap = await getDocs(collection(db, 'tenants', tenantId, 'storage_inventory', medId, 'batches'));
  return snap.docs.map(d => {
  const v = d.data();
  return new DrugBatch(
  d.id,
  medId,
  v.batchNumber || 'N/A',
  new Date(v.expiryDate || '2099-01-01'),
  v.cost || v.ownerBaseCost || 0,
  v.stock !== undefined ? v.stock : (v.currentRemainingQuantity || 0),
  !!v.isSpoiled
  );
  });
  }
 }

 const stockEngineRef = useRef<FirestoreStockEngine | null>(null);
 if (!stockEngineRef.current) {
  stockEngineRef.current = new FirestoreStockEngine(async ({ tenantId, medId, plan, note }: { tenantId: string; medId: string; plan: AdjustmentPlan; note: string }) => {
  const { writeBatch, doc, increment, arrayUnion } = await import('firebase/firestore');
  if (!db) throw new Error('Firestore unavailable');
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();
  if (plan.correctiveBatch) {
  const corrBatchId = `corr-${Date.now()}`;
  batch.set(
  doc(db, 'tenants', tenantId, 'storage_inventory', medId, 'batches', corrBatchId),
  {
  batchId: corrBatchId,
  medId,
  batchNumber: `CORR-${String(Date.now()).slice(-6)}`,
  expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  cost: 0,
  stock: plan.correctiveBatch.stock,
  isSpoiled: false,
  lastUpdated: nowIso
  }
  );
  }
  for (const op of plan.batchOps) {
  batch.update(
  doc(db, 'tenants', tenantId, 'storage_inventory', medId, 'batches', op.batchId),
  { stock: increment(-op.deduct), lastUpdated: nowIso }
  );
  }
 batch.update(doc(db, 'tenants', tenantId, 'storage_inventory', medId), {
 stock: increment(plan.aggregateDelta),
 lastUpdated: nowIso,
 history: arrayUnion({
 id: `hist-${Date.now()}`,
 timestamp: nowIso,
 type: plan.aggregateDelta > 0 ? 'stock_correction_up' : 'stock_correction_down',
 note,
 quantityChange: plan.aggregateDelta
 })
 });
 // Offer availability mirror — quick-adjust deltas move offers too (Option B).
 await syncOffersInBatch({ batch, tenantId, safeCatalogId: medId, delta: plan.aggregateDelta });
 await batch.commit();
  });
 }

 // Resume any pending quick-adjusts persisted before an unload.
 const resumedTenantRef = useRef<string | null>(null);
 useEffect(() => {
  const t = currentSession?.pharmacyId || null;
  if (t && stockEngineRef.current && resumedTenantRef.current !== t) {
  resumedTenantRef.current = t;
  stockEngineRef.current.resume(t);
  }
 }, [currentSession?.pharmacyId]);

 /** Optimistic-only quick adjust — persistence handled by StockEngine burst flush. */
 const quickAdjustStock = (id: string, delta: number, note?: string) => {
  const tenantId = currentSession?.pharmacyId;
  if (!tenantId || !Number(delta)) return;
  const safeMedId = String(id).replace(/\//g, '_');
  setMedicines((prev: Medicine[]) => prev.map(m => m.id === id ? { ...m, stock: (m.stock || 0) + delta, lastUpdated: new Date().toISOString() } : m));
  stockEngineRef.current?.enqueue(tenantId, safeMedId, delta, note || 'Quick adjust');
 };


 // Physical stock correction (warehouse Ledger editing / quick modifiers).
 // Positive deltas follow the existing intake pattern: a corrective batch
 // document + aggregate increment. Negative deltas consume active stock
 // FEFO-first via the EXISTING FEFOStockAllocator (never expired/spoiled).
 // Everything lands in one atomic Firestore writeBatch; on any failure the
 // caller receives false and nothing is written.
 const onUpdateStock = async (id: string, delta: number, note?: string): Promise<boolean> => {
 if (!currentSession?.pharmacyId || !db || !Number(delta)) return false;
 try {
 const { writeBatch, doc, increment, collection, getDocs, arrayUnion } = await import('firebase/firestore');
 const safeMedId = String(id).replace(/\//g, '_');
 const nowIso = new Date().toISOString();
 const batch = writeBatch(db);

 if (delta > 0) {
 const corrBatchId = `corr-${Date.now()}`;
 batch.set(
 doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches', corrBatchId),
 {
 batchId: corrBatchId,
 medId: safeMedId,
 batchNumber: `CORR-${Date.now().toString().slice(-6)}`,
 expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
 cost: 0,
 stock: delta,
 isSpoiled: false,
 lastUpdated: nowIso
 }
 );
 } else {
 const batchesSnap = await getDocs(collection(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches'));
 const drugBatches = batchesSnap.docs.map(d => {
 const data = d.data();
 return new DrugBatch(
 d.id,
 safeMedId,
 data.batchNumber || 'N/A',
 new Date(data.expiryDate || '2099-01-01'),
 data.cost || data.ownerBaseCost || 0,
 data.stock !== undefined ? data.stock : (data.currentRemainingQuantity || 0),
 !!data.isSpoiled
 );
 });
 let allocations;
 try {
 allocations = FEFOStockAllocator.allocateStock(drugBatches, -delta);
 } catch (allocErr: any) {
 triggerToast(
 lang === 'ar'
 ? `لا يمكن تنفيذ التسوية: المخزون الفعّال غير كافٍ (${allocErr.message})`
 : `Cannot apply adjustment: insufficient active stock (${allocErr.message})`,
 'error'
 );
 return false;
 }
 for (const alloc of allocations) {
 batch.update(
 doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches', alloc.batchId),
 { stock: increment(-alloc.quantityToDeduct), lastUpdated: nowIso }
 );
 }
 }

 batch.update(
 doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId),
 {
 stock: increment(delta),
 lastUpdated: nowIso,
 history: arrayUnion({
 id: `hist-${Date.now()}`,
 timestamp: nowIso,
 type: delta > 0 ? 'stock_correction_up' : 'stock_correction_down',
 note: note || 'Manual physical adjustment',
 quantityChange: delta
 })
 }
 );

 // Offer availability mirror — corrections move offers too (Option B).
 await syncOffersInBatch({
 batch,
 tenantId: currentSession.pharmacyId,
 safeCatalogId: safeMedId,
 delta
 });

 await batch.commit();

 setMedicines((prev: Medicine[]) => prev.map(m => m.id === id ? { ...m, stock: (m.stock || 0) + delta, lastUpdated: nowIso } : m));
 return true;
 } catch (err) {
 console.warn('Stock adjustment failed:', err);
 triggerToast(lang === 'ar' ? 'فشل حفظ تسوية المخزون' : 'Failed to save stock adjustment', 'error');
 return false;
 }
 };

 // Catalog → warehouse intake entry point
 const [pendingIntakeItem, setPendingIntakeItem] = useState<any>(null);
 const handleStartWarehouseIntake = (catalogItem: any) => {
 setPendingIntakeItem(catalogItem);
 setActiveTab('inventory');
 };

 const onSelectMedicine = (id: string) => {
 const med = medicines.find(m => m.id === id);
 if (med && med.stock < 0) {
 setReconcileMedicine(med);
 }
 };
 const setActiveTabAndClear = (tab: any) => { setActiveTab(tab); };

  const firestoreAddMedicine = async (m: Medicine) => {
  if (!currentSession?.pharmacyId || !db) return;
  try {
  const tenantId = currentSession.pharmacyId;
  const inventoryCol = collection(db, 'tenants', tenantId, 'storage_inventory');
  // Intake identity resolution: an existing tenant inventory document is
  // authoritative. Resolve by catalog doc id first, then by normalized
  // barcode, before any create — a restock must never mint a second
  // inventory document for a product that already has a card.
  const resolution = await resolveIntakeTarget({
  catalogId: m.catalogId,
  id: m.id,
  barcode: m.barcode,
  name: m.name,
  lookup: {
  async getByDocId(safeId) {
  const snap = await getDoc(doc(db, 'tenants', tenantId, 'storage_inventory', safeId));
  return snap.exists() ? { id: snap.id, data: snap.data() as Record<string, any> } : null;
  },
  async getByBarcode(bc) {
  const snap = await getDocs(query(inventoryCol, where('barcode', '==', bc)));
  return snap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, any> }));
  }
  }
  });
  if (resolution.barcodeMatches && resolution.barcodeMatches.length > 1) {
  console.warn(`[intake-identity] barcode "${m.barcode}" matches ${resolution.barcodeMatches.length} inventory docs in tenant ${tenantId} (fragmentation):`, resolution.barcodeMatches.map(d => d.id).join(', '));
  }

  const safeMedId = resolution.safeMedId;
  const canonicalCatalogId = resolution.catalogId;
  const existingData = resolution.existing?.data;
  const finalizedMedicine = { ...m, id: safeMedId, catalogId: canonicalCatalogId };

  const repo = new IndexedDbInventoryRepository();
  // IDB mirror is keyed by catalogId — POS offline batch lookup
  // (getValidBatchesForDrug) queries by the card's catalogId.
  const drugMaster = new DrugMaster(canonicalCatalogId, m.barcode || '', m.name, m.genericName || m.name, false, 25);
  await repo.saveDrugMaster(drugMaster);
  const batchId = `batch-${Date.now()}`;
  const drugBatch = new DrugBatch(batchId, canonicalCatalogId, m.batchNumber || m.barcode || 'N/A', new Date(m.expiryDate), deriveBatchCost(m.costPrice).cost, m.stock, false);
  await repo.saveDrugBatch(drugBatch);
  // NOTE: no sync-queue payload is enqueued here. The medicine is written
  // directly to Firestore below (Firestore offline persistence covers the
  // offline case natively). The old ADD_MEDICINE queue payload targeted a
  // REST endpoint that never existed and only produced phantom "failed" items.

  const addStock = Number(m.stock) || 0;
  const nowIso = new Date().toISOString();

  // Optimistic state update — keyed by the RESOLVED identity so a
  // barcode-merge restock updates the original card, not a duplicate.
  setMedicines((prev: Medicine[]) => {
  const existingIdx = prev.findIndex(p => p.id === safeMedId);
  let updated;
  if (existingIdx >= 0) {
  updated = [...prev];
  updated[existingIdx] = { ...updated[existingIdx], stock: (Number(updated[existingIdx].stock) || 0) + addStock, lastUpdated: nowIso };
  } else {
  updated = [...prev, finalizedMedicine];
  }
  try { persistMirror(`syrian_inventory_${tenantId}`, updated); } catch(e){}
  return updated;
  });

  const medRef = doc(db, 'tenants', tenantId, 'storage_inventory', safeMedId);

  if (existingData) {
  const merged = buildRestockUpdate({ id: safeMedId, ...existingData }, finalizedMedicine, addStock, nowIso);
  await setDoc(medRef, merged, { merge: true });
  } else {
  await setDoc(medRef, { ...finalizedMedicine, pharmacyId: tenantId });
  }

 const batchRef = doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches', batchId);
 // Cost provenance (batch-cost-profit fix): a real purchase cost becomes the
 // batch cost; a missing/zero one stays UNKNOWN (0 + costEstimated) — never
 // the selling price. POS's resolveUnitCost turns 0 into an honest
 // 'unavailable' line instead of fabricated zero profit.
 const batchCost = deriveBatchCost(m.costPrice);
 const batchData = {
 batchId: batchId,
 medId: safeMedId,
 batchNumber: m.batchNumber || m.barcode || 'N/A',
 expiryDate: new Date(m.expiryDate).toISOString(),
 cost: batchCost.cost,
 costEstimated: batchCost.costEstimated,
 stock: m.stock,
 isSpoiled: false,
 lastUpdated: new Date().toISOString()
 };
 await setDoc(batchRef, batchData);

 // Offer availability mirror — intake/restock raises active offers too
 // (Option B). Own batch: the primary writes above must never wait on it.
 try {
 const offerBatch = writeBatch(db);
 await syncOffersInBatch({
 batch: offerBatch,
 tenantId: currentSession.pharmacyId,
 safeCatalogId: safeMedId,
 delta: m.stock || 0
 });
 await offerBatch.commit();
 } catch (offerSyncErr) {
 console.warn('Offer availability sync skipped after intake:', offerSyncErr);
 }

 // Optional global-catalog mirror — NON-BLOCKING by design.
 // This write must NEVER abort or gate private-inventory persistence above:
 // medicines_catalog has no tenant owner, and a failure here previously left
 // the ledger item optimistic-only (it vanished on the next snapshot).
 try {
 const catalogRef = doc(db, 'medicines_catalog', safeMedId);
 const catalogData = {
 catalogId: canonicalCatalogId,
 name: m.name,
 genericName: m.genericName || "",
 category: m.category || "",
 dosageForm: m.dosageForm || "",
 strength: m.strength || "",
 barcode: m.barcode || ""
 };
 await setDoc(catalogRef, catalogData, { merge: true });
 } catch (catalogErr) {
 console.warn('Optional medicines_catalog mirror skipped:', catalogErr);
 }
 } catch (err) {
 console.warn('Failed to add medicine', err);
 }
 };

 const firestoreUpdateMedicine = async (m: Partial<Medicine> & Pick<Medicine, 'id'>) => {
 if (!currentSession?.pharmacyId || !db || !m.id) return;
 try {
 // Optimistic state update
 setMedicines((prev: Medicine[]) => {
 const updated = prev.map(item => item.id === m.id ? { ...item, ...m } : item);
 try { persistMirror(`syrian_inventory_${currentSession.pharmacyId}`, updated); } catch(e){}
 return updated;
 });

 const safeMedId = String(m.id).replace(/\//g, '_');
 const medRef = doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId);
 await updateDoc(medRef, { ...m });
 } catch (err) {
 console.warn('Failed to update medicine', err);
 }
 };

 const firestoreDeleteMedicine = async (id: string) => {
 if (!currentSession?.pharmacyId || !db || !id) return;
 try {
 // Optimistic state update
 setMedicines((prev: Medicine[]) => {
 const updated = prev.filter(item => item.id !== id);
 try { persistMirror(`syrian_inventory_${currentSession.pharmacyId}`, updated); } catch(e){}
 return updated;
 });

 const safeMedId = String(id).replace(/\//g, '_');
 const medRef = doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId);
 await deleteDoc(medRef);
 } catch (err) {
 console.warn('Failed to delete medicine', err);
 }
 };

 const firestoreCompleteSale = async (cartItems: any[], paymentMethod: string = 'Cash', checkoutSessionId?: string, buyerNote?: string, customerName?: string) => {
 if (!currentSession?.pharmacyId || !db) return { success: false };
 try {
 const employeeId = currentSession.email || 'unknown';
 const saleId = checkoutSessionId || `SALE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

 const { writeBatch, doc, increment, collection, getDocs, arrayUnion } = await import('firebase/firestore');
 const batch = writeBatch(db);

 const saleRecordItems = [];
 const totalRevenue = cartItems.reduce((sum, item) => sum + (item.quantitySold * item.priceAtSale), 0);
 // Truthful cost accounting: unit cost comes from the dispensed batch's real
 // acquisition cost; when no cost was recorded the line is marked unavailable
 // (cost 0 + provenance flag) instead of fabricating a percentage estimate.
 let totalKnownCost = 0;
 let unknownCostItemCount = 0;

 // Perform FEFO using Firestore local cache
 for (const cartItem of cartItems) {
 const safeMedId = String(cartItem.medId).replace(/\//g, '_');
 const batchesRef = collection(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches');
 const batchesSnapshot = await getDocs(batchesRef);
 
 if (batchesSnapshot.empty && batchesSnapshot.metadata.fromCache && cartItem.quantitySold > 0) {
 return { success: false, error: `Offline batch data unavailable for ${cartItem.name}. Please reconnect to sync.` };
 }
 
 const firestoreBatches = batchesSnapshot.docs.map(d => {
 const data = d.data();
 return new DrugBatch(
 d.id,
 safeMedId,
 data.batchNumber || 'N/A',
 new Date(data.expiryDate || '2099-01-01'),
 data.cost || data.ownerBaseCost || 0,
 data.stock !== undefined ? data.stock : (data.currentRemainingQuantity || 0),
 !!data.isSpoiled
 );
 });

 let allocations: any[] = [];
 try {
 allocations = FEFOStockAllocator.allocateStock(firestoreBatches, cartItem.quantitySold);
 } catch (e: any) {
 return { success: false, error: e.message || "Failed to allocate stock" };
 }

 const batchCostById = new Map<string, number>(firestoreBatches.map(b => [b.id, b.ownerBaseCost]));

 const itemAllocations = [];
 let itemKnownCostTotal = 0;
 let itemHasUnknownCost = false;
 for (const alloc of allocations) {
 const resolved = resolveUnitCost(batchCostById.get(alloc.batchId));
 if (resolved.provenance === 'batch') {
 itemKnownCostTotal += resolved.unitCost * alloc.quantityToDeduct;
 } else {
 itemHasUnknownCost = true;
 }
 itemAllocations.push({
 batchId: alloc.batchId,
 quantity: alloc.quantityToDeduct,
 priceAtSale: cartItem.priceAtSale,
 costAtSale: resolved.unitCost,
 costSource: resolved.provenance
 });

 // Decrement batch stock
 const batchDocRef = doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches', alloc.batchId);
 batch.set(batchDocRef, {
 stock: increment(-alloc.quantityToDeduct),
 lastUpdated: new Date().toISOString()
 }, { merge: true });
 }

 totalKnownCost += itemKnownCostTotal;
 if (itemHasUnknownCost) unknownCostItemCount++;

 saleRecordItems.push({
 medId: cartItem.medId,
 name: cartItem.name,
 quantitySold: cartItem.quantitySold,
 priceAtSale: cartItem.priceAtSale,
 // Real per-unit acquisition cost when known; 0 + flag when unavailable.
 costAtSale: cartItem.quantitySold > 0 ? itemKnownCostTotal / cartItem.quantitySold : 0,
 costEstimated: itemHasUnknownCost,
 allocations: itemAllocations
 });

 // Decrement aggregate stock + append a truthful history entry so the
 // medicine's Recent Activity shows WHY stock changed (P2 #12 — sales were
 // previously invisible there).
 const medRef = doc(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId);
 batch.update(medRef, {
 stock: increment(-cartItem.quantitySold),
 lastUpdated: new Date().toISOString(),
 history: arrayUnion({
 id: `hist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
 timestamp: new Date().toISOString(),
 type: 'stock_sold',
 note: `Sold to ${paymentMethod === 'Credit' && customerName ? customerName : 'walk-in customer'} (invoice ${saleId})`,
 quantityChange: -cartItem.quantitySold
 })
 });

 // Offer availability mirror — wholesale/surplus offers of this SKU track
 // real stock (Option B propagation). Joins the same atomic batch.
 await syncOffersInBatch({
 batch,
 tenantId: currentSession.pharmacyId,
 safeCatalogId: safeMedId,
 delta: -cartItem.quantitySold
 });
 }

 const fullSaleRecord = {
 saleId,
 timestamp: new Date().toISOString(),
 items: saleRecordItems,
 totalRevenue,
 // Profit over KNOWN acquisition costs only. When unknownCostItemCount > 0
 // this figure is an upper bound (unavailable costs counted as 0).
 totalProfit: totalRevenue - totalKnownCost,
 unknownCostItemCount,
 status: paymentMethod === 'Credit' ? 'Pending' : 'Paid',
 paymentMethod,
 employeeId,
 // P1 #3: the debtor on a credit sale — receivables are grouped by this
 // name in the Financial Ledger; settlements attach to it.
 ...(customerName ? { customerName: customerName.trim() } : {}),
 // Off-app orders (WhatsApp/phone) carry the buyer context for the ledger.
 ...(buyerNote ? { note: buyerNote } : {})
 };

 const ledgerRef = doc(db, 'tenants', currentSession.pharmacyId, 'ledger', saleId);
 batch.set(ledgerRef, fullSaleRecord);

 // Save PENDING transaction locally before initiating the Firestore write
 const posTransaction: POSTransactionRecord = {
 transactionId: saleId,
 tenantId: currentSession.pharmacyId,
 createdAt: Date.now(),
 status: 'PENDING',
 totalRevenue,
 paymentMethod,
 items: saleRecordItems,
 allocations: saleRecordItems.flatMap(i => i.allocations || []),
 lastAttemptAt: Date.now(),
 updatedAt: Date.now()
 };
 
 try {
 await POSTransactionService.saveTransaction(posTransaction);
 } catch (localErr) {
 console.error("Failed to save local pending transaction", localErr);
 }

 // Commit the native Firestore batch. We DO NOT await this promise because
 // Firestore's batch.commit() will block until backend synchronization is complete,
 // which would freeze the POS during offline mode.
 // The local cache applies synchronously and triggers onSnapshot instantly.
 batch.commit().then(() => {
 POSTransactionService.updateTransactionStatus(saleId, 'SYNCED').catch(console.error);
 }).catch(err => {
 console.error("Firestore batch commit failed in background:", err);
 POSTransactionService.updateTransactionStatus(saleId, 'FAILED', err.message || "Failed to sync").catch(console.error);
 });

 return { success: true };
 } catch (err: any) {
 console.warn('Failed to complete sale', err);
 return { success: false, error: err.message || "System failure" };
 }
 };

  /** Off-app order (WhatsApp/phone): single-item dispatch through the same
   *  FEFO sale engine so ledger, profit and stock stay truthful. */
  const firestoreExternalSale = (med: Medicine, qty: number, payment: 'Cash' | 'Credit') => {
  if (!Number(qty)) return Promise.resolve({ success: false, error: 'Qty must be > 0' });
  return firestoreCompleteSale(
  [{ medId: med.id, name: med.name, quantitySold: qty, priceAtSale: med.price || 0 }],
  payment
  ) as Promise<{ success: boolean; error?: string }>;
  };

  /**
   * P1 #4 — customer debt settlement. Append-only: a NEW ledger document of
   * type CREDIT_SETTLEMENT records the payment; NO sale document is ever
   * rewritten or deleted. Partial payments are natural (amount < balance);
   * the remaining balance is always COMPUTED by the ledger views
   * (computeCustomerBalances) rather than stored on the sale.
   */
  const recordCustomerPayment = async (customerName: string, amountPaid: number, note?: string): Promise<boolean> => {
  if (!currentSession?.pharmacyId || !db) return false;
  const name = (customerName || '').trim();
  const amount = Number(amountPaid);
  if (!name || !amount || amount <= 0) {
  triggerToast(
  lang === 'ar' ? 'أدخل اسم العميل ومبلغاً صحيحاً.' : 'Enter the customer name and a valid amount.',
  'error'
  );
  return false;
  }
  try {
  const { collection: coll, addDoc: add } = await import('firebase/firestore');
  await add(coll(db, 'tenants', currentSession.pharmacyId, 'ledger'), {
  saleId: `PAYMENT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  timestamp: new Date().toISOString(),
  type: 'CREDIT_SETTLEMENT',
  customerName: name,
  amountPaid: amount,
  paymentMethod: 'Cash',
  status: 'Paid',
  employeeId: currentSession.email || 'unknown',
  ...(note ? { note } : {})
  });
  triggerToast(
  lang === 'ar'
  ? `تم تسجيل دفعة ${amount.toLocaleString()} ل.س من ${name}.`
  : `Recorded ${amount.toLocaleString()} SYP payment from ${name}.`,
  'success'
  );
  return true;
  } catch (err: any) {
  console.warn('Customer payment failed:', err);
  triggerToast(
  lang === 'ar' ? 'فشل تسجيل الدفعة.' : 'Failed to record the payment.',
  'error'
  );
  return false;
  }
  };

  /**
   * P2 #13 — refunds/returns. Append-only reversal mirroring the settlement
   * design: a NEW ledger doc of type 'REFUND' (negative totalRevenue) plus a
   * compensating stock return; the ORIGINAL sale only accumulates
   * `refundedQty` / `refundTotal` and flips to 'Refunded' when every sold
   * unit is back. Amounts come from priceAtSale (what the customer paid),
   * never the item's current price. One atomic writeBatch — on any failure
   * nothing is half-recorded.
   */
  const processRefund = async (sale: SaleRecord, returnQtys: Record<string, number>, reason?: string): Promise<boolean> => {
  if (!currentSession?.pharmacyId || !db) return false;
  const result = buildRefund(sale, returnQtys, reason);
  if (!result.ok) {
  const msg = result.error === 'OVER_RETURN'
  ? (lang === 'ar' ? 'الكمية المرتجعة تتجاوز المبيعات.' : 'Return quantity exceeds what was sold.')
  : (lang === 'ar' ? 'طلب الإرجاع غير صالح.' : 'Invalid return request.');
  triggerToast(msg, 'error');
  return false;
  }
  try {
  const { writeBatch: wb, doc: d, increment: inc, arrayUnion: au } = await import('firebase/firestore');
  const batch = wb(db);
  const tenantPath = ['tenants', currentSession.pharmacyId];
  const refundId = `RET-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const reversedCost = (sale.items || []).reduce((s, i) => {
  const line = result.refundLines.find(l => l.medId === i.medId);
  return s + (line ? (Number(i.costAtSale) || 0) * line.qty : 0);
  }, 0);

  batch.set(d(db, ...tenantPath, 'ledger', refundId), {
  saleId: refundId,
  timestamp: new Date().toISOString(),
  type: 'REFUND' as const,
  originalSaleId: sale.saleId,
  customerName: sale.customerName || '',
  items: result.refundLines.map(l => ({ medId: l.medId, name: l.name, quantitySold: -l.qty, priceAtSale: -(l.amount / l.qty) })),
  // Negative revenue/profit rows net the daily totals truthfully.
  totalRevenue: -result.refundTotal,
  totalProfit: -(result.refundTotal - reversedCost),
  status: 'Refunded' as const,
  paymentMethod: sale.paymentMethod || 'Cash',
  employeeId: currentSession.email || 'unknown',
  ...(reason && reason.trim() ? { reason: reason.trim() } : {})
  });

  // Original sale: accumulate returned quantities/amounts; flip status only
  // on a FULL refund so partial credit-sales stay in receivables.
  batch.update(d(db, ...tenantPath, 'ledger', sale.saleId), {
  refundedQty: mergeRefundedQty(sale, result.refundLines),
  refundTotal: inc(result.refundTotal),
  ...(result.fullyRefunded ? { status: 'Refunded' as const } : {})
  });

  // Compensating stock return — units rejoin the aggregate pool (batch
  // identity lives in the history note, not a separate ledger).
  for (const line of result.refundLines) {
  batch.update(d(db, ...tenantPath, 'storage_inventory', line.medId), {
  stock: inc(line.qty),
  lastUpdated: new Date().toISOString(),
  history: au({
  id: `hist-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  timestamp: new Date().toISOString(),
  type: 'stock_returned',
  note: `Customer return against invoice ${sale.saleId}${reason && reason.trim() ? ` — ${reason.trim()}` : ''} (refund ${refundId})`,
  quantityChange: line.qty
  })
  });
  }

  await batch.commit();
  triggerToast(
  lang === 'ar'
  ? `تم تسجيل مرتجع بقيمة ${result.refundTotal.toLocaleString()} ل.س.`
  : `Refund of ${result.refundTotal.toLocaleString()} SYP recorded.`,
  'success'
  );
  return true;
  } catch (err: any) {
  console.warn('Refund failed:', err);
  triggerToast(
  lang === 'ar' ? 'فشل تسجيل المرتجع.' : 'Failed to record the refund.',
  'error'
  );
  return false;
  }
  };

  if (isLoading) {
 return (
 <div className="min-h-screen bg-slate-100 dark:bg-[#0f172a] flex flex-col items-center justify-center p-4">
 <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-xl shadow-md px-8 py-6 flex flex-col items-center gap-3 max-w-xs w-full">
 <div className="w-9 h-9 rounded-md bg-slate-900 dark:bg-white flex items-center justify-center shrink-0">
 <span className="text-sm font-black text-white dark:text-slate-900 font-mono">E</span>
 </div>
 <Loader2 className="w-5 h-5 text-brand-600 animate-spin" />
 <p className="text-xs font-bold text-slate-600 dark:text-slate-300 text-center">
 {lang === 'ar' ? 'جارٍ استعادة الجلسة…' : 'Restoring your session…'}
 </p>
 </div>
 </div>
 );
 }

  if (!currentSession) {
    return <AuthScreen lang={lang} setLang={setLang} />;
  }

  if (currentSession && !activePharmacy) {
    return <PharmacyOnboarding lang={lang} setLang={setLang} />;
  }

  const isWarehouse = activePharmacy?.tenantType === 'WHOLESALE_WAREHOUSE';
 const mobileDockTabs = isWarehouse ? [
 { id: 'warehouse_orders', label: lang === 'ar' ? 'الطلبات' : 'Orders Inbox', icon: Inbox },
 { id: 'warehouse_offers', label: lang === 'ar' ? 'العروض' : 'Wholesale Offers', icon: Tag },
 { id: 'inventory', label: lang === 'ar' ? 'السجل' : 'Ledger', icon: Package },
 { id: 'catalog', label: lang === 'ar' ? 'المرجع' : 'Catalog', icon: BookOpen },
 { id: 'settings', label: lang === 'ar' ? 'الإعدادات' : 'Settings', icon: SettingsIcon }
 ] : [
 {
 id: 'checkout',
 label: lang === 'ar' ? 'نقطة البيع' : 'POS',
 icon: ShoppingCart,
 },
 {
 id: 'catalog',
 label: lang === 'ar' ? 'الأدوية' : 'Medicine',
 icon: Pill,
 },
 {
 id: 'b2b_marketplace',
 label: lang === 'ar' ? 'طلباتي' : 'My Orders',
 icon: ShoppingBag,
 },
 {
 id: 'b2b_queue',
 label: lang === 'ar' ? 'طلبات الفائض' : 'Surplus Requests',
 icon: Inbox,
 },
 {
 id: 'inventory',
 label: lang === 'ar' ? 'السجل' : 'Ledger',
 icon: FileText,
 }
  ];

  // Progressive disclosure: the desktop sidebar keeps the daily tabs visible
  // and folds B2B surfaces behind a "More" toggle (mobile dock stays full).
  const SECONDARY_TAB_IDS = ['b2b_marketplace', 'b2b_queue'];
  const secondarySidebarTabs = isWarehouse ? [] : mobileDockTabs.filter(t => SECONDARY_TAB_IDS.includes(t.id));
  const primarySidebarTabs = mobileDockTabs.filter(t => !secondarySidebarTabs.includes(t));
  const renderTabButton = (tab: (typeof mobileDockTabs)[number]) => {
  const isActive = activeTab === tab.id || (tab.id === 'inventory' && activeTab === 'warehouse_inventory');
  return (
  <button
  key={tab.id}
  onClick={() => {
  if (tab.id === 'inventory' && activePharmacy?.tenantType === "WHOLESALE_WAREHOUSE") {
  setActiveTab('warehouse_inventory');
  } else {
  setActiveTab(tab.id as any);
  }
  }}
  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold border-l-2 transition-colors cursor-pointer ${
  isActive
  ? 'bg-slate-100 text-slate-900 border-brand-700'
  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent'
  }`}
  >
  <tab.icon className={`w-4 h-4 ${isActive ? 'text-brand-700' : 'text-slate-400'}`} />
  <span>{tab.label}</span>
  </button>
  );
  };

  return (
 <>
 <div className="fixed inset-0 flex bg-slate-50 overflow-hidden text-slate-900 font-sans antialiased">
 
 {/* DESKTOP SIDEBAR */}
 <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 z-40 shrink-0 shadow-sm pt-[env(safe-area-inset-top,0px)]" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
 <div className="p-4 flex items-center gap-3 shrink-0 border-b border-slate-200">
 <div className="w-9 h-9 rounded-md bg-slate-900 flex items-center justify-center">
 <span className="text-sm font-black text-white font-mono">E</span>
 </div>
 <div className="flex flex-col">
 <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none">
 Eshmun
 </h1>
 <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-[0.18em] font-mono mt-1">
 Pharmacy Platform
 </span>
 </div>
 </div>

 <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
  {primarySidebarTabs.map((tab) => renderTabButton(tab))}
  {secondarySidebarTabs.length > 0 && (
  <>
  <button
  onClick={() => setShowMoreTabs(v => !v)}
  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold border-l-2 transition-colors cursor-pointer ${
  secondarySidebarTabs.some(t => t.id === activeTab)
  ? 'bg-slate-100 text-slate-900 border-brand-700'
  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent'
  }`}
  >
  <MoreHorizontal className={`w-4 h-4 ${secondarySidebarTabs.some(t => t.id === activeTab) ? 'text-brand-700' : 'text-slate-400'}`} />
  <span className="flex-1 text-start">{lang === 'ar' ? 'المزيد' : 'More'}</span>
  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showMoreTabs ? 'rotate-180' : ''}`} />
  </button>
  {showMoreTabs && secondarySidebarTabs.map((tab) => renderTabButton(tab))}
  </>
  )}
  </nav>

 <div className="p-3 border-t border-slate-100 flex items-center gap-2 shrink-0">
 {themeToggle}
 <SyncStatusWidget />
 <RoleSwitcher lang={lang} triggerToast={triggerToast} />
 <button 
 onClick={() => setIsAccountModalOpen(true)}
 className="w-full flex items-center gap-3 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-sm transition-colors border border-slate-200 mt-2"
 >
 <div className="w-7 h-7 rounded-md bg-brand-100 text-brand-800 flex items-center justify-center font-mono text-xs shadow-sm">
 {currentSession?.fullName?.charAt(0) || 'U'}
 </div>
 <div className="flex flex-col items-start min-w-0">
 <span className="truncate w-full text-left">{currentSession?.fullName || 'User'}</span>
 <span className="text-[10px] text-slate-400 font-normal">Profile & Settings</span>
 </div>
 </button>
 </div>
 </aside>

 {/* MAIN LAYOUT (Mobile Header + Content + Mobile Dock) */}
 <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative pt-[env(safe-area-inset-top,0px)]">
 
 {/* MOBILE HEADER */}
 <header className="md:hidden flex-none z-30 bg-white/95 border-b border-slate-200 px-4 py-3 flex items-center justify-between" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
 <div className="flex items-center gap-2.5">
 <div className="w-8 h-8 rounded-md bg-slate-900 flex items-center justify-center">
 <span className="text-sm font-black text-white font-mono">E</span>
 </div>
 <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none">
 Eshmun
 </h1>
 </div>
 <div className="flex items-center gap-2">
 {themeToggle}
 <SyncStatusWidget />
 <button 
 onClick={() => setIsAccountModalOpen(true)}
 className="w-8 h-8 rounded-md bg-slate-100 border border-slate-300 text-slate-700 flex items-center justify-center font-semibold text-xs"
 >
 {currentSession?.fullName?.charAt(0) || 'U'}
 </button>
 </div>
 </header>

 {/* Main Content Area */}
 <main className="flex-1 min-h-0 overflow-y-auto focus:outline-none flex flex-col">
 {activeTab === 'checkout' && (
 <POSCashierView
 medicines={medicines}
 onAddMedicine={firestoreAddMedicine}
 onCompleteSale={async (cartItems: any[], paymentMethod: string = 'Cash', checkoutSessionId?: string, customerName?: string) => {
 try {
 // We removed the optimistic local state updates because 
 // Firestore's persistent local cache will instantly fire onSnapshot
 // for the inventory and ledger collections, keeping the UI perfectly in sync.
 // @ts-ignore
 if (typeof firestoreCompleteSale === 'function') {
 const res = await firestoreCompleteSale(cartItems, paymentMethod, checkoutSessionId, undefined, customerName);
 if (res && !res.success) {
 triggerToast(res.error || 'Checkout failed', 'error');
 return { success: false, error: res.error };
 }
 }
 } catch(e) {
 return { success: false, error: 'System error during checkout' };
 }
 
 triggerToast(lang === 'ar' ? 'تمت عملية البيع بنجاح!' : 'Sale completed successfully!', 'success');
 return { success: true };
 }}
 lang={lang}
 triggerToast={triggerToast}
 externalScannedCode={pendingPosScan}
  pharmacyName={activePharmacy?.displayName || activePharmacy?.name}
  hasCompletedSale={(salesLogs || []).length > 0}
  salesLogs={salesLogs}
 />
 )}

 {activeTab === 'catalog' && (
 <CompaniesDirectoryTab lang={lang} triggerToast={triggerToast} onOpenScanner={() => setIsScannerPickerOpen(true)} onNavigateToPOS={() => setActiveTab('checkout')} onStartIntake={isWarehouse ? handleStartWarehouseIntake : undefined} />
 )}

 {activeTab === 'b2b_marketplace' && (
 <B2BMarketplaceTab triggerToast={triggerToast} lang={lang} />
 )}

{(activeTab === 'inventory' || activeTab === 'warehouse_inventory') && (
  <>
  {/* Stock / Financial Ledger sub-view toggle — LedgerTab was previously orphaned (dead import). */}
  <div className="px-4 pt-3 flex items-center gap-2 shrink-0" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
  <div className="inline-flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-1 border border-slate-200 dark:border-slate-700">
  <button
  onClick={() => setInventoryView('inventory')}
  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${inventoryView === 'inventory' ? 'bg-white dark:bg-slate-700 text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
  >
  {lang === 'ar' ? 'المخزون' : 'Stock'}
  </button>
  <button
  onClick={() => setInventoryView('ledger')}
  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${inventoryView === 'ledger' ? 'bg-white dark:bg-slate-700 text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
  >
  {lang === 'ar' ? 'السجل المالي' : 'Financial Ledger'}
  </button>
  </div>
  </div>
  {inventoryView === 'ledger' ? (
  <LedgerTab
  salesLogs={salesLogs}
  medicines={medicines}
  lang={lang}
  triggerToast={triggerToast}
  onRecordPayment={recordCustomerPayment}
  onProcessRefund={processRefund}
  />
  ) : (
  activePharmacy?.tenantType === "WHOLESALE_WAREHOUSE" ? (
          <WarehouseInventoryTab 
            triggerToast={triggerToast}
            medicines={medicines}
            isLoadingInventory={isLoadingInventory}
            onUpdateStock={onUpdateStock}
            onQuickAdjust={quickAdjustStock}
            onExternalSale={firestoreExternalSale}
            onUpdateMedicine={firestoreUpdateMedicine}
            onSelectMedicine={onSelectMedicine}
            onAddMedicine={firestoreAddMedicine}
            intakeRequest={pendingIntakeItem}
            onIntakeConsumed={() => setPendingIntakeItem(null)}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            lang={lang}
          />
        ) : (
          <InventoryTab
            lang={lang}
            triggerToast={triggerToast}
            medicines={medicines}
            isLoadingInventory={isLoadingInventory}
            onUpdateStock={onUpdateStock}
            onQuickAdjust={quickAdjustStock}
            onSelectMedicine={onSelectMedicine}
            onAddMedicine={firestoreAddMedicine}
            onUpdateMedicine={firestoreUpdateMedicine}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortOrder={sortOrder}
setSortOrder={setSortOrder}
           />
  )
  )}
  </>
)}

  {activeTab === 'scan' && (
 <ScanAddTab 
 onAddMedicine={firestoreAddMedicine} 
 lang={lang} 
 triggerToast={triggerToast} 
 externalScannedCode={pendingIntakeScan} 
 setActiveTab={setActiveTabAndClear}
 onSelectMedicine={onSelectMedicine}
 />
 )}

 {activeTab === 'warehouse_ingestion' && (
 <WarehouseIngestionTab triggerToast={triggerToast} lang={lang} />
 )}

 {activeTab === 'warehouse_orders' && (
 <B2BQueueTab activeTenantId={currentSession?.pharmacyId || ''} triggerToast={triggerToast} />
 )}
 {activeTab === 'warehouse_offers' && (
 <WarehouseOffersTab medicines={medicines} lang={lang} triggerToast={triggerToast} />
 )}
 {activeTab === 'b2b_queue' && (
 <B2BQueueTab 
 activeTenantId={currentSession?.pharmacyId || ''} 
 triggerToast={triggerToast} 
 />
 )}

 {activeTab === 'analytics' && (
 <AnalyticsTab 
 medicines={medicines} 
 onSelectMedicine={onSelectMedicine} 
 triggerToast={triggerToast} 
 lang={lang} 
 />
 )}

 {activeTab === 'analytics' && (
 <SalesAnalyticsTab 
 lang={lang}
 salesLogs={salesLogs}
 />
 )}
 {activeTab === 'settings' && (
 <SettingsTab 
 toggleSyncStatus={() => {}}
 theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} isOnline={isOnline}
 medicines={medicines} setMedicines={setMedicines}
 triggerToast={triggerToast} developerMode={developerMode} onTriggerImport={() => triggerToast(lang === 'ar' ? 'تم تشغيل الاستيراد' : 'Import triggered', 'success')}
 salesLogs={[]}
 onOpenScanner={() => setIsScannerPickerOpen(true)}
 />
 )}

 {activeTab === 'camera' && (
 <FullScreenScannerTab 
 lang={lang}
 onScan={async (barcode, mode) => {
 try {
 // Local synthesized beep — works offline (replaces remote mixkit MP3).
 HardwareIntegrationService.getInstance().playScanSuccess();
 if (navigator.vibrate) navigator.vibrate(50);
 } catch(e) {}

 const isKnown = medicines.some(m => m.batchNumber === barcode || m.barcode === barcode);

 if (mode === 'sell') {
 setActiveTab('checkout');
 setPendingPosScan({ code: barcode, timestamp: Date.now() });
 } else {
 setActiveTab('scan');
 setPendingIntakeScan({ code: barcode, timestamp: Date.now() });
 }

 return isKnown ? 'known' : 'unknown';
 }}
 />
 )}
 </main>
  {/* Floating Mobile Bottom Navigation Dock (Phones) — single row for ANY tab count */}
 <nav 
          id="mobile-bottom-navigation"
          className="md:hidden flex-none z-50 bg-white border-t border-slate-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] px-1 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] grid w-full" 
          style={{ gridTemplateColumns: `repeat(${mobileDockTabs.length}, minmax(0, 1fr))` }}
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          {mobileDockTabs.map((tab) => {
            const isActive = activeTab === tab.id || (tab.id === "inventory" && activeTab === "warehouse_inventory");
            return (
              <button
                key={tab.id}
                id={"mobile-nav-" + tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === "inventory" && activePharmacy?.tenantType === "WHOLESALE_WAREHOUSE") {
                    setActiveTab("warehouse_inventory");
                  } else {
                    setActiveTab(tab.id as any);
                  }
                }}
                className={"w-full flex flex-col items-center justify-center min-h-[48px] py-1 px-0.5 rounded-md transition-colors cursor-pointer select-none border-t-2 " + (
                  isActive 
                    ? "text-slate-900 font-semibold bg-slate-100 border-brand-700" 
                    : "text-slate-500 hover:text-slate-800 font-medium border-transparent"
                )}
              >
                <tab.icon className={`w-[18px] h-[18px] shrink-0 mb-0.5 ${isActive ? 'text-brand-700' : 'text-slate-400'}`} />
                <span className="leading-tight tracking-tight truncate max-w-full text-center whitespace-nowrap text-[10px] font-semibold">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
 </div>
 </div>

 {/* Clean User Account & Settings Modal (Centered & Responsive) */}
      <Modal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        title={lang === "ar" ? "إعدادات الحساب والنظام" : "Account & System Settings"}
        maxWidth="md"
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <button
              onClick={() => { setIsAccountModalOpen(false); logout(); }}
              className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl font-bold text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{lang === "ar" ? "تسجيل الخروج" : "Sign Out"}</span>
            </button>
            <button
              onClick={() => setIsAccountModalOpen(false)}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs transition-colors cursor-pointer"
            >
              {lang === "ar" ? "إغلاق" : "Close"}
            </button>
          </div>
        }
      >
        <div className="space-y-5" dir={lang === "ar" ? "rtl" : "ltr"}>
          {/* Account / Pharmacy Info */}
          <div className="bg-slate-50 border border-brand-100 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-brand-700 text-white font-black text-base flex items-center justify-center shrink-0 shadow-sm">
                {currentSession?.fullName?.charAt(0) || currentSession?.name?.charAt(0) || "E"}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 text-sm truncate">
                  {currentSession?.fullName || currentSession?.name || (lang === "ar" ? "مستخدم النظام" : "System User")}
                </h3>
                <p className="text-xs text-slate-500 truncate">{currentSession?.email || "authenticated@eshmun.local"}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 rounded-md bg-brand-100 text-brand-800 text-[10px] font-bold font-mono uppercase">
                    {currentSession?.role || "STAFF"}
                  </span>
                  <span className="text-xs text-slate-600 font-medium truncate">
                    {activePharmacy?.name || (lang === "ar" ? "الفرع الرئيسي" : "Main Pharmacy")}
                  </span>
                </div>
              </div>
            </div>
            {activePharmacy && (
              <button
                type="button"
                id="btn-edit-org-profile"
                onClick={() => setProfileEditOpen(true)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:border-brand-400 text-slate-700 hover:text-brand-800 text-[11px] font-bold transition-colors cursor-pointer"
              >
                {lang === "ar" ? "تعديل البيانات" : "Edit profile"}
              </button>
            )}
          </div>

          {/* Preferences: Interface Language */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
              {lang === "ar" ? "لغة الواجهة" : "Interface Language"}
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setLang("ar")}
                className={`py-2 px-3 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  lang === "ar"
                    ? "bg-white shadow-xs text-brand-800"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>🇸🇾 العربية</span>
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`py-2 px-3 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                  lang === "en"
                    ? "bg-white shadow-xs text-brand-800"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>🇬🇧 English</span>
              </button>
            </div>
          </div>

          {/* Preferences: Role Switcher */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
              {lang === "ar" ? "تبديل الدور التجريبي" : "Role Simulation"}
            </label>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <RoleSwitcher lang={lang} triggerToast={triggerToast} />
            </div>
          </div>

          {/* Synchronization & Diagnostics */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
              {lang === "ar" ? "المزامنة وقاعدة البيانات" : "Synchronization & Database"}
            </label>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" />
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    {lang === "ar" ? "محرك المزامنة السحابية" : "Cloud Sync Engine"}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    {lang === "ar" ? "تحديث الكتالوج والمخزون المحلي" : "Update local catalog & storage"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { clearLocalDatabase } = await import("../../services/syncEngine");
                    await clearLocalDatabase();
                    triggerToast(lang === "ar" ? "تمت إعادة مزامنة قاعدة البيانات بنجاح" : "Database synchronized successfully", "success");
                  } catch (e) {
                    triggerToast(lang === "ar" ? "اكتملت المزامنة" : "Sync completed", "info");
                  }
                }}
                className="px-3 py-1.5 bg-brand-100 hover:bg-brand-200 text-brand-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                {lang === "ar" ? "مزامنة الآن" : "Sync Now"}
              </button>
            </div>
          </div>

          {/* Quick Navigations */}
          <div className="space-y-1.5 pt-1">
            <button
              onClick={() => { setActiveTab("settings"); setIsAccountModalOpen(false); }}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-between transition-colors cursor-pointer"
            >
              <span>{lang === "ar" ? "صفحة الإعدادات الكاملة" : "Full Settings Page"}</span>
              <span>→</span>
            </button>
            <button
              onClick={() => { setActiveTab("analytics"); setIsAccountModalOpen(false); }}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-between transition-colors cursor-pointer"
            >
              <span>{lang === "ar" ? "التقارير والمبيعات" : "Reports & Analytics"}</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Organization profile editor */}
      <OrganizationProfileEditModal
        isOpen={profileEditOpen}
        onClose={() => setProfileEditOpen(false)}
        lang={lang}
      />
      
      {/* Unified Camera Scanner Workflow Modals */}
 <ScannerModePickerModal
 isOpen={isScannerPickerOpen}
 onClose={() => setIsScannerPickerOpen(false)}
 onSelectMode={(mode) => {
 setScannerMode(mode);
 setIsScannerPickerOpen(false);
 setIsScannerModalOpen(true);
 }}
 lang={lang}
 />

 <CentralScannerModal
 isOpen={isScannerModalOpen}
 mode={scannerMode}
 onClose={() => setIsScannerModalOpen(false)}
 catalogData={catalogData}
 onAddToCart={(item) => {
 if (activeTab !== 'checkout') {
 setActiveTab('checkout');
 }
 const code = String(item.barcode || item.id || '').trim().replace(/,$/, '');
 setPendingPosScan({
 code,
 timestamp: Date.now()
 });
 }}
 onAddStockItem={(barcode, item) => {
 setActiveTab('scan');
 setPendingIntakeScan({
 code: barcode,
 timestamp: Date.now()
 });
 }}
 lang={lang}
 />
 {reconcileMedicine && (
 <DiscrepancyReconciliationModal
 medicine={reconcileMedicine}
 onClose={() => setReconcileMedicine(null)}
 triggerToast={triggerToast}
 lang={lang}
 />
 )}

 {activePharmacy && !isTenantProfileComplete(activePharmacy) && (
   <RequiredOrganizationProfileModal
     lang={lang}
     setLang={setLang}
     triggerToast={triggerToast}
   />
 )}
 </>
 );
}
