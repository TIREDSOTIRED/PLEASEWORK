import React, { useState, useMemo, useRef } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  AlertTriangle,
  TrendingDown,
  FileText,
  ChevronDown,
  SlidersHorizontal,
  Copy,
  Check,
  ShoppingBag,
  ExternalLink,
  Activity,
  Recycle,
  PackagePlus
} from 'lucide-react';
import { Medicine } from '../types';
import { CATEGORIES } from '../data/constants';
import { translations } from '../data/translations';
import { useAuth } from '../application/auth/AuthContext';
import { db } from '../infrastructure/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import SurplusPublishModal from './SurplusPublishModal';
import SurplusManageModal from './SurplusManageModal';
import { Skeleton } from './ui/Skeleton';
import StockIntakeModal from './warehouse/StockIntakeModal';
import MedicineRow from './MedicineRow';
import MedicineDetailsDrawer from './MedicineDetailsDrawer';

/** Mirrors the manage-modal listing shape (catalogId-keyed). */
interface SurplusListing {
  offerDocId: string;
  active: boolean;
  availableQuantity: number;
  priceSyp: number;
}

interface InventoryTabProps {
 medicines: Medicine[];
  onUpdateStock: (id: string, delta: number, note?: string) => void;
  /** Coalesced quick adjust: optimistic local bump, StockEngine flushes the burst. */
  onQuickAdjust?: (id: string, delta: number, note?: string) => void;
  /** Whitelisted medicine-level metadata persistence (drawer edits). */
  onUpdateMedicine?: (m: Partial<Medicine> & Pick<Medicine, 'id'>) => Promise<unknown> | void;
 onSelectMedicine: (id: string) => void;
  onAddMedicine?: (m: Medicine) => Promise<void>;
  /** True until the first Firestore snapshot for this tenant arrives. */
  isLoadingInventory?: boolean;
 searchQuery: string;
 setSearchQuery: (val: string) => void;
 categoryFilter: string;
 setCategoryFilter: (val: string) => void;
 sortBy: 'name' | 'stock' | 'expiryDate' | 'lastUpdated';
 setSortBy: (val: 'name' | 'stock' | 'expiryDate' | 'lastUpdated') => void;
 sortOrder: 'asc' | 'desc';
 setSortOrder: (val: 'asc' | 'desc') => void;
 triggerToast: (message: string, type: 'success' | 'info') => void;
 lang?: 'en' | 'ar';
}

