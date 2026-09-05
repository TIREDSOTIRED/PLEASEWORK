import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
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
  PackagePlus,
  Pencil,
  Loader2,
  Truck
} from 'lucide-react';
import { Medicine } from '../../types';
import { CATEGORIES } from '../../data/constants';
import { translations } from '../../data/translations';
import StockIntakeModal from './StockIntakeModal';
import MedicineRow from '../MedicineRow';
import MedicineDetailsDrawer from '../MedicineDetailsDrawer';

interface InventoryTabProps {
  medicines: Medicine[];
  onUpdateStock: (id: string, delta: number, note?: string) => boolean | Promise<boolean> | void;
  onQuickAdjust?: (id: string, delta: number, note?: string) => void;
  /** Off-app order (WhatsApp/phone): dispatch stock through the real sale engine. */
  onExternalSale?: (med: Medicine, qty: number, payment: 'Cash' | 'Credit') => Promise<{ success: boolean; error?: string }>;
  onUpdateMedicine?: (m: Medicine) => Promise<void> | void;
  onSelectMedicine: (id: string) => void;
  onAddMedicine?: (m: Medicine) => Promise<void>;
 /** True until the first Firestore snapshot for this tenant arrives. */
 isLoadingInventory?: boolean;
  /** Catalog item requesting intake (catalog → warehouse inventory entry). */
  intakeRequest?: any | null;
  onIntakeConsumed?: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  categoryFilter: string;
  setCategoryFilter: (val: string) => void;
  sortBy: 'name' | 'stock' | 'expiryDate' | 'lastUpdated';
  setSortBy: (val: 'name' | 'stock' | 'expiryDate' | 'lastUpdated') => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (val: 'asc' | 'desc') => void;
  triggerToast: (message: string, type: 'success' | 'info' | 'error') => void;
  lang?: 'en' | 'ar';
}

