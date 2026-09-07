import CentralScannerModal from './scanner/CentralScannerModal';
import InlineCameraScanner from './scanner/InlineCameraScanner';
import FirstRunChecklist from './FirstRunChecklist';
import TabIntro from './ui/TabIntro';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Modal } from './ui/Modal';
import { motion, AnimatePresence } from 'motion/react';
import { 
 ShoppingCart, Plus, Minus, Trash2, Search, CheckCircle2, Package, Receipt, Zap, PauseCircle,
 Filter, Sparkles, AlertCircle, ChevronDown, RefreshCw, Barcode, Camera, Check, ArrowRight, X, Loader2, ArrowRightLeft,
 Banknote, CreditCard, History
} from 'lucide-react';
import { Medicine, SaleRecord, normalizeMedicine } from '../types';
import { translations } from '../data/translations';
import { IndexedDbInventoryRepository } from '../infrastructure/storage/IndexedDbInventoryRepository';
import { useAuth } from '../application/auth/AuthContext';
import { db } from '../infrastructure/firebase';
import { collection, getDocs } from 'firebase/firestore';
import GenericAlternativeCard, { AlternativeItem } from './GenericAlternativeCard';
import { useHardware } from '../application/hooks/useHardware';
import { useReceiptPrinter } from '../application/hooks/useReceiptPrinter';
import ThermalReceipt from './ThermalReceipt';
import SubstitutionDrawer from './SubstitutionDrawer';
import { useCatalog } from '../context/CatalogContext';
import { useUI } from '../context/UIContext';
import BarcodeScannerModal, { CatalogItem } from './BarcodeScannerModal';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Card, CardContent } from './ui/Card';
import { parseBarcode, getBarcodeVariants } from '../utils/gs1Parser';
import { normalizeBarcode } from '../services/syncEngine';
import { POSTransactionService, POSTransactionRecord } from '../infrastructure/storage/POSTransactionService';
import BarcodeLinkerModal from './BarcodeLinkerModal';
import StockIntakeModal from './warehouse/StockIntakeModal';

interface POSCashierViewProps {
 lang?: 'en' | 'ar';
 medicines: Medicine[];
 onCompleteSale: (cartItems: any[], paymentMethod?: string, checkoutSessionId?: string, customerName?: string) => Promise<{ success: boolean; error?: string }>;
 triggerToast?: (message: string, type: 'success' | 'info' | 'error') => void;
 externalScannedCode?: { code: string; timestamp: number } | null;
 onOpenScanner?: () => void;
 onAddToB2BOrder?: (item: any, quantity?: number) => void;
 onAddMedicine?: (m: Medicine) => Promise<void>;
 /** Authoritative tenant display name for tenant-branded receipts (P2 #9). */
 pharmacyName?: string;
  /** Any sale has ever been recorded — drives the first-run checklist (P1 #7). */
  hasCompletedSale?: boolean;
  /** Live sales ledger (same onSnapshot source as the Ledger tab) — powers the History panel. */
  salesLogs?: SaleRecord[];
}

interface CartItem {
 id: string; // unique instance id for animation
 med: Medicine;
 quantity: number;
 allocatedBatch?: string;
 batchExpiry?: string;
 isRecentlyAdded?: boolean;
}

const CATEGORY_PILLS = [
 { id: 'all', labelEn: 'All Items', labelAr: 'الكل' },
 { id: 'tablets', labelEn: 'Tablets', labelAr: 'أقراص / كبسولات' },
 { id: 'syrups', labelEn: 'Syrups', labelAr: 'شراب' },
 { id: 'injections', labelEn: 'Injections', labelAr: 'حقن' },
 { id: 'supplies', labelEn: 'Supplies', labelAr: 'مستلزمات' }
];