export default function InventoryTab({
 medicines,
 onUpdateStock,
 onQuickAdjust,
 onUpdateMedicine,
 onSelectMedicine,
 onAddMedicine,
 isLoadingInventory = false,
 searchQuery,
 setSearchQuery,
 categoryFilter,
 setCategoryFilter,
 sortBy,
 setSortBy,
 sortOrder,
 setSortOrder,
 triggerToast,
 lang = 'en',
}: InventoryTabProps) {
 const t = translations[lang];
 const { currentSession, activePharmacy } = useAuth();
 const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
 const [isStockIntakeOpen, setIsStockIntakeOpen] = useState(false);
 const [copied, setCopied] = useState(false);
 const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'discrepancy'>('all');
 // Phase 2: row details drawer (read-only). id -> medicine resolved at render.
 const [detailsMedId, setDetailsMedId] = useState<string | null>(null);

 // Surplus Exchange: publish private stock as a marketplace offer
 const [surplusMed, setSurplusMed] = useState<Medicine | null>(null);

 const [manageMed, setManageMed] = useState<Medicine | null>(null);
 // Centralized "My Surplus Listings" mini-manager
 const [showSurplusPanel, setShowSurplusPanel] = useState(false);
 // catalogId -> existing surplus listing (fetched once per session; refetch on change)
 const [surplusListings, setSurplusListings] = useState<Record<string, SurplusListing>>({});
 const activeSurplusCount = (Object.values(surplusListings) as SurplusListing[]).filter(l => l.active).length;

 const loadMySurplusListings = React.useCallback(async () => {
  if (!currentSession?.pharmacyId || !db) return;
  try {
  const snap = await getDocs(query(
  collection(db, 'wholesale_offers'),
  where('sellerTenantId', '==', currentSession.pharmacyId)
  ));
  const map: Record<string, SurplusListing> = {};
  snap.forEach(d => {
  const o = d.data() as any;
  if ((o as any).offerKind !== 'surplus') return;
  const key = String(o.catalogId || d.id).replace(/\//g, '_');
  map[key] = { offerDocId: d.id, active: o.active !== false, availableQuantity: Number(o.availableQuantity ?? o.stock ?? 0), priceSyp: Number(o.priceSyp ?? o.price ?? 0) };
  });
  setSurplusListings(map);
  } catch (e) {
  console.warn('Surplus listings load failed:', e);
  }
 }, [currentSession?.pharmacyId]);

 React.useEffect(() => {
  loadMySurplusListings();
 }, [loadMySurplusListings]);

 const listingFor = (med: Medicine): SurplusListing | undefined => {
  const key = String(med.catalogId || med.id || '').replace(/\//g, '_');
  return surplusListings[key];
 };

 // Helper to translate categories visually for Arabic
 const translateCategory = (cat: string) => {
 if (lang !== 'ar') return cat;
 const cats: Record<string, string> = {
 'All': 'الكل',
 'Antibiotics': 'مضادات حيوية',
 'Cardiology': 'أدوية القلب',
 'Analgesics': 'مسكنات الألم',
 'Antivirals': 'مضادات الفيروسات',
 'Diabetic': 'أدوية السكري',
 'Imported': 'مخزون مستورد',
 };
 return cats[cat] || cat;
 };

 // Helper to translate sort criteria
 const translateSortOption = (opt: string) => {
 if (lang !== 'ar') {
 if (opt === 'name') return 'Component Name';
 if (opt === 'stock') return 'Current Stock';
 if (opt === 'expiryDate') return 'Expiry Date';
 return 'Last Dispensation';
 }
 if (opt === 'name') return 'اسم الدواء التجاري';
 if (opt === 'stock') return 'المخزون الحالي';
 if (opt === 'expiryDate') return 'تاريخ الصلاحية';
 return 'آخر حركة تعديل';
 };

 // Filter & Sort medicines (memoized — identical semantics; date epochs
 // precomputed once per item instead of inside the comparator, preserving
 // invalid/missing-date NaN ordering behavior exactly).
 const filteredMedicines = useMemo(() => medicines.filter(med => {
  const query = searchQuery.toLowerCase().trim();
  const matchesSearch = 
  !query ||
  med.name.toLowerCase().includes(query) ||
  (med.genericName && med.genericName.toLowerCase().includes(query)) ||
  (med.barcode && med.barcode.toLowerCase().includes(query)) ||
  med.batchNumber.toLowerCase().includes(query) ||
  (med.shelfLocation && med.shelfLocation.toLowerCase().includes(query)) ||
  (med.category && med.category.toLowerCase().includes(query)) ||
  (med.supplier && med.supplier.toLowerCase().includes(query));
  
  const matchesCategory = categoryFilter === 'All' || med.category === categoryFilter;
  
  let matchesLowStock = true;
  if (stockFilter === 'low') matchesLowStock = med.stock < med.minThreshold && med.stock > 0;
  if (stockFilter === 'out') matchesLowStock = med.stock === 0;
  if (stockFilter === 'discrepancy') matchesLowStock = med.stock < 0;
  
  return matchesSearch && matchesCategory && matchesLowStock;
 }), [medicines, searchQuery, categoryFilter, stockFilter]);

 const sortedMedicines = useMemo(() => {
  const withEpochs = filteredMedicines.map(med => ({
  med,
  expiryEpoch: new Date(med.expiryDate).getTime(),
  updatedEpoch: new Date(med.lastUpdated).getTime()
  }));
  return withEpochs.sort((a, b) => {
  let comparison = 0;
  if (sortBy === 'name') {
  comparison = a.med.name.localeCompare(b.med.name);
  } else if (sortBy === 'stock') {
  comparison = a.med.stock - b.med.stock;
  } else if (sortBy === 'expiryDate') {
  comparison = a.expiryEpoch - b.expiryEpoch;
  } else if (sortBy === 'lastUpdated') {
  comparison = a.updatedEpoch - b.updatedEpoch;
  }
  return sortOrder === 'asc' ? comparison : -comparison;
  }).map(entry => entry.med);
 }, [filteredMedicines, sortBy, sortOrder]);

 // Calculate critical low stock items
 const lowStockItems = useMemo(() => medicines.filter(med => med.stock < med.minThreshold), [medicines]);

 // Generate the Phase 2 Compressed Data Bridge Order Sheet
 const generateOrderString = () => {
 if (lowStockItems.length === 0) return "ORDER_INBOUND // NO_ITEMS_LOW";
 
 // Formula: restock quantity = (minThreshold * 2) - stock
 const orders = lowStockItems.map(med => {
 const suggestedQty = (med.minThreshold * 2) - med.stock;
 return `${med.name.toUpperCase()}:${suggestedQty}`;
 });
 
 return `ORDER_INBOUND // ${orders.join(' | ')}`;
 };

 const copyOrderToClipboard = () => {
 const orderStr = generateOrderString();
 navigator.clipboard.writeText(orderStr).then(() => {
 setCopied(true);
 triggerToast(lang === 'ar' ? "تم نسخ بيان الطلب المضغوط!" : "Order sheet compressed & copied!", "success");
 setTimeout(() => setCopied(false), 2000);
 }).catch(err => {
 console.error("Failed to copy", err);
 triggerToast(lang === 'ar' ? "فشل النسخ. يرجى النسخ يدوياً." : "Failed to copy. Please manually copy the code.", "info");
 });
 };

 return (
 <div id="inventory-tab-root" className="space-y-6">
 {/* Header Info Banner - smooth scroll away section */}
 <div className="space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-brand-950 flex items-center gap-2">
 <Activity className="text-brand-700 w-6 h-6 stroke-[2.5]" />
 {t.medicineInventoryLedger}
 </h1>
 <p className="text-slate-500 text-xs mt-0.5">
 {t.secureLedgerDescription}
 </p>
 </div>
              <div className="flex items-center gap-3">
              <button
              id="btn-my-surplus-listings"
              onClick={() => setShowSurplusPanel(true)}
              title={lang === 'ar' ? 'إدارة عروض الفائض المنشورة' : 'Manage your published surplus listings'}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-xs transition-all duration-200 border cursor-pointer ${
                activeSurplusCount > 0
                  ? 'bg-brand-50 text-brand-800 border-brand-200 hover:bg-brand-100'
                  : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
              }`}
            >
              <Recycle className="w-4 h-4" />
              {lang === 'ar' ? `فائضي (${activeSurplusCount})` : `My Surplus (${activeSurplusCount})`}
            </button>
              <button
              id="btn-ledger-add-medicine"
              onClick={() => setIsStockIntakeOpen(true)}
 className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl font-semibold text-xs transition-all duration-200 shadow-sm shadow-blue-500/10 active:scale-95 cursor-pointer"
 >
 <PackagePlus className="w-4 h-4" />
 {lang === 'ar' ? 'إضافة دواء / إدخال مخزون' : 'Add Medicine'}
 </button>
 <button
 id="btn-gen-order-sheet"
 onClick={() => setIsOrderModalOpen(true)}
 className="flex items-center gap-2 bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-xl font-semibold text-xs transition-all duration-200 shadow-sm shadow-blue-500/10 active:scale-95 cursor-pointer"
 >
 <FileText className="w-3.5 h-3.5" />
 {t.generateRestockOrder}
 {lowStockItems.length > 0 && (
 <span className="bg-white/20 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
 {lowStockItems.length}
 </span>
 )}
 </button>
 </div>
 </div>

 {/* Low Stock Alerts Banner */}
 <AnimatePresence>
 {lowStockItems.length > 0 ? (
 <motion.div
 initial={{ opacity: 0, y: -10 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -10 }}
 className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 text-amber-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
 >
 <div className="flex items-start gap-3">
 <div className="p-1.5 bg-amber-100 rounded-lg text-amber-600 mt-0.5 md:mt-0 shrink-0">
 <AlertTriangle className="w-4.5 h-4.5" />
 </div>
 <div>
 <h3 className="font-bold text-amber-900 text-xs uppercase tracking-wider font-mono">{t.safetyThresholdViolated}</h3>
 <p className="text-xs text-amber-700 mt-0.5 font-medium">
 {lang === 'ar' ? (
 <>تم رصد <span className="font-bold text-amber-950 ">{lowStockItems.length}</span> من الأدوية والمواد الأساسية تحت الحد الأدنى للسلامة.</>
 ) : (
 <>We detected <span className="font-bold text-amber-900">{lowStockItems.length}</span> critical clinical components falling below active safety limits.</>
 )}
 </p>
 <div className="flex flex-wrap gap-1.5 mt-2">
 {lowStockItems.map(item => (
 <button 
 key={item.id} 
 onClick={() => onSelectMedicine(item.id)}
 className="bg-amber-100/60 hover:bg-amber-200/80 :bg-amber-900/60 border border-amber-200 rounded-lg px-2 py-0.5 text-[10px] font-mono font-bold text-amber-800 flex items-center gap-1.5 transition-colors cursor-pointer"
 >
 <span className="w-1 h-1 rounded-full bg-amber-600 animate-ping"></span>
 {item.name} ({item.stock}/{item.minThreshold})
 </button>
 ))}
 </div>
 </div>
 </div>
 <button
 id="btn-alert-review"
 onClick={() => setIsOrderModalOpen(true)}
 className="text-[10px] uppercase font-bold bg-white hover:bg-amber-100/50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-xl transition-all shrink-0 font-mono cursor-pointer"
 >
 {lang === 'ar' ? 'مراجعة طلب التوريد' : 'Review Restock Sheet'}
 </button>
 </motion.div>
 ) : (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 className="p-3.5 rounded-xl border border-brand-100 bg-brand-50/40 text-brand-800 text-xs flex items-center gap-2 font-medium"
 >
 <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse"></span>
 {t.allClinicalComponentsSecure}
 </motion.div>
 )}
 </AnimatePresence>
 </div>

 {/* Control Panel: Search & Filters - Clinical Clean Styling */}
 <div className="p-4 rounded-xl bg-white border border-brand-100/80 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center shadow-sm">
 {/* Search Bar */}
 <div className="relative lg:col-span-4">
 <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
 <input
 id="search-input"
 type="text"
 placeholder={t.searchPlaceholder}
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full bg-[#F4F7F5] border border-brand-100/80 focus:border-brand-500/50 rounded-xl py-2 pl-9 pr-4 text-xs text-brand-950 placeholder-slate-400 focus:outline-none transition-all font-semibold"
 />
 </div>

 {/* Stock Status Filter Tabs */}
 <div className="lg:col-span-12 flex items-center gap-2 mb-2 overflow-x-auto pb-2 scrollbar-hide">
 <button
 onClick={() => setStockFilter('all')}
 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap ${stockFilter === 'all' ? 'bg-white border-brand-500 text-brand-700 shadow-sm' : 'bg-[#F4F7F5] border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
 >
 {lang === 'ar' ? 'جميع المواد' : 'All Items'}
 </button>
 <button
 onClick={() => setStockFilter('low')}
 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap ${stockFilter === 'low' ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm' : 'bg-[#F4F7F5] border-transparent text-slate-500 hover:text-amber-700 hover:bg-amber-50'}`}
 >
 {lang === 'ar' ? 'تنبيه نقص المخزون' : 'Low Stock Alert'}
 </button>
 <button
 onClick={() => setStockFilter('out')}
 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap ${stockFilter === 'out' ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-sm' : 'bg-[#F4F7F5] border-transparent text-slate-500 hover:text-rose-700 hover:bg-rose-50'}`}
 >
 {lang === 'ar' ? 'نفذت الكمية' : 'Out of Stock'}
 </button>
 <button
 onClick={() => setStockFilter('discrepancy')}
 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap flex items-center gap-2 ${stockFilter === 'discrepancy' ? 'bg-red-100 border-red-400 text-red-800 shadow-sm' : 'bg-[#F4F7F5] border-transparent text-slate-500 hover:text-red-800 hover:bg-red-50'}`}
 >
 <AlertTriangle className="w-3 h-3" />
 {lang === 'ar' ? 'فروقات الجرد (سالب)' : 'Discrepancies'}
 </button>
 </div>
 {/* Category Filter */}
 <div className="relative lg:col-span-2">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-slate-400 uppercase">
 {t.catLabel}
 </span>
 <select
 id="category-filter"
 value={categoryFilter}
 onChange={(e) => setCategoryFilter(e.target.value)}
 className="w-full bg-[#F4F7F5] border border-brand-100/80 focus:border-brand-500/50 rounded-xl py-2 pl-12 pr-4 text-xs text-slate-700 font-semibold focus:outline-none transition-all appearance-none cursor-pointer"
 >
 {CATEGORIES.map(cat => (
 <option key={cat} value={cat}>
 {translateCategory(cat)}
 </option>
 ))}
 </select>
 <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
 </div>

 {/* Sort By */}
 <div className="relative lg:col-span-3">
 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-slate-400 uppercase">
 {t.sortLabel}
 </span>
 <select
 id="sort-by"
 value={sortBy}
 onChange={(e) => setSortBy(e.target.value as any)}
 className="w-full bg-[#F4F7F5] border border-brand-100/80 focus:border-brand-500/50 rounded-xl py-2 pl-12 pr-4 text-xs text-slate-700 font-semibold focus:outline-none transition-all appearance-none cursor-pointer"
 >
 <option value="name">{translateSortOption('name')}</option>
 <option value="stock">{translateSortOption('stock')}</option>
 <option value="expiryDate">{translateSortOption('expiryDate')}</option>
 <option value="lastUpdated">{translateSortOption('lastUpdated')}</option>
 </select>
 <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
 </div>

 {/* Sort Order Direction Toggle */}
 <div className="lg:col-span-1 flex justify-end">
 <button
 id="btn-sort-order"
 onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
 title={`Sorting ${sortOrder.toUpperCase()}`}
 className="p-2 rounded-xl border border-brand-100/80 bg-[#F4F7F5] hover:bg-slate-100 text-slate-500 hover:text-brand-950 :text-slate-100 transition-colors cursor-pointer w-full flex items-center justify-center gap-2 lg:gap-0"
 >
 <SlidersHorizontal className="w-3.5 h-3.5 stroke-[2.2]" />
 <span className="lg:hidden text-[10px] text-slate-500 uppercase font-mono font-bold">
 {sortOrder}
 </span>
 </button>
 </div>
 </div>

 {/* Main Stock Inventory List */}
 <div className="space-y-3">
 <div className="flex items-center justify-between px-1">
 <h2 className="text-xs uppercase font-mono font-bold text-slate-400 tracking-wider flex items-center gap-2">
 <span>{lang === 'ar' ? 'سجل الأدوية الفعلي' : 'Clinical Stock Registry'}</span>
 <span className="text-[10px] font-mono text-slate-500 bg-slate-100 border border-brand-100/60 px-2.5 py-0.5 rounded-full">
 {sortedMedicines.length} {lang === 'ar' ? 'مادة مدرجة' : 'component(s) listed'}
 </span>
 </h2>
 <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest font-bold">{lang === 'ar' ? 'السعر بالليرة السورية' : 'SYRIAN POUNDS (ل.س)'}</span>
 </div>

 {isLoadingInventory && medicines.length === 0 ? (
 /* First snapshot hasn't arrived yet — skeleton rows, never a fake "empty". */
 <div className="space-y-2.5">
 {Array.from({ length: 5 }).map((_, i) => (
 <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
 <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
 <div className="flex-1 space-y-2">
 <Skeleton className="h-3.5 w-1/3" />
 <Skeleton className="h-3 w-1/2" />
 </div>
 <Skeleton className="h-9 w-28 rounded-lg shrink-0" />
 </div>
 ))}
 </div>
 ) : sortedMedicines.length === 0 ? (
 <div className="p-12 rounded-xl bg-white border border-brand-100/80 text-center shadow-sm">
 <TrendingDown className="w-10 h-10 text-slate-300 mx-auto mb-2" />
 {medicines.length === 0 ? (
 <>
 <p className="text-slate-600 font-bold text-sm">
 {lang === 'ar' ? 'لم يتم العثور على أدوية في قاعدة البيانات.' : 'No medicines found in database.'}
 </p>
 <p className="text-slate-400 text-xs mt-1 font-mono">
 {lang === 'ar' ? 'يرجى إضافة دواء أو حقن البيانات.' : 'Please add a medicine or seed data.'}
 </p>
 </>
 ) : (
 <>
 <p className="text-slate-600 font-bold text-sm">
 {lang === 'ar' ? 'لا توجد أدوية تطابق خيارات البحث.' : 'No clinical components match criteria.'}
 </p>
 <p className="text-slate-400 text-xs mt-1">
 {lang === 'ar' ? 'يرجى مراجعة وتعديل عبارات البحث أو اختيار فئة مختلفة.' : 'Refine your search parameters or select a different category.'}
 </p>
 <button
 onClick={() => {
 setSearchQuery('');
 setCategoryFilter('All');
 }}
 className="mt-4 px-4 py-2 bg-slate-100 border border-brand-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
 >
 {lang === 'ar' ? 'إعادة ضبط البحث' : 'Reset Search Parameters'}
 </button>
 </>
 )}
 </div>
 ) : (
  /* Dense Data-Driven List View */
  <div className="space-y-2.5">
  {sortedMedicines.map((item) => (
  <MedicineRow
  key={item.id}
  medicine={item}
  role="pharmacy"
  lang={lang}
  onSelect={(id) => setDetailsMedId(id)}
  onQuickAdjust={(id, delta, note) => (onQuickAdjust || onUpdateStock)(id, delta, note)}
  roleActions={
  <button
  type="button"
  onClick={() => {
  if ((item.stock || 0) <= 0 && !listingFor(item)) {
  triggerToast(lang === 'ar' ? 'لا يوجد مخزون لنشره' : 'No stock available to publish', 'info');
  return;
  }
  listingFor(item) ? setManageMed(item) : setSurplusMed(item);
  }}
  title={listingFor(item)
  ? (lang === 'ar' ? 'إدارة عرض الفائض المنشور' : 'Manage published surplus listing')
  : (lang === 'ar' ? 'نشر الفائض في سوق الجملة' : 'Publish surplus to marketplace')}
  aria-label={listingFor(item)
  ? (lang === 'ar' ? 'إدارة عرض الفائض المنشور' : 'Manage published surplus listing')
  : (lang === 'ar' ? 'نشر الفائض في سوق الجملة' : 'Publish surplus to marketplace')}
  className={`w-11 h-11 flex items-center justify-center border rounded-xl transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
  listingFor(item)?.active
  ? 'bg-brand-50 border-brand-300 text-brand-800 hover:bg-brand-100'
  : 'bg-emerald-50 border-emerald-200/70 text-emerald-600 hover:bg-emerald-100'
  }`}
  >
  <Recycle className="w-4 h-4" aria-hidden="true" />
  </button>
  }
  />
  ))}
  </div>
  )}
 </div>

 {/* Generation of Compact Plain Text Order Sheet Modal */}
 <AnimatePresence>
 {isOrderModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-950/40 backdrop-blur-sm">
 <motion.div
 initial={{ scale: 0.95, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 exit={{ scale: 0.95, opacity: 0 }}
 id="order-sheet-modal"
 className="w-full max-w-lg bg-white border border-brand-100 p-6 rounded-xl shadow-md relative"
 >
 <div className="flex justify-between items-start mb-4">
 <div>
 <h3 className="text-md font-bold text-brand-950 flex items-center gap-2">
 <ShoppingBag className="text-brand-700" />
 {lang === 'ar' ? 'مولد طلبات التوريد الموحد' : 'Wholesale Order Dispatcher'}
 </h3>
 <p className="text-xs text-slate-400 mt-0.5">
 {lang === 'ar' ? 'توليد حزم بروتوكول الطلب التلقائي للمستودع الموزع.' : 'Generates automated B2B telemetry reorder payloads for supply sync.'}
 </p>
 </div>
 <button
 onClick={() => setIsOrderModalOpen(false)}
 className="p-1.5 hover:bg-slate-100 :bg-slate-700 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
 >
 ×
 </button>
 </div>

 {lowStockItems.length === 0 ? (
 <div className="py-8 text-center text-slate-500 text-xs font-semibold">
 <Check className="w-6 h-6 text-brand-500 mx-auto mb-2" />
 {lang === 'ar' ? 'جميع المواد تطابق معايير الأمان المحددة.' : 'All stock items conform to active minimum safety thresholds.'}
 </div>
 ) : (
 <div className="space-y-4">
 <div>
 <div className="text-[10px] font-bold text-slate-400 mb-2 font-mono uppercase tracking-wider">
 {t.reorderAnalysisList}
 </div>
 <div className="max-h-40 overflow-y-auto space-y-2 border border-brand-100 bg-[#F4F7F5] p-3 rounded-xl scrollbar">
 {lowStockItems.map(item => {
 const targetQty = item.minThreshold * 2;
 const suggestedOrder = targetQty - item.stock;
 return (
 <div key={item.id} className="flex justify-between text-xs font-mono text-slate-600 border-b border-brand-100/50 pb-1.5 last:border-0 last:pb-0">
 <span>{item.name}</span>
 <span>
 {lang === 'ar' ? 'المخزون الحالي' : 'Stock'}: <b className="text-amber-600">{item.stock}</b> | {lang === 'ar' ? 'المقترح' : 'Suggested'}: <b className="text-brand-600">+{suggestedOrder}</b>
 </span>
 </div>
 );
 })}
 </div>
 </div>

 <div>
 <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-1.5 font-mono uppercase tracking-wider">
 <span>{t.telemetryPayload}</span>
 <span className="text-[10px] text-brand-700 lowercase italic">{lang === 'ar' ? 'جاهز للنسخ والمشاركة' : 'Ready to share'}</span>
 </div>
 <div className="relative">
 <textarea
 readOnly
 value={generateOrderString()}
 className="w-full bg-slate-100 border border-slate-950 text-brand-400 font-mono text-xs p-3 rounded-xl h-24 focus:outline-none resize-none select-all shadow-inner"
 />
 <button
 id="btn-copy-payload"
 onClick={copyOrderToClipboard}
 className="absolute right-2 bottom-2 px-3 py-1 bg-white border border-brand-100 hover:bg-[#F4F7F5] text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-mono font-bold shadow-sm cursor-pointer"
 >
 {copied ? (
 <>
 <Check className="w-3.5 h-3.5 text-brand-600" />
 {lang === 'ar' ? 'تم النسخ' : 'Copied'}
 </>
 ) : (
 <>
 <Copy className="w-3.5 h-3.5" />
 {t.copyPayload}
 </>
 )}
 </button>
 </div>
 <p className="text-[10px] text-slate-400 mt-2 italic flex items-center gap-1.5">
 <ExternalLink className="w-3 h-3 text-slate-300" />
 {lang === 'ar' ? 'بنية حمولة البيانات: "ORDER_INBOUND // BRAND:QTY | BRAND:QTY..."' : 'Payload structure: "ORDER_INBOUND // BRAND:QTY | BRAND:QTY..."'}
 </p>
 </div>

 <div className="flex justify-end gap-3 pt-2">
 <button
 onClick={() => setIsOrderModalOpen(false)}
 className="px-4 py-2 bg-slate-100 border border-brand-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
 >
 {t.closeView}
 </button>
 <button
 onClick={copyOrderToClipboard}
 className="px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
 >
 <Copy className="w-3.5 h-3.5" />
 {t.copyAndClose}
 </button>
 </div>
 </div>
 )}
 </motion.div>
 </div>
 )}
 </AnimatePresence>

               <StockIntakeModal
 isOpen={isStockIntakeOpen}
 onClose={() => setIsStockIntakeOpen(false)}
 lang={lang}
 onAddMedicine={onAddMedicine || (async () => {})}
 triggerToast={triggerToast}
 existingMedicines={medicines}
 />

 {/* Surplus Exchange — publish private stock to the marketplace */}
 {/* My Surplus Listings — centralized mini-manager */}
 <Modal
 isOpen={showSurplusPanel}
 onClose={() => setShowSurplusPanel(false)}
 title={lang === 'ar' ? `عروض الفائض المنشورة (${activeSurplusCount})` : `My Surplus Listings (${activeSurplusCount})`}
 maxWidth="md"
 >
 {activeSurplusCount === 0 ? (
 <div className="py-10 text-center space-y-2">
 <Recycle className="w-10 h-10 text-slate-300 mx-auto" />
 <p className="text-sm font-bold text-slate-600">
 {lang === 'ar' ? 'لا توجد عروض فائض منشورة بعد.' : 'No published surplus listings yet.'}
 </p>
 <p className="text-xs text-slate-400">
 {lang === 'ar' ? 'استخدم زر «نشر الفائض» بجانب أي دواء متوفر في المخزون.' : 'Use the recycle button next to any in-stock medicine to publish one.'}
 </p>
 </div>
 ) : (
 <div className="space-y-3">
 {Object.entries(surplusListings as Record<string, SurplusListing>).filter(([, l]) => l.active).map(([key, listing]) => {
 const med = medicines.find(m => String(m.catalogId || m.id).replace(/\//g, '_') === key);
 const name = med ? (lang === 'ar' ? med.name : (med as any).nameEn || med.name) : key;
 return (
 <div key={key} className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl">
 <div className="min-w-0">
 <p className="text-xs font-bold text-slate-800 truncate">{name}</p>
 <p className="text-[10px] font-mono text-slate-400">
 {listing.availableQuantity} {lang === 'ar' ? 'وحدة' : 'units'} · {listing.priceSyp.toLocaleString()} SYP
 {med?.expiryDate && (
 <span className="ms-2 text-amber-600">{lang === 'ar' ? 'ينتهي' : 'exp.'} {String(med.expiryDate).slice(0, 10)}</span>
 )}
 </p>
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => {
 if (med) { setManageMed(med); setShowSurplusPanel(false); }
 }}
 >
 {lang === 'ar' ? 'إدارة' : 'Manage'}
 </Button>
 </div>
 );
 })}
 <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
 {lang === 'ar'
 ? 'الإدارة تشمل: تعديل الكمية/السعر، الإخفاء المؤقت، أو الإزالة النهائية مع إشعار الصيدليات المتأثرة.'
 : 'Manage opens the editor: update qty/price, pause visibility, or remove entirely — affected pharmacies are notified automatically.'}
 </p>
 </div>
 )}
 </Modal>

 <SurplusPublishModal
 isOpen={!!surplusMed}
 medicine={surplusMed}
 onClose={() => { setSurplusMed(null); loadMySurplusListings(); }}
 seller={{
 tenantId: currentSession?.pharmacyId || '',
 name: activePharmacy?.name || currentSession?.fullName || 'Pharmacy',
 nameAr: activePharmacy?.nameAr,
 city: typeof activePharmacy?.location === 'string' ? activePharmacy.location : activePharmacy?.location?.city
 }}
 lang={lang}
 triggerToast={triggerToast}
 />

 {/* Surplus Exchange — manage an existing listing (edit / pause / remove) */}
 <SurplusManageModal
 isOpen={!!manageMed}
 medicine={manageMed}
 listing={manageMed ? surplusListings[String(manageMed.catalogId || manageMed.id).replace(/\//g, '_')] || null : null}
 sellerTenantId={currentSession?.pharmacyId || ''}
 onClose={() => setManageMed(null)}
 lang={lang}
 triggerToast={triggerToast}
 onChanged={loadMySurplusListings}
 />

 {/* Phase 2: read-only medicine details drawer (row tap) — Phase 3 adds controlled edits */}
 <MedicineDetailsDrawer
 medicine={medicines.find(m => m.id === detailsMedId) || null}
 role="pharmacy"
 lang={lang}
 onClose={() => setDetailsMedId(null)}
 onUpdateMedicine={onUpdateMedicine}
 />
 </div>
 );
}