export default function InventoryTab({
  medicines,
  onUpdateStock,
  onQuickAdjust,
  onExternalSale,
  onUpdateMedicine,
  onSelectMedicine,
  onAddMedicine,
  isLoadingInventory = false,
  intakeRequest,
  onIntakeConsumed,
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
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [isStockIntakeOpen, setIsStockIntakeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
 // Phase 2: row details drawer (read-only). id -> medicine resolved at render.
 const [detailsMedId, setDetailsMedId] = useState<string | null>(null);
  const clickGuardRef = useRef<Set<string>>(new Set());
  // Two-tap arming for high-impact bulk buttons (mistake prevention).
  const [armedQuick, setArmedQuick] = useState<string | null>(null);

  // ---- Off-app external sale (WhatsApp/phone order) ----
  const [extSaleMed, setExtSaleMed] = useState<Medicine | null>(null);
  const [extQty, setExtQty] = useState<string>('1');
  const [extPayment, setExtPayment] = useState<'Cash' | 'Credit'>('Cash');
  const [extSubmitting, setExtSubmitting] = useState(false);

  // ---- Ledger medicine editing ----
  const [editingMed, setEditingMed] = useState<Medicine | null>(null);
  const [editForm, setEditForm] = useState<Partial<Medicine>>({});
  const [editQtyMode, setEditQtyMode] = useState<'set' | 'adjust'>('set');
  const [editQtyValue, setEditQtyValue] = useState<string>('0');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const openEditModal = (med: Medicine) => {
    setEditingMed(med);
    setEditForm({
      name: med.name,
      category: med.category || 'General',
      price: med.price,
      minThreshold: med.minThreshold,
      shelfLocation: med.shelfLocation || '',
      supplier: med.supplier || '',
      batchNumber: med.batchNumber || '',
      expiryDate: med.expiryDate ? String(med.expiryDate).slice(0, 10) : ''
    });
    setEditQtyMode('set');
    setEditQtyValue(String(med.stock || 0));
    setSaveState('idle');
  };

  const handleSaveEdits = async () => {
    if (!editingMed || saveState === 'saving') return;

    const newName = String(editForm.name || '').trim();
    const newPrice = Number(editForm.price);
    if (!newName) {
      triggerToast(lang === 'ar' ? 'اسم الدواء مطلوب' : 'Medicine name is required', 'error');
      return;
    }
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      triggerToast(lang === 'ar' ? 'السعر غير صالح' : 'Invalid price', 'error');
      return;
    }

    setSaveState('saving');
    try {
      // 1. Persist descriptive fields first. NEVER include stock/history in
      //    this write: they come from the modal-open snapshot, and writing
      //    them back would overwrite concurrent dispatch/sale deductions
      //    BEFORE step 2 applies the physical-count delta on top.
      const { stock: _omitStock, history: _omitHistory, ...descriptiveFields } = { ...editingMed, ...editForm } as Record<string, unknown> & { stock?: number; history?: unknown };
      await Promise.resolve(onUpdateMedicine?.({
        ...(descriptiveFields as unknown as typeof editingMed),
        name: newName,
        price: newPrice,
        minThreshold: Number(editForm.minThreshold) || editingMed.minThreshold || 5,
        lastUpdated: new Date().toISOString()
      }));

      // 2. Apply the physical stock correction through the authoritative
      //    adjustment engine (corrective batch for additions, FEFO deduction
      //    for reductions — never bypasses batch accounting).
      const targetStock = Number(editQtyValue);
      if (Number.isFinite(targetStock)) {
        const delta = editQtyMode === 'set'
          ? Math.round(targetStock) - (editingMed.stock || 0)
          : Math.round(targetStock);
        if (delta !== 0) {
          const ok = Boolean(await Promise.resolve(onUpdateStock(
            editingMed.id,
            delta,
            lang === 'ar' ? 'تسوية جرد من سجل المستودع' : 'Ledger physical stock correction'
          )));
          if (!ok) {
            setSaveState('idle');
            return;
          }
        }
      }

      setSaveState('saved');
      triggerToast(
        lang === 'ar' ? `تم حفظ تعديلات ${newName}` : `Saved changes to ${newName}`,
        'success'
      );
      setTimeout(() => {
        setEditingMed(null);
        setSaveState('idle');
      }, 1100);
    } catch (err) {
      console.warn('Ledger edit save failed:', err);
      setSaveState('idle');
      triggerToast(lang === 'ar' ? 'فشل حفظ التعديلات' : 'Failed to save changes', 'error');
    }
  };

  // Catalog → intake entry point
  useEffect(() => {
    if (intakeRequest) {
      setIsStockIntakeOpen(true);
    }
  }, [intakeRequest]);

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

 // Filter & Sort medicines (memoized — identical semantics, computed only
 // when inputs change; date epochs are precomputed once per item instead of
 // inside the comparator; invalid/missing dates keep the exact NaN behavior
 // of the previous new Date(...).getTime() subtraction).
 const filteredMedicines = useMemo(() => medicines.filter(med => {
  const query = searchQuery.toLowerCase().trim();
  const matchesSearch = 
  med.name.toLowerCase().includes(query) ||
  med.genericName.toLowerCase().includes(query) ||
  med.batchNumber.toLowerCase().includes(query) ||
  (med.shelfLocation && med.shelfLocation.toLowerCase().includes(query)) ||
  (med.category && med.category.toLowerCase().includes(query)) ||
  (med.dosageForm && med.dosageForm.toLowerCase().includes(query)) ||
  (med.supplier && med.supplier.toLowerCase().includes(query));
  
  const matchesCategory = categoryFilter === 'All' || med.category === categoryFilter;
  
  const matchesLowStock = !showLowStockOnly || med.stock < med.minThreshold;
  
  return matchesSearch && matchesCategory && matchesLowStock;
 }), [medicines, searchQuery, categoryFilter, showLowStockOnly]);

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
  const ordered = sortOrder === 'asc' ? comparison : -comparison;
  return ordered;
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
 <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
 <Activity className="text-brand-600 w-6 h-6 stroke-[2.5]" />
 {t.medicineInventoryLedger}
 </h1>
 <p className="text-slate-500 text-xs mt-0.5">
 {t.secureLedgerDescription}
 </p>
 </div>
 <div className="flex items-center gap-2.5 flex-wrap">
  <button
   id="btn-warehouse-add-medicine"
   onClick={() => setIsStockIntakeOpen(true)}
   className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl font-bold text-xs transition-all duration-200 shadow-sm active:scale-95 cursor-pointer"
  >
   <PackagePlus className="w-4 h-4" />
   {lang === 'ar' ? 'إضافة دواء / إدخال مخزون' : 'Add Medicine'}
  </button>

  <button
   id="btn-gen-order-sheet"
   onClick={() => setIsOrderModalOpen(true)}
   className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-4 py-2 rounded-xl font-semibold text-xs transition-all duration-200 active:scale-95 cursor-pointer"
  >
   <FileText className="w-3.5 h-3.5" />
   {t.generateRestockOrder}
   {lowStockItems.length > 0 && (
    <span className="bg-brand-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
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
 className="bg-amber-100/60 hover:bg-amber-200/80 border border-amber-200 rounded-lg px-2 py-0.5 text-[10px] font-mono font-bold text-amber-800 flex items-center gap-1.5 transition-colors cursor-pointer"
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
 <div className="p-4 rounded-xl bg-white border border-slate-200/80 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center shadow-sm">
 {/* Search Bar */}
 <div className="relative lg:col-span-4">
 <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
 <input
 id="search-input"
 type="text"
 placeholder={t.searchPlaceholder}
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full bg-slate-50 border border-slate-200/80 focus:border-brand-500/50 rounded-xl py-2 pl-9 pr-4 text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition-all font-semibold"
 />
 </div>

 {/* Low Stock Quick-Filter Button */}
 <div className="lg:col-span-2">
 <button
 id="btn-filter-low-stock"
 type="button"
 onClick={() => setShowLowStockOnly(!showLowStockOnly)}
 className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
 showLowStockOnly
 ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-sm'
 : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:bg-slate-100 '
 }`}
 >
 <AlertTriangle className={`w-3.5 h-3.5 ${showLowStockOnly ? 'text-amber-600 ' : 'text-slate-400'}`} />
 <span>{lang === 'ar' ? 'المنخفض فقط' : 'Low Stock'}</span>
  {showLowStockOnly && (
  <span className="bg-amber-200 text-amber-950 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
  {lowStockItems.length}
  </span>
  )}
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
 className="w-full bg-slate-50 border border-slate-200/80 focus:border-brand-500/50 rounded-xl py-2 pl-12 pr-4 text-xs text-slate-700 font-semibold focus:outline-none transition-all appearance-none cursor-pointer"
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
 className="w-full bg-slate-50 border border-slate-200/80 focus:border-brand-500/50 rounded-xl py-2 pl-12 pr-4 text-xs text-slate-700 font-semibold focus:outline-none transition-all appearance-none cursor-pointer"
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
 className="p-2 rounded-xl border border-slate-200/80 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer w-full flex items-center justify-center gap-2 lg:gap-0"
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
 <span className="text-[10px] font-mono text-slate-500 bg-slate-100 border border-slate-200/60 px-2.5 py-0.5 rounded-full">
 {sortedMedicines.length} {lang === 'ar' ? 'مادة مدرجة' : 'component(s) listed'}
 </span>
 </h2>
 <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest font-bold">{lang === 'ar' ? 'السعر بالليرة السورية' : 'SYRIAN POUNDS (ل.س)'}</span>
 </div>

  {isLoadingInventory && medicines.length === 0 ? (
 /* First snapshot hasn't arrived — skeleton rows, never a fake "empty". */
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
   medicines.length === 0 ? (
    <div className="p-12 rounded-lg bg-white border border-brand-100 text-center shadow-xs">
     <div className="w-14 h-14 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 mx-auto mb-4">
      <PackagePlus className="w-7 h-7 stroke-[2]" />
     </div>
     <h3 className="text-base font-bold text-slate-800 mb-1">
      {lang === 'ar' ? 'مخزون المستودع فارغ حالياً' : 'Warehouse Inventory is Empty'}
     </h3>
     <p className="text-xs text-slate-500 max-w-md mx-auto mb-5 leading-relaxed">
      {lang === 'ar' 
       ? 'ابدأ بإدخال الأدوية إلى مخزونك الخاص عبر مسح الباركود بالكاميرا أو البحث في الكتالوج الدوائي المركزي.' 
       : 'Start populating your private warehouse stock by scanning medicine barcodes with the camera scanner or searching the master catalog.'}
     </p>
     <button
      id="btn-empty-add-medicine"
      onClick={() => setIsStockIntakeOpen(true)}
      className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer"
     >
      <PackagePlus className="w-4 h-4" />
      {lang === 'ar' ? 'مسح باركود / إدخال دواء جديد' : 'Scan Barcode / Add Medicine'}
     </button>
    </div>
   ) : (
    <div className="p-12 rounded-xl bg-white border border-slate-200/80 text-center shadow-sm">
     <TrendingDown className="w-10 h-10 text-slate-300 mx-auto mb-2" />
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
      className="mt-4 px-4 py-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
     >
      {lang === 'ar' ? 'إعادة ضبط البحث' : 'Reset Search Parameters'}
     </button>
    </div>
   )
  ) : (
 /* Dense Data-Driven List View */
 <div className="space-y-2.5">
 {sortedMedicines.map((item) => (
 <MedicineRow
 key={item.id}
 medicine={item}
 role="warehouse"
 lang={lang}
 onSelect={(id) => setDetailsMedId(id)}
 onQuickAdjust={(id, delta, note) => (onQuickAdjust || onUpdateStock)(id, delta, note)}
 roleActions={
 <>
 <button
 type="button"
 onClick={() => {
 if (item && (item as Medicine).id) openEditModal(item as Medicine);
 }}
 title={lang === 'ar' ? 'تعديل بيانات الدواء والمخزون' : 'Edit medicine details & stock'}
 aria-label={lang === 'ar' ? 'تعديل بيانات الدواء والمخزون' : 'Edit medicine details & stock'}
 className="w-11 h-11 flex items-center justify-center bg-brand-50 hover:bg-brand-100 text-brand-600 hover:text-brand-700 border border-brand-200/70 rounded-xl transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
 >
 <Pencil className="w-4 h-4" aria-hidden="true" />
 </button>

 {/* Off-app order (WhatsApp/phone) dispatch */}
 <button
 type="button"
 onClick={() => {
 setExtSaleMed(item);
 setExtQty('1');
 setExtPayment('Cash');
 }}
 title={lang === 'ar' ? 'بيع خارجي — طلب واتساب/خارج التطبيق' : 'External sale — off-app order'}
 aria-label={lang === 'ar' ? 'بيع خارجي — طلب واتساب/خارج التطبيق' : 'External sale — off-app order'}
 className="w-11 h-11 flex items-center justify-center bg-slate-50 hover:bg-brand-50 text-slate-500 hover:text-brand-700 border border-slate-200 rounded-xl transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
 >
 <Truck className="w-4 h-4" aria-hidden="true" />
 </button>
 </>
 }
 />
 ))}
 </div>
 )}
</div>

  {/* External sale modal — off-app order (WhatsApp/phone) */}
  <AnimatePresence>
    {extSaleMed && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          id="external-sale-modal"
          className="w-full max-w-md bg-white border border-slate-200 p-6 rounded-xl shadow-md relative"
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Truck className="w-4.5 h-4.5 text-brand-600" />
                {lang === 'ar' ? 'بيع خارجي' : 'External Sale'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {lang === 'ar' ? 'طلب وصل خارج التطبيق (واتساب/تلفون) — يُخصم من المخزون ويُسجل بالسجل المالي' : 'Order received off-app — deducts stock and records a real ledger sale'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExtSaleMed(null)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
            <div className="text-sm font-bold text-slate-800 truncate">{extSaleMed.name}</div>
            <div className="text-xs text-slate-500 font-mono">
              {lang === 'ar' ? 'المتوفر' : 'Available'}: {extSaleMed.stock} | {lang === 'ar' ? 'سعر البيع' : 'Sell price'}: {(extSaleMed.price || 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
            </div>
          </div>

          <label className="block mb-3">
            <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'الكمية (كرتونة)' : 'Quantity (cartons)'}</span>
            <input
              type="number"
              id="input-external-sale-qty"
              min="1"
              max={extSaleMed.stock || 1}
              value={extQty}
              onChange={(e) => setExtQty(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm font-mono font-bold border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setExtPayment('Cash')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                extPayment === 'Cash' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
              }`}
            >
              {lang === 'ar' ? 'نقداً 💵' : 'Cash 💵'}
            </button>
            <button
              type="button"
              onClick={() => setExtPayment('Credit')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                extPayment === 'Credit' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
              }`}
            >
              {lang === 'ar' ? 'دين (ذممة)' : 'Credit (debt)'}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExtSaleMed(null)}
              className="flex-1 py-2.5 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={extSubmitting || !(Number(extQty) > 0) || Number(extQty) > (extSaleMed.stock || 0)}
              onClick={async () => {
                if (!onExternalSale || !extSaleMed) return;
                setExtSubmitting(true);
                try {
                  const res = await onExternalSale(extSaleMed, Number(extQty), extPayment);
                  if (res?.success) {
                    triggerToast(
                      lang === 'ar'
                        ? `تم تسجيل بيع خارجي: ${extQty} × ${extSaleMed.name}`
                        : `External sale recorded: ${extQty} × ${extSaleMed.name}`,
                      'success'
                    );
                    setExtSaleMed(null);
                  } else {
                    triggerToast(res?.error || (lang === 'ar' ? 'فشل تسجيل البيع' : 'Sale failed'), 'error');
                  }
                } finally {
                  setExtSubmitting(false);
                }
              }}
              className="flex-1 py-2.5 text-xs font-black rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {extSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                lang === 'ar' ? 'تأكيد التسليم' : 'Confirm dispatch'
              )}
            </button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>

  {/* Generation of Compact Plain Text Order Sheet Modal */}
 <AnimatePresence>
 {isOrderModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
 <motion.div
 initial={{ scale: 0.95, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 exit={{ scale: 0.95, opacity: 0 }}
 id="order-sheet-modal"
 className="w-full max-w-lg bg-white border border-slate-200 p-6 rounded-xl shadow-md relative"
 >
 <div className="flex justify-between items-start mb-4">
 <div>
 <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
 <ShoppingBag className="text-brand-600" />
 {lang === 'ar' ? 'مولد طلبات التوريد الموحد' : 'Wholesale Order Dispatcher'}
 </h3>
 <p className="text-xs text-slate-400 mt-0.5">
 {lang === 'ar' ? 'توليد حزم بروتوكول الطلب التلقائي للمستودع الموزع.' : 'Generates automated B2B telemetry reorder payloads for supply sync.'}
 </p>
 </div>
 <button
 onClick={() => setIsOrderModalOpen(false)}
 className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
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
 <div className="max-h-40 overflow-y-auto space-y-2 border border-slate-200 bg-slate-50 p-3 rounded-xl scrollbar">
 {lowStockItems.map(item => {
 const targetQty = item.minThreshold * 2;
 const suggestedOrder = targetQty - item.stock;
 return (
 <div key={item.id} className="flex justify-between text-xs font-mono text-slate-600 border-b border-slate-200/50 pb-1.5 last:border-0 last:pb-0">
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
 <span className="text-[10px] text-brand-600 lowercase italic">{lang === 'ar' ? 'جاهز للنسخ والمشاركة' : 'Ready to share'}</span>
 </div>
 <div className="relative">
 <textarea
 readOnly
 value={generateOrderString()}
 className="w-full bg-slate-900 border border-slate-950 text-brand-400 font-mono text-xs p-3 rounded-xl h-24 focus:outline-none resize-none select-all shadow-inner"
 />
 <button
 id="btn-copy-payload"
 onClick={copyOrderToClipboard}
 className="absolute right-2 bottom-2 px-3 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-mono font-bold shadow-sm cursor-pointer"
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
 className="px-4 py-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
 >
 {t.closeView}
 </button>
 <button
 onClick={copyOrderToClipboard}
 className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
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

 {/* Ledger Medicine Editor — compact centered modal */}
 <Modal
 isOpen={!!editingMed}
 onClose={() => { if (saveState !== 'saving') setEditingMed(null); }}
 title={lang === 'ar' ? `تعديل: ${editingMed?.name || ''}` : `Edit: ${editingMed?.name || ''}`}
 maxWidth="md"
 fullScreenOnMobile
 footer={
 <div className="flex items-center justify-between gap-3 w-full">
 <span className="text-[10px] font-mono text-slate-400 truncate hidden sm:block">
 {lang === 'ar' ? 'المعرف: ' : 'ID: '}{editingMed?.id}
 </span>
 <div className="flex items-center gap-2 ml-auto">
 <Button variant="secondary" size="sm" onClick={() => setEditingMed(null)} disabled={saveState === 'saving'}>
 {lang === 'ar' ? 'إلغاء' : 'Cancel'}
 </Button>
 <Button
 variant="primary"
 size="sm"
 onClick={handleSaveEdits}
 isLoading={saveState === 'saving'}
 leftIcon={saveState === 'saved' ? <Check className="w-4 h-4" /> : undefined}
 >
 {saveState === 'saved'
 ? (lang === 'ar' ? 'تم الحفظ' : 'Saved')
 : (lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes')}
 </Button>
 </div>
 </div>
 }
 >
 {editingMed && (
 <div className="space-y-5">
 {/* Identity */}
 <section className="space-y-3">
 <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
 {lang === 'ar' ? 'بيانات الدواء' : 'Medicine Details'}
 </h4>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'الاسم التجاري' : 'Trade Name'}</span>
 <input
 type="text"
 value={editForm.name || ''}
 onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 <div className="grid grid-cols-2 gap-3">
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'السعر (ل.س)' : 'Price (SYP)'}</span>
 <input
 type="number" min="0"
 value={editForm.price ?? ''}
 onChange={(e) => setEditForm(f => ({ ...f, price: Number(e.target.value) }))}
 className="mt-1 w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'حد التنبيه' : 'Low-stock Threshold'}</span>
 <input
 type="number" min="0"
 value={editForm.minThreshold ?? ''}
 onChange={(e) => setEditForm(f => ({ ...f, minThreshold: Number(e.target.value) }))}
 className="mt-1 w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'التصنيف' : 'Category'}</span>
 <select
 value={editForm.category || 'General'}
 onChange={(e) => setEditForm(f => ({ ...f, category: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 >
 {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
 </select>
 </label>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'تاريخ الانتهاء' : 'Expiry Date'}</span>
 <input
 type="date"
 value={editForm.expiryDate || ''}
 onChange={(e) => setEditForm(f => ({ ...f, expiryDate: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'رقم التشغيلة' : 'Batch No.'}</span>
 <input
 type="text"
 value={editForm.batchNumber || ''}
 onChange={(e) => setEditForm(f => ({ ...f, batchNumber: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'رف التخزين' : 'Shelf Location'}</span>
 <input
 type="text"
 value={editForm.shelfLocation || ''}
 onChange={(e) => setEditForm(f => ({ ...f, shelfLocation: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 </div>
 <label className="block">
 <span className="text-xs font-bold text-slate-600">{lang === 'ar' ? 'المورّد / المعمل' : 'Supplier'}</span>
 <input
 type="text"
 value={editForm.supplier || ''}
 onChange={(e) => setEditForm(f => ({ ...f, supplier: e.target.value }))}
 className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 />
 </label>
 </section>

 {/* Physical stock correction — distinct from sale/dispatch deductions */}
 <section className="space-y-3 p-3.5 bg-brand-50/50 border border-brand-100 rounded-xl">
 <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-700 flex items-center gap-1.5">
 <PackagePlus className="w-3.5 h-3.5" />
 {lang === 'ar' ? 'تسوية المخزون الفعلي (جرد)' : 'Physical Stock Correction'}
 </h4>
 <p className="text-[10px] text-slate-500 leading-relaxed">
 {lang === 'ar'
 ? 'هذا تعديل جرد فعلي وليس عملية بيع أو صرف. الزيادة تُسجل كتشغيلة تصحيحية، والنقصان يُخصم من أقدم تشغيلة انتهاءً وفق نظام FEFO.'
 : 'This is a physical count adjustment, not a sale/dispatch. Increases add a corrective batch; decreases deduct FEFO-first from the nearest-expiry active batches.'}
 </p>
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={() => setEditQtyMode('set')}
 className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${editQtyMode === 'set' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'}`}
 >
 {lang === 'ar' ? 'تعيين الكمية' : 'Set Count'}
 </button>
 <button
 type="button"
 onClick={() => setEditQtyMode('adjust')}
 className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${editQtyMode === 'adjust' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'}`}
 >
 {lang === 'ar' ? 'زيادة/نقصان ±' : 'Adjust ±'}
 </button>
 </div>
 <div className="flex items-center gap-3">
 {editQtyMode === 'set' && (
 <div className="text-center shrink-0">
 <span className="block text-[9px] uppercase font-bold text-slate-400">{lang === 'ar' ? 'الحالي' : 'Current'}</span>
 <span className="font-mono text-sm font-black text-slate-700">{editingMed.stock ?? 0}</span>
 </div>
 )}
 <input
 type="number"
 value={editQtyValue}
 onChange={(e) => setEditQtyValue(e.target.value)}
 className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
 placeholder={editQtyMode === 'set' ? (lang === 'ar' ? 'الكمية الجديدة' : 'New total') : (lang === 'ar' ? 'مثال: -5 أو +20' : 'e.g. -5 or +20')}
 />
 {editQtyMode === 'set' && Number.isFinite(Number(editQtyValue)) && (
 <span className={`font-mono text-xs font-black shrink-0 ${(Number(editQtyValue) - (editingMed.stock || 0)) >= 0 ? 'text-brand-600' : 'text-rose-600'}`}>
 {(Number(editQtyValue) - (editingMed.stock || 0)) >= 0 ? '+' : ''}{Number(editQtyValue) - (editingMed.stock || 0)}
 </span>
 )}
 </div>
 </section>

 {/* Saving overlay feedback */}
 <AnimatePresence>
 {saveState === 'saving' && (
 <motion.div
 initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
 className="flex items-center justify-center gap-2 py-2 text-xs font-bold text-slate-500"
 >
 <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
 {lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving changes...'}
 </motion.div>
 )}
 {saveState === 'saved' && (
 <motion.div
 initial={{ scale: 0.8, opacity: 0 }}
 animate={{ scale: 1, opacity: 1 }}
 transition={{ duration: 0.18 }}
 className="flex items-center justify-center gap-2 py-2 text-sm font-black text-brand-700"
 >
 <span className="w-6 h-6 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center">
 <Check className="w-4 h-4 text-brand-600" />
 </span>
 {lang === 'ar' ? 'تم الحفظ بنجاح' : 'Changes saved'}
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 )}
 </Modal>

 {/* Medicine Intake Modal for Warehouse Onboarding and Barcode Intake */}
 <StockIntakeModal
 isOpen={isStockIntakeOpen}
 onClose={() => {
 setIsStockIntakeOpen(false);
 if (intakeRequest) onIntakeConsumed?.();
 }}
 lang={lang}
 onAddMedicine={onAddMedicine || (async () => {})}
 triggerToast={triggerToast}
 initialItem={intakeRequest}
 />

 {/* Phase 2: read-only medicine details drawer (row tap) — Phase 3 adds controlled edits */}
 <MedicineDetailsDrawer
 medicine={medicines.find(m => m.id === detailsMedId) || null}
 role="warehouse"
 lang={lang}
 onClose={() => setDetailsMedId(null)}
 onUpdateMedicine={onUpdateMedicine}
 />
 </div>
 );
}