export default function POSCashierView({
 lang: propLang,
 medicines,
 onCompleteSale,
 triggerToast: propTriggerToast,
 externalScannedCode,
 onOpenScanner,
 onAddToB2BOrder,
  onAddMedicine,
  pharmacyName,
  hasCompletedSale,
  salesLogs = []
}: POSCashierViewProps) {
 const ui = useUI();
 const lang = propLang || ui.lang || 'ar';
 const triggerToast = useCallback(
 (msg: string, type: 'success' | 'info' | 'error' = 'info') => {
 if (propTriggerToast) propTriggerToast(msg, type);
 else ui.triggerToast(msg, type);
 },
 [propTriggerToast, ui]
 );

 const t = translations[lang] || translations.ar;
 const { currentSession } = useAuth();
 const hardware = useHardware();
 const { printData, printReceipt } = useReceiptPrinter();
 const { findMedicineByCode, searchCatalogRemote } = useCatalog();
 
 const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = sessionStorage.getItem('eshmun_pos_active_cart');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('eshmun_pos_active_cart', JSON.stringify(cart));
    } catch (e) {}
  }, [cart]);
  const [isProcessing, setIsProcessing] = useState(false);
  // History panel — a read-only window onto the same salesLogs the Ledger uses.
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
 const [searchQuery, setSearchQuery] = useState('');
 const [selectedCategory, setSelectedCategory] = useState('all');
 const [displayLimit, setDisplayLimit] = useState(40);
 const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
 const [lastSaleData, setLastSaleData] = useState<{items: any[], total: number, time: string, invoiceId: string, paymentMethod?: string, customerName?: string} | null>(null);
 // P1 #3 — retail credit/owed: a normal POS choice, not an accounting screen.
 const [paymentMode, setPaymentMode] = useState<'cash' | 'credit'>('cash');
 const [creditCustomer, setCreditCustomer] = useState('');
 const [scannerReady, setScannerReady] = useState(true);
 const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
 const [isInlineScannerOpen, setIsInlineScannerOpen] = useState(false);
 const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
 
 const searchInputRef = useRef<HTMLInputElement>(null);
 const barcodeBufferRef = useRef('');
 const [selectedIndex, setSelectedIndex] = useState(0);
 const [alternatives, setAlternatives] = useState<AlternativeItem[]>([]);
 const [activeIngredientName, setActiveIngredientName] = useState("");
 const [isSearchingAlternatives, setIsSearchingAlternatives] = useState(false);
 const [substitutionTarget, setSubstitutionTarget] = useState<Medicine | null>(null);
 const [unmappedBarcode, setUnmappedBarcode] = useState<string | null>(null);
 const [isStockIntakeOpen, setIsStockIntakeOpen] = useState(false);
 
 const [pendingTransactions, setPendingTransactions] = useState<POSTransactionRecord[]>([]);
 const [failedTransactions, setFailedTransactions] = useState<POSTransactionRecord[]>([]);

 const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
 const [filteredMedicines, setFilteredMedicines] = useState<Medicine[]>([]);
 const [isSearching, setIsSearching] = useState(false);

 useEffect(() => {
 let isMounted = true;
 const fetchTransactions = async () => {
 try {
 const pending = await POSTransactionService.getPendingTransactions();
 const failed = await POSTransactionService.getFailedTransactions();
 if (isMounted) {
 setPendingTransactions(pending);
 setFailedTransactions(failed);
 }
 } catch (err) {
 console.error("Failed to fetch local transactions", err);
 }
 };
 
 fetchTransactions();
 const interval = setInterval(fetchTransactions, 5000);
 return () => {
 isMounted = false;
 clearInterval(interval);
 };
 }, []);

 useEffect(() => {
 const timer = setTimeout(() => {
 setDebouncedSearchQuery(searchQuery);
 }, 200);
 return () => clearTimeout(timer);
 }, [searchQuery]);

 useEffect(() => {
 let isMounted = true;
 const doSearch = () => {
 setIsSearching(true);
 try {
 let results = medicines;
  const query = debouncedSearchQuery.toLowerCase().trim();

  if (query) {
  results = results.filter(med => 
  (med.name && med.name.toLowerCase().includes(query)) ||
  (med.genericName && med.genericName.toLowerCase().includes(query)) ||
  (med.barcode && String(med.barcode).toLowerCase().includes(query)) ||
  (med.batchNumber && String(med.batchNumber).toLowerCase().includes(query))
  );

  // P2 #10: English brand-name search against Arabic-named inventory.
  // The catalog is the bilingual bridge: resolve the query to catalog
  // entries, then match LOCAL stock by barcode or catalogId. Exact
  // identity keys only — no fuzzy merging of distinct medicines.
  if (results.length === 0 && searchCatalogRemote) {
  searchCatalogRemote(query, 8)
  .then(catalogHits => {
  if (!isMounted) return;
  const hitKeys = new Set<string>();
  (catalogHits || []).forEach((c: any) => {
  const cid = String(c?.id || c?.catalogId || '').replace(/\//g, '_');
  if (cid) hitKeys.add(cid);
  const bc = String(c?.barcode || '').trim();
  if (bc) hitKeys.add(bc);
  });
  if (hitKeys.size > 0) {
  const bridged = medicines.filter(m =>
  hitKeys.has(String(m.catalogId || '')) ||
  hitKeys.has(String(m.barcode || '').trim())
  );
  if (bridged.length > 0) setFilteredMedicines(bridged);
  }
  })
  .catch(() => {});
  }
  }

 if (selectedCategory !== 'all') {
 const catLower = selectedCategory.toLowerCase();
 results = results.filter(m => {
 const form = (m.dosageForm || '').toLowerCase();
 const cat = (m.category || '').toLowerCase();
 const gen = (m.genericName || '').toLowerCase();
 if (catLower === 'tablets') {
 return form.includes('tablet') || form.includes('capsule') || cat.includes('tablet') || cat.includes('capsule') || cat.includes('قرص') || cat.includes('كبسول');
 }
 if (catLower === 'syrups') {
 return form.includes('syrup') || form.includes('liquid') || cat.includes('syrup') || cat.includes('شراب');
 }
 if (catLower === 'injections') {
 return form.includes('inj') || form.includes('vial') || cat.includes('inj') || cat.includes('حقن');
 }
 if (catLower === 'supplies') {
 return form.includes('supply') || form.includes('bandage') || cat.includes('supply') || cat.includes('مستلزمات');
 }
 return cat.includes(catLower) || gen.includes(catLower);
 });
 }
 
 if (isMounted) setFilteredMedicines(results);
 } catch(e) {
 console.error(e);
 } finally {
 if (isMounted) setIsSearching(false);
 }
 };
 doSearch();
 return () => { isMounted = false; };
 }, [debouncedSearchQuery, selectedCategory, medicines]);

 const stateRef = useRef({
 cart,
 searchQuery,
 filteredMedicines: [] as Medicine[],
 selectedIndex,
 isProcessing: false
 });

 useEffect(() => {
 setSelectedIndex(0);
 setDisplayLimit(40);
 }, [searchQuery, selectedCategory]);

 const visibleMedicines = useMemo(() => {
 return filteredMedicines.slice(0, displayLimit);
 }, [filteredMedicines, displayLimit]);

 // Auto-search alternatives if search yields empty result
 useEffect(() => {
 let isMounted = true;
 const fetchAlternatives = async () => {
 if (!searchQuery || filteredMedicines.length > 0) {
 setAlternatives([]);
 setActiveIngredientName("");
 setIsSearchingAlternatives(false);
 return;
 }
 
 setIsSearchingAlternatives(true);
 try {
 const queryLower = searchQuery.toLowerCase().trim();
 let targetGeneric = "";
 
 const catalogResults = await searchCatalogRemote(queryLower, 10);
 if (catalogResults && catalogResults.length > 0) {
 targetGeneric = catalogResults[0].composition || "";
 }
 
 if (!targetGeneric || !isMounted) {
 if (isMounted) {
 setAlternatives([]);
 setIsSearchingAlternatives(false);
 }
 return;
 }
 
 const genericLower = targetGeneric.toLowerCase();
 const altLocal = medicines.filter(m => 
 m.stock > 0 && 
 m.genericName && m.genericName.toLowerCase().includes(genericLower)
 );
 
 if (isMounted) {
 setActiveIngredientName(targetGeneric);
 setAlternatives(altLocal.map(m => ({
 id: m.id,
 name: m.name,
 manufacturer: (m as any).manufacturer || (m as any).supplier || "Local Stock",
 unitPrice: m.price,
 expiryDate: new Date(m.expiryDate).toISOString().split('T')[0],
 stock: m.stock,
 activeIngredient: m.genericName
 })));
 }
 } catch (err) {
 console.error("Failed to fetch alternatives:", err);
 } finally {
 if (isMounted) setIsSearchingAlternatives(false);
 }
 };
 
 const timer = setTimeout(fetchAlternatives, 300);
 return () => {
 isMounted = false;
 clearTimeout(timer);
 };
 }, [searchQuery, filteredMedicines.length, medicines, searchCatalogRemote]);

 useEffect(() => {
 stateRef.current = { cart, searchQuery, filteredMedicines, selectedIndex };
 }, [cart, searchQuery, filteredMedicines, selectedIndex]);

  // Add Item to Cart
  const addItemToCart = useCallback(async (med: Medicine, qty: number = 1) => {
  if (med.stock <= 0) {
  hardware.playScanError();
  triggerToast(lang === 'ar' ? ' نفد المخزون! الكمية الحالية: 0.' : ' Out of Stock! Current quantity: 0.', 'error');
  return;
  }

  // NOTE: success beep fires ONLY inside setCart once the outcome is known —
  // a premature beep here caused double/error-then-success sounds.
 
 let allocatedBatch = "N/A";
 let batchExpiry = "";
 try {
 const repo = new IndexedDbInventoryRepository();
 const batches = await repo.getValidBatchesForDrug(med.catalogId || med.barcode || med.id);
 if (batches.length > 0) {
 batches.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
 allocatedBatch = batches[0].batchNumber;
 batchExpiry = batches[0].expiryDate.toISOString().split('T')[0];
 } else {
 allocatedBatch = med.batchNumber || "BATCH-N/A";
 batchExpiry = new Date(med.expiryDate).toISOString().split('T')[0];
 }
 } catch (e) {
 allocatedBatch = med.batchNumber || "BATCH-N/A";
 batchExpiry = new Date(med.expiryDate).toISOString().split('T')[0];
 }
 
 setCart(prev => {
 const existingIdx = prev.findIndex(item => item.med.id === med.id);
 if (existingIdx >= 0) {
 const existing = prev[existingIdx];
 const newQuantity = existing.quantity + qty;
 if (newQuantity > med.stock) {
 hardware.playScanError();
 triggerToast(lang === 'ar' ? 'الكمية المطلوبة تتجاوز المخزون المتوفر' : 'Requested quantity exceeds available stock', 'info');
 return prev;
 }
 hardware.playScanSuccess();
 const updated = [...prev];
 updated[existingIdx] = { 
 ...existing, 
 quantity: newQuantity,
 isRecentlyAdded: true
 };
 return updated;
 }
 hardware.playScanSuccess();
 return [{ id: Math.random().toString(), med, quantity: qty, allocatedBatch, batchExpiry, isRecentlyAdded: true }, ...prev];
 });

 setTimeout(() => {
 setCart(prev => prev.map(item => item.med.id === med.id ? { ...item, isRecentlyAdded: false } : item));
 }, 800);
 }, [lang, triggerToast, hardware]);

  // Handle scanned barcode
  const handleScan = useCallback(async (code: string) => {
 const normCode = normalizeBarcode(code);
 if (!normCode) return;

 const parsed = parseBarcode(normCode);
 const lookupCode = normalizeBarcode(parsed.gtin || normCode);
 const variants = getBarcodeVariants(lookupCode);
 
 let matched = medicines.find(m => {
   const medBc = normalizeBarcode(m.barcode);
   const medBatch = normalizeBarcode(m.batchNumber);
   const medId = normalizeBarcode(m.id);
   return (
     variants.includes(medBc) || 
     variants.includes(medBatch) || 
     medBc === lookupCode || 
     medBatch === lookupCode ||
     medId === lookupCode
   );
 });
 
 // Fallback: If not found, try the raw barcode
 if (!matched && parsed.raw) {
   const rawNormalized = normalizeBarcode(parsed.raw);
   const rawVariants = getBarcodeVariants(rawNormalized);
   matched = medicines.find(m => {
     const medBc = normalizeBarcode(m.barcode);
     const medBatch = normalizeBarcode(m.batchNumber);
     const medId = normalizeBarcode(m.id);
     return (
       rawVariants.includes(medBc) || 
       rawVariants.includes(medBatch) || 
       medBc === rawNormalized || 
       medBatch === rawNormalized ||
       medId === rawNormalized
     );
   });
 }
 
  if (matched) {
  addItemToCart(matched);
  return;
  }

  // Fallback 2: catalog lookup — scan-to-add a medicine that exists in the
  // national catalog but not yet in this tenant's inventory (P3).
  const catalogItem = findMedicineByCode(lookupCode)
  || (parsed.raw ? findMedicineByCode(normalizeBarcode(parsed.raw)) : null);
  if (catalogItem) {
  const newMed = normalizeMedicine({
  id: `med-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  catalogId: catalogItem.id ? String(catalogItem.id) : undefined,
  name: catalogItem.name || catalogItem.nameEn || String(catalogItem.code || lookupCode),
  barcode: lookupCode,
  genericName: catalogItem.composition || catalogItem.nameEn || '',
  category: catalogItem.company || catalogItem.company_name || 'General',
  dosageForm: catalogItem.form || 'Tablet',
  price: Number(catalogItem.price) || 0,
  // The scanned box physically exists — one truthful unit; adjust in intake.
  stock: 1,
  minThreshold: 5,
  batchNumber: lookupCode,
  ownerId: currentSession?.pharmacyId,
  lastUpdated: new Date().toISOString()
  });
  try {
  if (onAddMedicine) {
  await onAddMedicine(newMed);
  triggerToast(
  lang === 'ar' ? `تمت إضافة ${newMed.name} من الكتالوج (1 وحدة)` : `Added ${newMed.name} from catalog (1 unit)`,
  'success'
  );
  addItemToCart(newMed, 1);
  return;
  }
  } catch (e) {
  console.warn('POS scan-to-add failed:', e);
  }
  }

  hardware.playScanError();
 setUnmappedBarcode(lookupCode);
 
 if (triggerToast) {
 triggerToast(
 lang === 'ar' 
 ? `الصنف غير مسجل في مستودعك. (${lookupCode}) انقر للربط.` 
 : `Item not registered in storage (${lookupCode}). Click to link.`,
 'error'
 );
 }
  }, [medicines, addItemToCart, hardware, lang, triggerToast, findMedicineByCode, onAddMedicine, currentSession]);

 useEffect(() => {
 if (externalScannedCode) {
 handleScan(externalScannedCode.code);
 }
 }, [externalScannedCode, handleScan]);

  // Complete checkout sale — paymentMethod 'Cash' | 'Credit' (P1 #3).
  // Credit sales record the customer name on the receivable (ledger row
  // status 'Pending'); settlement happens later from the Financial Ledger.
  const checkout = useCallback(async (paymentMethod = 'Cash', customerName?: string) => {
  if (stateRef.current.isProcessing) return;
  const currentCart = stateRef.current.cart;
  if (currentCart.length === 0) return;

  if (paymentMethod === 'Credit' && !(customerName || '').trim()) {
  triggerToast(
  lang === 'ar' ? 'أدخل اسم العميل لتسجيل الدين.' : 'Enter the customer name to record the debt.',
  'warning'
  );
  return;
  }

  stateRef.current.isProcessing = true;
  setIsProcessing(true);
  
  try {
  const checkoutSessionId = `SALE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const cartPayload = currentCart.map(item => ({
  medId: item.med.id,
  name: item.med.name,
  quantitySold: item.quantity,
  priceAtSale: item.med.price
  // NOTE: real unit cost is resolved from dispensed batch records during
  // checkout (utils/cost.ts) — never estimated here.
  }));
  
  const invoiceId = `INV-${Math.floor(10000 + Math.random() * 90000)}`;
  const total = currentCart.reduce((sum, item) => sum + (item.quantity * item.med.price), 0);
  
  const result = await onCompleteSale(cartPayload, paymentMethod, checkoutSessionId, customerName?.trim() || undefined);
  if (result.success) {
  hardware.playCheckoutSuccess();
  
  setLastSaleData({
  items: currentCart,
  total,
  time: new Date().toLocaleString(),
  invoiceId,
  paymentMethod,
  customerName: paymentMethod === 'Credit' ? (customerName || '').trim() : undefined
  });
  
  setCart([]);
  setShowSuccessOverlay(true);
  setPaymentMode('cash');
  setCreditCustomer('');
  if (searchInputRef.current) {
  searchInputRef.current.focus();
  }
  } else {
  triggerToast(result.error || 'Failed to complete sale', 'error');
  }
  } catch (err: any) {
  triggerToast(err.message || 'System error during checkout', 'error');
  } finally {
  stateRef.current.isProcessing = false;
  setIsProcessing(false);
  }
  }, [onCompleteSale, triggerToast, hardware, lang]);

 // Hardware Scanner keyboard shortcuts
 useEffect(() => {
 let timeout: NodeJS.Timeout;
 
 const handleKeyDown = (e: KeyboardEvent) => {
 const target = e.target as HTMLElement;
 const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
 
 setScannerReady(!isInput);

 if (e.key === 'F2') {
 e.preventDefault();
 setSearchQuery('');
 searchInputRef.current?.focus();
 return;
 }

 if (e.key === 'Escape') {
 e.preventDefault();
 setCart([]);
 setSearchQuery('');
 searchInputRef.current?.blur();
 return;
 }

 if (e.key === 'Enter') {
 if (barcodeBufferRef.current.length > 0) {
 e.preventDefault();
 handleScan(barcodeBufferRef.current);
 barcodeBufferRef.current = '';
 } else if (!isInput && stateRef.current.cart.length > 0) {
 e.preventDefault();
 checkout();
 } else if (isInput && stateRef.current.searchQuery && stateRef.current.filteredMedicines.length > 0) {
 e.preventDefault();
 const selectedMed = stateRef.current.filteredMedicines[stateRef.current.selectedIndex];
 if (selectedMed) {
 addItemToCart(selectedMed);
 setSearchQuery('');
 }
 }
 return;
 }

 if (e.key === 'ArrowUp') {
 if (isInput) {
 e.preventDefault();
 setSelectedIndex(prev => Math.max(0, prev - 1));
 }
 return;
 }

 if (e.key === 'ArrowDown') {
 if (isInput) {
 e.preventDefault();
 setSelectedIndex(prev => Math.min(stateRef.current.filteredMedicines.length - 1, prev + 1));
 }
 return;
 }

 if (!isInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
 barcodeBufferRef.current += e.key;
 clearTimeout(timeout);
 timeout = setTimeout(() => {
 barcodeBufferRef.current = ''; 
 }, 200); 
 }
 };

 const handleFocusIn = (e: FocusEvent) => {
 const target = e.target as HTMLElement;
 if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
 setScannerReady(false);
 }
 };
 
 const handleFocusOut = () => setScannerReady(true);

 window.addEventListener('keydown', handleKeyDown);
 window.addEventListener('focusin', handleFocusIn);
 window.addEventListener('focusout', handleFocusOut);
 
 return () => {
 window.removeEventListener('keydown', handleKeyDown);
 window.removeEventListener('focusin', handleFocusIn);
 window.removeEventListener('focusout', handleFocusOut);
 clearTimeout(timeout);
 };
 }, [handleScan, checkout, addItemToCart]);

 const updateQuantity = (medId: string, delta: number) => {
 setCart(prev => prev.map(item => {
 if (item.med.id === medId) {
 const newQ = item.quantity + delta;
 if (newQ > item.med.stock) {
 triggerToast(lang === 'ar' ? 'الكمية المطلوبة تتجاوز المخزون' : 'Requested quantity exceeds stock', 'info');
 return item;
 }
 return { ...item, quantity: Math.max(0, newQ) };
 }
 return item;
 }).filter(item => item.quantity > 0));
 };

 const totalDue = cart.reduce((sum, item) => sum + (item.med.price * item.quantity), 0);
 const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

 const handleOpenScannerClick = () => {
   setIsInlineScannerOpen(prev => !prev);
 };

 const handleRetryFailedTransaction = async (transaction: POSTransactionRecord) => {
 setIsProcessing(true);
 triggerToast(lang === 'ar' ? 'جاري إعادة المحاولة...' : 'Retrying transaction...', 'info');
 try {
 const result = await onCompleteSale(transaction.items, transaction.paymentMethod, transaction.transactionId);
 if (result.success) {
 triggerToast(lang === 'ar' ? 'تمت إعادة المحاولة بنجاح' : 'Retry successful', 'success');
 setFailedTransactions(prev => prev.filter(t => t.transactionId !== transaction.transactionId));
 } else {
 triggerToast(result.error || 'Retry failed', 'error');
 }
 } catch (e: any) {
 triggerToast(e.message || 'System error during retry', 'error');
 } finally {
 setIsProcessing(false);
 }
 };

 return (
 <div className="flex-1 w-full h-full flex flex-col bg-slate-50 text-slate-900 font-sans relative">

 {/* P1 #7 — first-run guidance: dismissible, non-blocking */}
 <FirstRunChecklist
 lang={lang}
 pharmacyName={pharmacyName}
 hasMedicines={medicines.length > 0}
 hasSales={hasCompletedSale}
 />
 
 {/* Offline sync status banners */}
 <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2">
 {failedTransactions.length > 0 && (
 <div className="bg-red-100 border border-red-300 text-red-800 px-4 py-2 rounded-xl shadow-md flex items-center gap-3 whitespace-nowrap">
 <AlertCircle className="w-5 h-5" />
 <div className="text-sm font-bold flex items-center gap-4">
 <span>{failedTransactions.length} {lang === 'ar' ? 'عملية فاشلة تحتاج مراجعة' : 'failed transaction(s) require review'}</span>
 <button 
 onClick={() => handleRetryFailedTransaction(failedTransactions[0])}
 className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs transition-colors"
 >
 {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
 </button>
 </div>
 </div>
 )}
 {pendingTransactions.length > 0 && (
 <div className="bg-amber-100 border border-amber-300 text-amber-800 px-4 py-2 rounded-xl shadow-md flex items-center gap-3 whitespace-nowrap">
 <RefreshCw className="w-5 h-5 animate-spin" />
 <div className="text-sm font-bold">
 {pendingTransactions.length} {lang === 'ar' ? 'عملية قيد المزامنة' : 'pending sync(s)'}
 </div>
 </div>
 )}
 </div>

 {/* Checkout Success Overlay */}
 <AnimatePresence>
 {showSuccessOverlay && lastSaleData && (
 <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
 <motion.div 
 initial={{ opacity: 0, scale: 0.95, y: 20 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: 20 }}
 className="bg-white rounded-xl shadow-lg w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]"
 >
 <div id="printable-receipt" className="p-6 bg-white flex-1 overflow-y-auto">
  <div className="text-center border-b border-dashed border-slate-300 pb-4 mb-4">
  <h2 className="text-xl font-black text-slate-900 mb-1">{pharmacyName || 'Eshmun Pharmacy'}</h2>
  <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">{lang === 'ar' ? 'إيصال رسمي' : 'Official Receipt'}</p>
  <p className="text-xs text-slate-400 mt-2 font-mono">{lastSaleData.time}</p>
  <p className="text-xs text-slate-400 font-mono mt-1">Receipt #{lastSaleData.invoiceId}</p>
  {lastSaleData.paymentMethod === 'Credit' && (
  <div className="mt-2 space-y-1">
  <p className="text-xs font-bold text-brand-600 bg-blue-50 py-1 px-2 rounded uppercase">Deferred / Credit</p>
  {lastSaleData.customerName && (
  <p className="text-xs font-bold text-amber-700 bg-amber-50 py-1 px-2 rounded">
  {lang === 'ar' ? 'على حساب' : 'Owed by'}: {lastSaleData.customerName}
  </p>
  )}
  </div>
  )}
  </div>
 
 <div className="space-y-3 mb-6">
 {lastSaleData.items.map((item, idx) => (
 <div key={idx} className="flex justify-between items-start text-sm">
 <div className="flex-1">
 <span className="font-bold text-slate-800 block">{item.med.name}</span>
 <span className="text-xs text-slate-500">{item.quantity} x {item.med.price.toLocaleString()} SYP</span>
 </div>
 <span className="font-mono font-black text-slate-900">
 {(item.quantity * item.med.price).toLocaleString()} SYP
 </span>
 </div>
 ))}
 </div>
 
 <div className="border-t border-dashed border-slate-300 pt-4 flex justify-between items-center">
 <span className="text-lg font-black text-slate-800">Total</span>
 <span className="text-xl font-black text-brand-700 font-mono">
 {lastSaleData.total.toLocaleString()} SYP
 </span>
 </div>
 </div>
 
 <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-3 no-print">
 <button 
 onClick={() => window.print()}
 className="py-3 px-4 bg-white border-2 border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors"
 >
 <span>️</span>
 {lang === 'ar' ? 'طباعة' : 'Print Receipt'}
 </button>
 <button 
 onClick={() => {
 setShowSuccessOverlay(false);
 setLastSaleData(null);
 }}
 className="py-3 px-4 bg-brand-700 hover:bg-brand-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
 >
 <span></span>
 {lang === 'ar' ? 'عملية جديدة' : 'Done / New Sale'}
 </button>
 </div>
 
 <style>{`
 @media print {
 body * { visibility: hidden; }
 #printable-receipt, #printable-receipt * { visibility: visible; }
 #printable-receipt { position: absolute; left: 0; top: 0; width: 100%; }
 .no-print { display: none !important; }
 }
 `}</style>
 </motion.div>
 </div>
 )}
 </AnimatePresence>

 
 {/* ----------------- POS TERMINAL UNIFIED WORKFLOW ----------------- */}
      <div className="flex-1 w-full overflow-y-auto bg-slate-50 p-3 sm:p-4 md:p-6 pb-28 md:pb-12">
        <div className="max-w-5xl mx-auto w-full flex flex-col gap-4">
          
          {/* SECTION 1: POS HEADER & SEARCH / BARCODE SCANNER */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-brand-700" />
                  {lang === "ar" ? "نقطة البيع (الكاشير)" : "Point of Sale (POS)"}
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  <TabIntro tabKey="pos">{lang === "ar" ? "مسح الباركود، تحديد الدواء، ومتابعة السلة" : "Scan barcode, select medicine, and manage cart"}</TabIntro>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                  title={lang === "ar" ? "سجل المبيعات" : "Sales history"}
                >
                  <History className="w-4 h-4 text-slate-500" />
                  {lang === "ar" ? "السجل" : "History"}
                </button>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono border ${
                  scannerReady ? "border-brand-200 text-brand-800 bg-brand-50" : "border-amber-200 text-amber-800 bg-amber-50"
                }`}>
                  {scannerReady ? <Zap className="w-4 h-4 text-brand-600" /> : <PauseCircle className="w-4 h-4 text-amber-600" />}
                  <span>{scannerReady ? (lang === "ar" ? "الماسح جاهز" : "SCANNER READY") : (lang === "ar" ? "الادخال اليدوي" : "INPUT MODE")}</span>
                </div>
              </div>
            </div>

            {/* HISTORY SLIDE-OVER — same live salesLogs source as the Ledger tab */}
            <AnimatePresence>
              {showHistory && (
                <motion.div
                  className="fixed inset-0 z-50 flex justify-end bg-slate-900/40"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onClick={() => setShowHistory(false)}
                >
                  <motion.div
                    className="bg-white w-full max-w-sm h-full shadow-2xl flex flex-col"
                    initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                    transition={{ type: 'tween', duration: 0.2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between p-4 border-b border-slate-100">
                      <h3 className="font-black text-slate-900 flex items-center gap-2">
                        <History className="w-4 h-4 text-brand-700" />
                        {lang === "ar" ? "سجل المبيعات" : "Sales History"}
                      </h3>
                      <button type="button" onClick={() => setShowHistory(false)} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label="close">
                        <X className="w-4 h-4 text-slate-500" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {(salesLogs || []).filter(s => s.type !== 'REFUND' && s.type !== 'CREDIT_SETTLEMENT').slice(0, 25).map((s) => {
                        const isOpen = expandedSaleId === s.saleId;
                        const refunded = s.status === 'Refunded' || Number((s as any).refundTotal || 0) > 0;
                        return (
                          <div key={s.saleId} className="border border-slate-200 rounded-xl overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExpandedSaleId(isOpen ? null : s.saleId)}
                              className="w-full flex items-center justify-between gap-2 p-3 hover:bg-slate-50 transition-colors cursor-pointer text-start"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 truncate">
                                  {lang === "ar" ? "فاتورة" : "Invoice"} <span className="font-mono">{(s.saleId || '').slice(-8)}</span>
                                  {refunded && <span className="ms-2 text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 rounded">{lang === "ar" ? "مرتجع" : "REFUNDED"}</span>}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono">
                                  {s.timestamp ? new Date(s.timestamp).toLocaleString(lang === "ar" ? 'ar-SY' : 'en-GB') : ''}
                                </p>
                              </div>
                              <div className="text-end shrink-0">
                                <p className="text-xs font-black text-slate-900 font-mono">{(Number(s.totalRevenue) || 0).toLocaleString()} {lang === "ar" ? "ل.س" : "SYP"}</p>
                                <p className="text-[10px] text-slate-400">
                                  {s.paymentMethod === 'Credit' ? (lang === "ar" ? "آجل" : "Credit") : (lang === "ar" ? "نقد" : "Cash")} · {(s.items || []).length} {lang === "ar" ? "أصناف" : "items"}
                                </p>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 space-y-1.5 border-t border-slate-100 pt-2">
                                {(s.items || []).map((it, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-700 font-medium truncate">{it.name}</span>
                                    <span className="text-slate-500 font-mono shrink-0 ms-2">{it.quantitySold} × {(it.priceAtSale || 0).toLocaleString()}</span>
                                  </div>
                                ))}
                                <p className="text-[10px] text-slate-400 pt-1">
                                  {lang === "ar" ? "للإرجاع: افتح تبويب السجل المالي" : "Returns: open the Financial Ledger tab"}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {(salesLogs || []).length === 0 && (
                        <p className="text-center text-xs text-slate-400 py-10">
                          {lang === "ar" ? "لا مبيعات بعد — ستظهر هنا مباشرة بعد أول عملية بيع" : "No sales yet — your first sale will appear here instantly"}
                        </p>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SEARCH & SCANNER INPUT */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-brand-600" />
              </div>
              <Input
                ref={searchInputRef as any}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === "ar" ? "مسح باركود أو إدخال اسم الدواء [F2]" : "Scan barcode or enter medicine name [F2]"}
                className="block w-full pl-11 pr-14 py-3 sm:py-3.5 border-2 border-brand-500 rounded-xl text-base sm:text-lg font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-brand-500/20 focus:border-brand-600 bg-slate-50 focus:bg-white transition-colors"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                onClick={handleOpenScannerClick}
                className={`absolute inset-y-2 right-2 px-3 flex items-center justify-center rounded-lg transition-all border cursor-pointer ${
                  isInlineScannerOpen || isCameraScannerOpen
                    ? "bg-brand-600 text-white border-brand-500 shadow-md ring-2 ring-brand-400/50"
                    : "bg-brand-100 text-brand-800 hover:bg-brand-200 border-brand-200"
                }`}
                title={lang === "ar" ? "ماسح الكاميرا" : "Camera Scanner"}
              >
                <Camera className={`w-5 h-5 ${isInlineScannerOpen ? "animate-pulse" : ""}`} />
              </button>
            </div>

            {/* Embedded Live Camera Scanner Viewport */}
            <InlineCameraScanner
              isOpen={isInlineScannerOpen}
              onClose={() => setIsInlineScannerOpen(false)}
              onScan={(code) => handleScan(code)}
              onExpandToModal={() => {
                setIsInlineScannerOpen(false);
                setIsCameraScannerOpen(true);
              }}
              medicines={medicines}
              lang={lang}
            />

            {/* Quick Category Filters */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {CATEGORY_PILLS.map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setSelectedCategory(pill.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-colors cursor-pointer ${
                    selectedCategory === pill.id
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 border border-slate-200"
                  }`}
                >
                  {lang === "ar" ? pill.labelAr : pill.labelEn}
                </button>
              ))}
            </div>
          </div>

          {/* SECTION 2: MEDICINE SEARCH RESULTS / SCAN FEEDBACK (When searching or filtered) */}
          {(searchQuery.trim().length > 0 || selectedCategory !== "all") && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600">
                <span>{lang === "ar" ? `نتائج البحث (${filteredMedicines.length})` : `Search Results (${filteredMedicines.length})`}</span>
                <button 
                  onClick={() => { setSearchQuery(""); setSelectedCategory("all"); }} 
                  className="text-brand-700 hover:underline cursor-pointer"
                >
                  {lang === "ar" ? "إغلاق النتائج" : "Clear Results"}
                </button>
              </div>

              <div className="max-h-64 sm:max-h-80 overflow-y-auto divide-y divide-slate-100">
                {filteredMedicines.length === 0 ? (
                  <div className="p-6 text-center text-slate-500">
                    {isSearchingAlternatives ? (
                      <div className="flex flex-col items-center justify-center py-4">
                        <Zap className="w-8 h-8 text-brand-600 animate-pulse mb-2" />
                        <p className="text-xs font-bold text-slate-700">
                          {lang === "ar" ? "جاري البحث عن البدائل التكافؤية..." : "Searching catalog for bio-equivalents..."}
                        </p>
                      </div>
                    ) : alternatives.length > 0 ? (
                      <GenericAlternativeCard
                        searchedBrand={searchQuery}
                        activeIngredientName={activeIngredientName}
                        alternatives={alternatives}
                        lang={lang}
                        onAddToCart={(altItem) => {
                          const med = medicines.find(m => m.id === altItem.id);
                          if (med) {
                            addItemToCart(med);
                            setSearchQuery("");
                            searchInputRef.current?.focus();
                          }
                        }}
                      />
                    ) : (
                      <div className="py-4">
                        <p className="text-sm font-bold text-slate-700 mb-1">
                          {lang === "ar" ? "لم يتم العثور على أدوية مطابقة" : "No matching medicines found"}
                        </p>
                        <p className="text-xs text-slate-400">
                          {lang === "ar" ? "جرب البحث بكلمة أخرى أو امسح الباركود." : "Try searching with a different name or scan the barcode."}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  visibleMedicines.map((med, idx) => (
                    <div 
                      key={med.id} 
                      className={`flex items-center justify-between p-3 hover:bg-brand-50/50 transition-colors cursor-pointer ${
                        med.stock <= 0 ? "bg-amber-50/30" : ""
                      } ${idx === selectedIndex && searchQuery ? "bg-brand-50 ring-1 ring-inset ring-brand-500/30" : ""}`}
                      onClick={() => {
                        if (med.stock > 0) {
                          addItemToCart(med);
                          setSearchQuery("");
                          searchInputRef.current?.focus();
                        } else {
                          setSubstitutionTarget(med);
                        }
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h4 className="font-bold text-slate-900 text-sm sm:text-base truncate">{med.name}</h4>
                          {med.stock <= 0 && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded uppercase">
                              {lang === "ar" ? "بدائل متوفرة" : "Equivalents"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {med.genericName && <span className="truncate max-w-[160px] sm:max-w-xs">{med.genericName}</span>}
                          <span className="text-slate-300">•</span>
                          <span className="font-mono">{med.barcode || "NO-BARCODE"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-bold text-brand-700 text-sm sm:text-base font-mono">
                            {med.price.toLocaleString()} <span className="text-[10px] text-brand-600/70">SYP</span>
                          </div>
                          <div className={`text-[11px] font-bold ${med.stock > 10 ? "text-slate-500" : "text-amber-600"}`}>
                            {lang === "ar" ? "المخزون:" : "Stock:"} {med.stock}
                          </div>
                        </div>
                        {med.stock > 0 ? (
                          <button 
                            type="button"
                            className="p-2 rounded-lg bg-brand-700 hover:bg-brand-800 text-white transition-colors shadow-sm cursor-pointer"
                            title={lang === "ar" ? "إضافة إلى السلة" : "Add to cart"}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        ) : (
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubstitutionTarget(med);
                            }}
                            className="p-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1"
                            title={lang === "ar" ? "عرض البدائل المتكافئة" : "View Equivalents"}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{lang === "ar" ? "البدائل" : "Equivalents"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SECTION 3: INTEGRATED CART (Continuous workflow: POS -> Scan -> Cart -> Checkout) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            {/* Cart Header */}
            <div className="p-3.5 sm:p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-brand-700" />
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  {lang === "ar" ? "سلة المبيعات" : "Transaction Cart"}
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold font-mono ${
                  cart.length > 0 ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-600"
                }`}>
                  {cart.reduce((s, i) => s + i.quantity, 0)} {lang === "ar" ? "عنصر" : "items"}
                </span>
              </div>
              {cart.length > 0 && (
                <button 
                  onClick={() => setCart([])} 
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  {lang === "ar" ? "إفراغ السلة" : "Clear All"}
                </button>
              )}
            </div>

            {/* Cart Content: Empty State vs Active List */}
            {cart.length === 0 ? (
              <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center text-slate-400 bg-slate-50/50">
                <ShoppingCart className="w-10 h-10 mb-2 text-slate-300" />
                <p className="font-bold text-slate-600 text-sm mb-0.5">
                  {lang === "ar" ? "السلة فارغة" : "Cart is empty"}
                </p>
                <p className="text-xs text-slate-400">
                  {lang === "ar" ? "قم بمسح الباركود أو ابحث عن دواء لإضافته إلى السلة." : "Scan a barcode or search for a medicine to begin."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Scrollable list of cart items */}
                <div className="max-h-72 sm:max-h-96 overflow-y-auto divide-y divide-slate-100">
                  <AnimatePresence initial={false}>
                    {cart.map((item) => (
                      <motion.div 
                        layout
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        key={item.id} 
                        className={`p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                          item.isRecentlyAdded ? "bg-brand-50/70" : "bg-white hover:bg-slate-50/60"
                        }`}
                      >
                        {/* Item Information */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-900 text-sm sm:text-base truncate">{item.med.name}</h4>
                            {item.allocatedBatch && item.allocatedBatch !== "N/A" && (
                              <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 text-[10px] font-mono rounded border border-slate-200">
                                {item.allocatedBatch}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {item.quantity} × {item.med.price.toLocaleString()} SYP = <span className="font-bold text-slate-800 font-mono">{(item.med.price * item.quantity).toLocaleString()} SYP</span>
                          </div>
                        </div>

                        {/* Stepper Controls & Line Total */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                            <button 
                              onClick={() => {
                                setCart(prev => prev.map(c => c.id === item.id ? { ...c, quantity: Math.max(1, c.quantity - 1) } : c));
                              }}
                              className="w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center bg-white text-slate-700 shadow-xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-8 sm:w-10 text-center font-bold text-sm font-mono text-slate-900">{item.quantity}</span>
                            <button 
                              onClick={() => {
                                if (item.quantity < item.med.stock) {
                                  setCart(prev => prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
                                } else {
                                  triggerToast(lang === "ar" ? "الكمية المطلوبة تتجاوز المخزون" : "Quantity exceeds stock", "info");
                                }
                              }}
                              className="w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center bg-white text-slate-700 shadow-xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="text-right min-w-[90px]">
                            <span className="font-bold text-slate-900 text-sm sm:text-base font-mono">
                              {(item.med.price * item.quantity).toLocaleString()}
                            </span>
                            <span className="text-[10px] text-slate-500 font-sans ml-1">SYP</span>
                          </div>

                          <button 
                            onClick={() => setCart(prev => prev.filter(c => c.id !== item.id))}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title={lang === "ar" ? "حذف العنصر" : "Remove item"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* TOTALS & COMPLETE SALE SECTION */}
                <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs sm:text-sm text-slate-600">
                    <span>{lang === "ar" ? "المجموع الفرعي" : "Subtotal"}</span>
                    <span className="font-mono font-bold text-slate-800">
                      {totalDue.toLocaleString()} SYP
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2">
                    <div>
                      <span className="text-base sm:text-lg font-black text-slate-900">{lang === "ar" ? "الإجمالي النهائي" : "GRAND TOTAL"}</span>
                      <span className="text-xs text-slate-500 font-medium block">
                        ({totalItemCount} {lang === "ar" ? "عناصر" : "items"})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl sm:text-3xl font-black text-brand-700 font-mono tracking-tight">
                        {totalDue.toLocaleString()}
                      </span>
                      <span className="text-sm font-bold text-brand-600/80 ml-1.5">SYP</span>
                    </div>
                  </div>

                  {/* Payment + Complete Sale (P1 #3): Cash | Credit/Owed */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      id="pos-payment-cash"
                      onClick={() => setPaymentMode('cash')}
                      disabled={cart.length === 0 || isProcessing}
                      className={`py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer border-2 ${
                        paymentMode === 'cash'
                          ? 'bg-brand-600 border-brand-700 text-white shadow-md shadow-brand-600/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      <span>{lang === "ar" ? "نقداً" : "Cash"}</span>
                    </button>
                    <button
                      id="pos-payment-credit"
                      onClick={() => setPaymentMode('credit')}
                      disabled={cart.length === 0 || isProcessing}
                      className={`py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer border-2 ${
                        paymentMode === 'credit'
                          ? 'bg-amber-500 border-amber-600 text-white shadow-md shadow-amber-500/20'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-amber-300'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>{lang === "ar" ? "دين / آجل" : "Credit / Owed"}</span>
                    </button>
                  </div>

                  {paymentMode === 'credit' && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-amber-800 uppercase tracking-wider">
                          {lang === "ar" ? "اسم العميل" : "Customer"}
                        </span>
                        <span className="font-black text-amber-800 font-mono">
                          {lang === "ar" ? "المبلغ المستحق" : "Amount owed"}: {totalDue.toLocaleString()} SYP
                        </span>
                      </div>
                      <input
                        id="pos-credit-customer"
                        type="text"
                        value={creditCustomer}
                        onChange={(e) => setCreditCustomer(e.target.value)}
                        placeholder={lang === "ar" ? "مثال: صيدلية الدكتور عمر" : "e.g. Dr. Omar"}
                        className="w-full px-3 py-2.5 bg-white border border-amber-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
                      />
                      <button
                        id="btn-complete-credit-sale"
                        onClick={() => checkout("Credit", creditCustomer)}
                        disabled={cart.length === 0 || isProcessing || !creditCustomer.trim()}
                        className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20 active:scale-[0.98] cursor-pointer"
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                        <span>
                          {lang === "ar"
                            ? `إتمام البيع آجل — ${totalDue.toLocaleString()} ل.س على العميل`
                            : `Complete Sale (Credit) — ${totalDue.toLocaleString()} SYP owed`}
                        </span>
                      </button>
                    </div>
                  )}

                  {paymentMode === 'cash' && (
                    <button
                      id="btn-complete-cash-sale"
                      onClick={() => checkout("Cash")}
                      disabled={cart.length === 0 || isProcessing}
                      className="w-full py-3.5 sm:py-4 rounded-xl font-bold text-base sm:text-lg flex items-center justify-center gap-2 sm:gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-700/20 active:scale-[0.98] cursor-pointer"
                    >
                      {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Receipt className="w-5 h-5" />}
                      <span>{lang === "ar" ? "إتمام البيع (الدفع نقداً) [Enter]" : "Complete Sale (Cash) [Enter]"}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
      
      {/* Generic Substitution Drawer */}

 <SubstitutionDrawer
 isOpen={!!substitutionTarget}
 onClose={() => setSubstitutionTarget(null)}
 targetMedicine={substitutionTarget}
 allMedicines={medicines}
 onSubstitute={(sub) => {
 addItemToCart(sub);
 setSearchQuery('');
 searchInputRef.current?.focus();
 }}
 lang={lang}
 />

 <CentralScannerModal
        isOpen={isCameraScannerOpen}
        mode="SELL"
        onClose={() => setIsCameraScannerOpen(false)}
        catalogData={medicines}
        onAddToCart={(item) => {
          const code = String(item.barcode || item.id || '').trim().replace(/,$/, '');
          handleScan(code);
        }}
        onAddStockItem={(barcode) => {
          handleScan(barcode);
        }}
        lang={lang}
      />

      <BarcodeLinkerModal
 isOpen={!!unmappedBarcode}
 onClose={() => setUnmappedBarcode(null)}
 scannedBarcode={unmappedBarcode || ''}
 lang={lang}
 triggerToast={triggerToast || (() => {})}
 onLinkComplete={() => {
 setUnmappedBarcode(null);
 setIsStockIntakeOpen(true);
 }}
 />
 
  {onAddMedicine && (
  <StockIntakeModal
  isOpen={isStockIntakeOpen}
  onClose={() => setIsStockIntakeOpen(false)}
  lang={lang}
  onAddMedicine={onAddMedicine}
  triggerToast={triggerToast}
  existingMedicines={medicines}
  />
  )}
 </div>
 );
}
