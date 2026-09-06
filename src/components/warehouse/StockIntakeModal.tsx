import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Search, PackagePlus, AlertCircle, Save, CheckCircle2, 
  RotateCcw, Camera, Barcode, ShieldAlert, Sparkles, Building2, 
  Pill, Hash, Calendar, DollarSign, Layers, ArrowRight, Check,
  Edit3, HelpCircle, Tag
} from 'lucide-react';
import { useCatalog } from '../../context/CatalogContext';
import { Medicine } from '../../types';
import { dedupeCatalogSuggestions } from '../../domain/catalog/dedupeSuggestions';
import { useAuth } from '../../application/auth/AuthContext';
import { HardwareIntegrationService } from '../../infrastructure/hardware/HardwareIntegrationService';
import CentralScannerModal, { CatalogItem } from '../scanner/CentralScannerModal';
import { findLocalMedByBarcode, normalizeBarcode } from '../../services/syncEngine';

interface StockIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'en' | 'ar';
  onAddMedicine: (m: Medicine) => Promise<void>;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  /** Optional catalog item to prefill intake (catalog → warehouse inventory entry). */
  initialItem?: any | null;
  /**
   * Current inventory snapshot. When the picked catalog item already exists in
   * the pharmacy's ledger, the medicine-level selling price is KEPT (P1 #6)
   * and the pharmacist focuses on batch-level details only.
   */
  existingMedicines?: Medicine[];
}

const COMMON_DOSAGE_FORMS = [
  { id: 'Tablets', labelAr: 'أقراص', labelEn: 'Tablets' },
  { id: 'Capsules', labelAr: 'كبسولات', labelEn: 'Capsules' },
  { id: 'Syrup', labelAr: 'شراب', labelEn: 'Syrup' },
  { id: 'Ointment', labelAr: 'مرهم / كريم', labelEn: 'Ointment' },
  { id: 'Injection', labelAr: 'حقن', labelEn: 'Injection' },
  { id: 'Drops', labelAr: 'قطرة', labelEn: 'Drops' },
  { id: 'Spray', labelAr: 'بخاخ', labelEn: 'Spray' },
  { id: 'Suppository', labelAr: 'تحاميل', labelEn: 'Suppositories' },
];

export default function StockIntakeModal({ 
  isOpen, 
  onClose, 
  lang = 'ar', 
  onAddMedicine, 
  triggerToast,
  initialItem,
  existingMedicines = []
}: StockIntakeModalProps) {
  const { catalogRaw, findByBarcode, findByBarcodeRemote, searchCatalogRemote } = useCatalog();
  const { currentSession } = useAuth();
  
  // Scanner state - open camera scanner automatically on launch
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [hasScannedOnce, setHasScannedOnce] = useState(false);
  // P1 #6: true when the selected catalog item resolves to medicine already
  // in the ledger — the selling price is then pre-filled from that medicine.
  const [isRestockOfExisting, setIsRestockOfExisting] = useState(false);

  /** Deterministic match of a catalog item against current inventory:
   *  barcode → catalogId → exact normalized name. No fuzzy guessing. */
  const findExistingMedicine = (item: any, barcode: string): Medicine | undefined => {
    if (!existingMedicines?.length) return undefined;
    const catId = String(item?.id || item?.catalogId || item?.code || '').replace(/\//g, '_');
    const norm = (v: any) => String(v || '').trim().toLowerCase();
    return existingMedicines.find(m =>
      (barcode && norm(m.barcode) === norm(barcode)) ||
      (catId && m.catalogId === catId) ||
      (norm(m.name) && norm(m.name) === norm(item?.name || item?.name_en || item?.tradeNameEn))
    );
  };

  // Intake Mode: 'catalog' (resolved from database) or 'manual' (unregistered / custom medicine)
  const [isManualMode, setIsManualMode] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string>('');

  // Catalog Item Selection
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Form Fields - For both Catalog and Manual Entry
  const [medName, setMedName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [dosageForm, setDosageForm] = useState('Tablets');
  const [strength, setStrength] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [category, setCategory] = useState('General');
  const [quantity, setQuantity] = useState<number>(1);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [costPrice, setCostPrice] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState<string>('');
  
  // Submission & Confirmation Feedback State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{ name: string; quantity: number; expiry: string } | null>(null);

  // P1 #5: NO fabricated expiry. Unknown expiry stays Unknown — the
  // pharmacist enters the real date from the box, or leaves it empty.
  const getDefaultExpiryDate = () => '';

  // Auto-generate default batch code
  const generateDefaultBatch = () => {
    const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    return `BATCH-${today}-${rand}`;
  };

  const resetForm = useCallback(() => {
    setIsManualMode(false);
    setScannedBarcode('');
    setSelectedItem(null);
    setSearchQuery('');
    setSuggestions([]);
    setMedName('');
    setGenericName('');
    setDosageForm('Tablets');
    setStrength('');
    setManufacturer('');
    setCategory('General');
    setQuantity(1);
    setExpiryDate(getDefaultExpiryDate());
    setSellingPrice('');
    setBatchNumber(generateDefaultBatch());
    setSuccessData(null);
    setHasScannedOnce(false);
    setIsRestockOfExisting(false);
  }, []);

  // When modal is opened, reset and launch camera scanner immediately —
  // unless an external catalog item was requested (catalog → intake entry),
  // in which case prefill the form and skip the forced camera launch.
  useEffect(() => {
    if (isOpen) {
      resetForm();
      if (initialItem) {
        const preselected: any = {
          id: String(initialItem.id || initialItem.catalogId || initialItem.barcode || '').trim(),
          name: initialItem.name_en || initialItem.name || initialItem.tradeNameEn || '',
          name_en: initialItem.name_en || initialItem.tradeNameEn || '',
          barcode: initialItem.barcode ? String(initialItem.barcode) : '',
          composition: initialItem.composition || '',
          company: initialItem.company || initialItem.company_name || initialItem.manufacturer || '',
          price: Number(initialItem.price) || 0
        };
        setSelectedItem(preselected);
        setMedName(preselected.name);
        setGenericName(preselected.composition);
        setManufacturer(preselected.company);
        if (preselected.barcode) setScannedBarcode(preselected.barcode);
        if (preselected.price > 0) {
          // Catalog value defaults BOTH prices: cost = catalog reference,
          // sell = same (pharmacist adjusts both to their reality).
          setSellingPrice(String(preselected.price));
          setCostPrice(String(preselected.price));
        }
        setIsManualMode(false);
        setIsScannerOpen(false);
      } else {
        // P2 #11: the camera scanner is an EXPLICIT choice. Open the form on
        // the search/manual path; "Scan Barcode Camera" launches the scanner
        // on demand. A missing/failed camera must never block manual entry.
        setIsScannerOpen(false);
      }
    } else {
      setIsScannerOpen(false);
    }
  }, [isOpen, resetForm, initialItem]);

  // Debounce manual search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Remote/Local Catalog Search
  useEffect(() => {
    let isMounted = true;
    const searchMeds = async () => {
      if (!debouncedQuery.trim() || selectedItem) {
        setSuggestions([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await searchCatalogRemote(debouncedQuery.trim(), 12);
        if (isMounted) {
          // P2 #10: collapse exact duplicate catalog entries so the
          // pharmacist never chooses blindly between identical products.
          setSuggestions(dedupeCatalogSuggestions(results || []));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (isMounted) setIsSearching(false);
      }
    };
    searchMeds();
    return () => { isMounted = false; };
  }, [debouncedQuery, searchCatalogRemote, selectedItem]);

  // Populate form with catalog item
  const handlePopulateFromCatalog = useCallback((item: any, barcodeFromScan?: string) => {
    if (!item) return;

    setIsManualMode(false);
    setSelectedItem(item);
    const code = normalizeBarcode(barcodeFromScan || item.barcode || item.code || '');
    setScannedBarcode(code);
    
    const nameStr = String(item.name || item.arabic_name || item.trade_name || item.drug_name || item.name_en || item.nameEn || '').trim();
    setSearchQuery(nameStr);
    setMedName(nameStr);
    setGenericName(String(item.composition_key || item.scientific_name || item.active_ingredient || item.composition || item.genericName || item.name_en || item.nameEn || '').trim());
    setDosageForm(String(item.form || item.dosage_form || item.dosageForm || 'Tablets').trim());
    setStrength(String(item.dosage || item.strength || '').trim());
    setManufacturer(String(item.company_name || item.company || item.manufacturer || item.supplier || item.MANUFACTURER || item.COMPANY || '').trim());
    setCategory(String(item.category || 'General').trim());
    setSuggestions([]);

    // Prefill price from catalog (supports multiple schema variants)
    const rawPrice = item.price !== undefined && item.price !== null
      ? item.price
      : item.public_price !== undefined && item.public_price !== null
        ? item.public_price
        : item.syp_price !== undefined && item.syp_price !== null
          ? item.syp_price
          : 0;
    const priceVal = String(Number(rawPrice) || 0);
    setSellingPrice(priceVal);

    // P1 #6 — receiving/restocking: when this catalog item ALREADY exists in
    // the pharmacy's ledger, keep the medicine's current selling price (the
    // pharmacist only decides batch-level data: quantity, batch no., expiry,
    // purchase cost). The catalog retail price must NOT overwrite it.
    const existing = findExistingMedicine(item, code);
    if (existing && Number(existing.price) > 0) {
      setSellingPrice(String(existing.price));
      setIsRestockOfExisting(true);
    } else {
      setIsRestockOfExisting(false);
    }
    // Purchase cost is intentionally left BLANK: the catalog has no
    // acquisition-cost field, so a retail-price "default" would fabricate
    // cost data (batch-cost-profit fix). The pharmacist enters the real
    // purchase cost; blank flows through as an honest unknown-cost batch.

    // Default expiry & batch — expiry stays empty (Unknown), batch auto-code
    // stays as a convenience that the pharmacist can overwrite.
    setBatchNumber(prev => prev || generateDefaultBatch());
    setQuantity(prev => (prev > 0 ? prev : 1));
  }, []);

  // Set up manual entry when medicine is not in catalog
  const handleSetupManualEntry = useCallback((rawBarcode: string) => {
    const code = normalizeBarcode(rawBarcode);
    setIsManualMode(true);
    setSelectedItem(null);
    setScannedBarcode(code);
    setSearchQuery('');
    setSuggestions([]);
    setMedName('');
    setGenericName('');
    setDosageForm('Tablets');
    setStrength('');
    setManufacturer('');
    setCategory('General');
    setQuantity(1);
    setExpiryDate(getDefaultExpiryDate());
    setSellingPrice('');
    setCostPrice('');
    setBatchNumber(generateDefaultBatch());
  }, []);

  // Complete asynchronous Barcode Resolver with multi-tier lookup (IndexedDB -> RAM -> Supabase -> Manual)
  const resolveScannedBarcode = useCallback(async (rawBarcode: string, preMatchedItem?: CatalogItem | null) => {
    setIsScannerOpen(false);
    setHasScannedOnce(true);

    const normBarcode = normalizeBarcode(rawBarcode);
    if (!normBarcode) return;

    // 1. If scanner already resolved a pre-matched item
    if (preMatchedItem) {
      handlePopulateFromCatalog(preMatchedItem, normBarcode);
      HardwareIntegrationService.getInstance().playScanSuccess();
      triggerToast(
        lang === 'ar' 
          ? `تم التعرف على الدواء: ${preMatchedItem.name || preMatchedItem.nameEn || preMatchedItem.name_en}` 
          : `Resolved: ${preMatchedItem.name || preMatchedItem.nameEn || preMatchedItem.name_en}`,
        'success'
      );
      return;
    }

    // 2. Query Local IndexedDB (PharmacyAppDB -> localMeds)
    try {
      const localMatch = await findLocalMedByBarcode(normBarcode);
      if (localMatch) {
        handlePopulateFromCatalog(localMatch, normBarcode);
        HardwareIntegrationService.getInstance().playScanSuccess();
        triggerToast(
          lang === 'ar' 
            ? `تم التعرف على الدواء: ${localMatch.name || localMatch.nameEn || localMatch.name_en}` 
            : `Resolved: ${localMatch.name || localMatch.nameEn || localMatch.name_en}`,
          'success'
        );
        return;
      }
    } catch (err) {
      console.error('Error querying local IndexedDB by barcode:', err);
    }

    // 3. Fallback: check CatalogContext RAM Map
    const ramFound = findByBarcode(normBarcode);
    if (ramFound) {
      handlePopulateFromCatalog(ramFound, normBarcode);
      HardwareIntegrationService.getInstance().playScanSuccess();
      triggerToast(
        lang === 'ar' 
          ? `تم التعرف على الدواء: ${ramFound.name || (ramFound as any).nameEn || (ramFound as any).name_en}` 
          : `Resolved: ${ramFound.name || (ramFound as any).nameEn || (ramFound as any).name_en}`,
        'success'
      );
      return;
    }

    // 4. Fallback: Query remote Supabase
    try {
      const remoteFound = await findByBarcodeRemote(normBarcode);
      if (remoteFound) {
        handlePopulateFromCatalog(remoteFound, normBarcode);
        HardwareIntegrationService.getInstance().playScanSuccess();
        triggerToast(
          lang === 'ar' 
            ? `تم التعرف على الدواء: ${remoteFound.name || remoteFound.name_en}` 
            : `Resolved: ${remoteFound.name || remoteFound.name_en}`,
          'success'
        );
        return;
      }
    } catch (err) {
      console.error('Error querying remote Supabase by barcode:', err);
    }

    // 5. If STILL not found in any repository -> switch to manual entry with prefilled barcode
    handleSetupManualEntry(normBarcode);
    HardwareIntegrationService.getInstance().playScanError();
    triggerToast(
      lang === 'ar' 
        ? `الرمز (${normBarcode}) غير مدرج في الكتالوج - يرجى إدخال البيانات يدوياً` 
        : `Barcode (${normBarcode}) not in catalog - please fill details manually`,
      'info'
    );
  }, [findByBarcode, findByBarcodeRemote, handlePopulateFromCatalog, handleSetupManualEntry, lang, triggerToast]);

  // Validation
  const quantityValid = quantity > 0 && !isNaN(quantity);
  // P1 #5: empty expiry = honest Unknown; only a malformed non-empty date is
  // invalid. FEFO treats unknown-expiry batches as last-resort stock.
  const expiryUnknown = !expiryDate || expiryDate.trim() === '';
  const expiryValid = expiryUnknown || !isNaN(new Date(expiryDate).getTime());
  const priceNum = parseFloat(sellingPrice);
  const priceValid = !isNaN(priceNum) && priceNum >= 0;
  
  const hasName = isManualMode ? medName.trim().length > 0 : Boolean(selectedItem);
  const isFormValid = hasName && quantityValid && expiryValid && priceValid;

  // Save to Pharmacy Ledger & Persistence Architecture
  const handleSaveToLedger = async () => {
    if (!isFormValid) {
      if (!hasName) {
        triggerToast(lang === 'ar' ? 'يرجى إدخال اسم الدواء أو مسح دواء من الكتالوج' : 'Please enter medicine name or scan from catalog', 'warning');
      } else if (!quantityValid) {
        triggerToast(lang === 'ar' ? 'الكمية يجب أن تكون أكبر من 0' : 'Quantity must be greater than 0', 'warning');
      } else if (!expiryValid) {
        triggerToast(lang === 'ar' ? 'تاريخ الصلاحية غير صالح' : 'Expiration date is invalid', 'warning');
      } else if (!priceValid) {
        triggerToast(lang === 'ar' ? 'سعر البيع غير صالح' : 'Selling price is invalid', 'warning');
      }
      return;
    }

    setIsSubmitting(true);

    try {
      let canonicalCatalogId: string | undefined = undefined;
      let finalId = '';
      const finalName = isManualMode ? medName.trim() : (selectedItem?.name || selectedItem?.name_en || selectedItem?.nameEn || medName.trim());
      // No invented placeholder barcodes: a BAR-<timestamp> value is not a
      // physical identity — the intake resolver treats empty barcode via the
      // deterministic custom_nm_<name> path instead.
      const finalBarcode = scannedBarcode.trim() || (selectedItem?.barcode ? String(selectedItem.barcode) : '');
      const batchCode = batchNumber.trim() || `BATCH-${Date.now()}`;

      if (!isManualMode && selectedItem) {
        canonicalCatalogId = String(selectedItem.id || selectedItem.catalogId || selectedItem.code || '').trim();
        finalId = canonicalCatalogId.replace(/\//g, '_') || `med_${Date.now()}`;
      } else {
        // Stable identity for manually-entered drugs: the same barcode (or,
        // failing that, the same name) reuses ONE ledger card instead of
        // minting a fresh Date.now()-suffixed document per intake.
        // Sanitize: Firestore doc ids forbid '/' and '__' prefixes.
        const rawKey = scannedBarcode.trim()
          ? `bc_${scannedBarcode.trim()}`
          : `nm_${finalName.trim().toLowerCase()}`;
        const manualKey = ('custom_' + rawKey)
          .replace(/[/\\]/g, '_')
          .replace(/^_+/, '')
          .slice(0, 120);
        finalId = manualKey.includes('..') ? `${manualKey.replace(/\.\./g, '_')}` : manualKey;
      }

      const newMedicine: Medicine = {
        id: finalId,
        catalogId: canonicalCatalogId,
        name: finalName,
        barcode: finalBarcode,
        genericName: genericName.trim() || (selectedItem?.composition || selectedItem?.genericName || ''),
        category: category.trim() || 'General',
        stock: Number(quantity),
        minThreshold: 5,
        expiryDate: expiryUnknown ? '' : new Date(expiryDate).toISOString(),
        price: priceNum,
        costPrice: Number(costPrice) || undefined,
        dosageForm: dosageForm.trim() || 'Tablets',
        strength: strength.trim() || '',
        shelfLocation: 'A-1',
        batchNumber: batchCode,
        supplier: manufacturer.trim() || (selectedItem?.company || selectedItem?.company_name || selectedItem?.supplier || 'Custom / Local'),
        ownerId: currentSession?.pharmacyId || 'unknown',
        lastUpdated: new Date().toISOString(),
        history: [{
          id: `hist-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: "stock_in",
          note: `Ledger intake: ${quantity} units (Batch: ${batchCode}, Expiry: ${expiryUnknown ? 'Unknown' : expiryDate}, Mode: ${isManualMode ? 'Manual' : 'Catalog'})`,
          delta: Number(quantity),
          stockAfter: Number(quantity)
        }]
      };

      await onAddMedicine(newMedicine);
      HardwareIntegrationService.getInstance().playScanSuccess();

      // Set concise success state
      setSuccessData({
        name: finalName,
        quantity: Number(quantity),
        expiry: expiryUnknown ? (lang === 'ar' ? 'غير معروف' : 'Unknown') : expiryDate
      });

      triggerToast(
        lang === 'ar' ? `تمت إضافة ${quantity} علبة من ${finalName} إلى السجل` : `Added ${quantity} units of ${finalName} to Ledger`,
        'success'
      );

      // Auto close after confirmation
      setTimeout(() => {
        onClose();
        resetForm();
      }, 1400);

    } catch (e: any) {
      console.error('Save to ledger failed:', e);
      HardwareIntegrationService.getInstance().playScanError();
      triggerToast(lang === 'ar' ? 'فشل حفظ الدواء في السجل' : 'Failed to save medicine to Ledger', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Centered Modal Overlay - Strictly Centered & Reachable */}
      <div 
        className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-sm select-none"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        id="stock-intake-modal-root"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="relative w-full max-w-xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[88vh] my-auto border border-brand-100 animate-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-600/20 shrink-0">
                <PackagePlus className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                  {lang === 'ar' ? 'إدخال دواء إلى السجل' : 'Add Medicine to Ledger'}
                  {isManualMode && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                      {lang === 'ar' ? 'إدخال يدوي' : 'Manual Entry'}
                    </span>
                  )}
                  {selectedItem && (
                    <span className="text-[10px] bg-brand-100 text-brand-800 font-bold px-2 py-0.5 rounded-full border border-brand-200">
                      {lang === 'ar' ? 'معتمد من الكتالوج' : 'Verified Catalog'}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {lang === 'ar' ? 'مسح الباركود للتعرف التلقائي أو إدخال بيانات الدواء يدوياً' : 'Scan barcode for auto-fill or enter medicine details manually'}
                </p>
              </div>
            </div>
            <button 
              type="button"
              onClick={onClose} 
              id="btn-close-stock-intake"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Success State Overlay */}
          {successData ? (
            <div className="p-8 flex flex-col items-center justify-center text-center space-y-4 my-auto">
              <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center shadow-inner animate-bounce">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {lang === 'ar' ? 'تمت إضافة الدواء إلى السجل بنجاح' : 'Medicine Added to Ledger'}
                </h3>
                <p className="text-sm font-semibold text-brand-700 mt-1">
                  {successData.name}
                </p>
                <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 py-2 px-4 rounded-xl">
                  <span>{lang === 'ar' ? `الكمية: ${successData.quantity}` : `Qty: ${successData.quantity}`}</span>
                  <span>•</span>
                  <span>{lang === 'ar' ? `الصلاحية: ${successData.expiry}` : `Expiry: ${successData.expiry}`}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
              {/* PRIMARY SCANNER / MODE BAR */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    id="btn-trigger-intake-scanner"
                    onClick={async () => {
                      // Graceful no-camera path: probe before opening the scanner.
                      try {
                        const devs = (await navigator.mediaDevices?.enumerateDevices?.()) || [];
                        if (!devs.some(d => d.kind === 'videoinput')) {
                          triggerToast(
                            lang === 'ar'
                              ? 'لا توجد كاميرا على هذا الجهاز — تم التحويل للإدخال اليدوي'
                              : 'No camera found on this device — switched to Manual Entry',
                            'info'
                          );
                          handleSetupManualEntry(scannedBarcode || '');
                          return;
                        }
                      } catch { /* probe failed — let the scanner surface its own error */ }
                      setIsScannerOpen(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 transition-all cursor-pointer"
                  >
                    <Camera className="w-4 h-4 stroke-[2.5]" />
                    <span>{lang === 'ar' ? 'مسح باركود بالكاميرا' : 'Scan Barcode Camera'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isManualMode) {
                        setIsManualMode(false);
                      } else {
                        handleSetupManualEntry(scannedBarcode || '');
                      }
                    }}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                      isManualMode 
                        ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' 
                        : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{isManualMode ? (lang === 'ar' ? 'بحث بالكتالوج' : 'Catalog Search') : (lang === 'ar' ? 'إدخال يدوي' : 'Manual Entry')}</span>
                  </button>

                  {(selectedItem || isManualMode) && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors cursor-pointer"
                      title={lang === 'ar' ? 'إعادة ضبط' : 'Reset'}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Catalog Search Input (Shown in Catalog Mode) */}
                {!isManualMode && (
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        id="input-intake-catalog-search"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          if (selectedItem) setSelectedItem(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const q = searchQuery.trim();
                          if (!q) return;
                          if (suggestions.length === 1) {
                            handlePopulateFromCatalog(suggestions[0]);
                          } else if (suggestions.length === 0) {
                            // Unknown code/name — drop into manual entry with it prefilled.
                            handleSetupManualEntry(q);
                          } else if (suggestions.length > 1) {
                            handlePopulateFromCatalog(suggestions[0]);
                          }
                        }}
                        className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all placeholder:text-slate-400"
                        placeholder={lang === 'ar' ? 'ابحث بالاسم التجاري، العلمي، أو الباركود...' : 'Search catalog by trade name, generic, or barcode...'}
                      />
                      {isSearching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-brand-500/30 border-t-brand-600 rounded-full animate-spin" />
                      )}
                    </div>

                    {/* Suggestions Dropdown */}
                    {suggestions.length > 0 && !selectedItem && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-slate-200 shadow-xl rounded-xl divide-y divide-slate-100">
                        {suggestions.map((item, idx) => (
                          <div
                            key={idx}
                            onClick={() => handlePopulateFromCatalog(item)}
                            className="p-3 hover:bg-brand-50 cursor-pointer transition-colors flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                                {item.name || item.name_en}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                {item.composition || item.company}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-bold text-brand-700">
                                {Number(item.price || 0).toLocaleString()} SYP
                              </div>
                              {item.barcode && (
                                <div className="text-[10px] text-slate-400 font-mono">{item.barcode}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Informative Banner when Unregistered Barcode Scanned */}
              {isManualMode && scannedBarcode && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2.5 text-xs animate-in fade-in">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">
                      {lang === 'ar' ? `الرمز (${scannedBarcode}) غير مسجل في الكتالوج` : `Barcode (${scannedBarcode}) not in catalog`}
                    </p>
                    <p className="text-[11px] text-amber-800">
                      {lang === 'ar' 
                        ? 'يمكنك إكمال بيانات الدواء يدوياً بالأسفل لحفظه وإضافته مباشرة إلى مخزون الصيدلية.' 
                        : 'You can fill the medicine details manually below to save and add it directly to inventory.'}
                    </p>
                  </div>
                </div>
              )}

              {/* AUTO-FILLED CATALOG PREVIEW (If Catalog Item Selected) */}
              {!isManualMode && selectedItem && (
                <div className="p-4 rounded-xl bg-brand-50/70 border border-brand-200 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-800 uppercase tracking-wider bg-brand-100 px-2 py-0.5 rounded-md mb-1">
                        <Sparkles className="w-3 h-3 text-brand-600" />
                        {lang === 'ar' ? 'صنف معتمد' : 'Verified Catalog Item'}
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                        {selectedItem.name || selectedItem.name_en}
                      </h3>
                      {genericName && (
                        <p className="text-xs text-slate-600 font-medium mt-0.5">
                          {genericName}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-slate-500 block font-medium">
                        {lang === 'ar' ? 'السعر القياسي' : 'Catalog Price'}
                      </span>
                      <span className="text-sm font-bold text-brand-800 font-mono">
                        {Number(selectedItem.price || 0).toLocaleString()} SYP
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-brand-200/60 text-xs">
                    {dosageForm && (
                      <div className="bg-white/80 p-2 rounded-lg border border-brand-100">
                        <span className="text-[10px] text-slate-400 block font-medium">
                          {lang === 'ar' ? 'الشكل' : 'Form'}
                        </span>
                        <span className="font-semibold text-slate-800 truncate block text-[11px]">{dosageForm}</span>
                      </div>
                    )}
                    {strength && (
                      <div className="bg-white/80 p-2 rounded-lg border border-brand-100">
                        <span className="text-[10px] text-slate-400 block font-medium">
                          {lang === 'ar' ? 'العيار' : 'Strength'}
                        </span>
                        <span className="font-semibold text-slate-800 truncate block text-[11px]">{strength}</span>
                      </div>
                    )}
                    {manufacturer && (
                      <div className="bg-white/80 p-2 rounded-lg border border-brand-100">
                        <span className="text-[10px] text-slate-400 block font-medium">
                          {lang === 'ar' ? 'الشركة' : 'Company'}
                        </span>
                        <span className="font-semibold text-slate-800 truncate block text-[11px]">{manufacturer}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* MANUAL ENTRY FIELDS (When in Manual Mode) */}
              {isManualMode && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5 text-amber-600" />
                      {lang === 'ar' ? 'بيانات الدواء (إدخال يدوي)' : 'Medicine Details (Manual Entry)'}
                    </span>
                    {scannedBarcode !== '' && (
                      <input
                        type="text"
                        value={scannedBarcode}
                        onChange={(e) => setScannedBarcode(e.target.value)}
                        placeholder={lang === 'ar' ? 'اكتب الباركود يدوياً' : 'Type barcode manually'}
                        className="w-40 px-2 py-1 text-[11px] font-mono bg-white border border-slate-300 rounded-md text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    )}
                  </div>

                  {/* Medicine Trade Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'اسم الدواء التجاري *' : 'Trade Name *'}</span>
                      {!medName.trim() && (
                        <span className="text-rose-500 text-[10px] font-semibold">{lang === 'ar' ? 'مطلوب' : 'Required'}</span>
                      )}
                    </label>
                    <input
                      type="text"
                      id="input-manual-med-name"
                      value={medName}
                      onChange={(e) => setMedName(e.target.value)}
                      placeholder={lang === 'ar' ? 'مثال: سيتامول 500 ملغ' : 'e.g., Panadol Extra 500mg'}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Generic Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === 'ar' ? 'الاسم العلمي / المادة الفعالة' : 'Generic / Active Ingredient'}
                    </label>
                    <input
                      type="text"
                      id="input-manual-generic-name"
                      value={genericName}
                      onChange={(e) => setGenericName(e.target.value)}
                      placeholder={lang === 'ar' ? 'مثال: Paracetamol' : 'e.g., Paracetamol'}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>

                  {/* Form & Strength */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {lang === 'ar' ? 'الشكل الصيدلاني' : 'Dosage Form'}
                      </label>
                      <select
                        value={dosageForm}
                        onChange={(e) => setDosageForm(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        {COMMON_DOSAGE_FORMS.map(f => (
                          <option key={f.id} value={f.id}>
                            {lang === 'ar' ? f.labelAr : f.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {lang === 'ar' ? 'العيار / التركيز' : 'Strength'}
                      </label>
                      <input
                        type="text"
                        value={strength}
                        onChange={(e) => setStrength(e.target.value)}
                        placeholder="500mg, 10ml, 1g..."
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  {/* Manufacturer & Barcode Override */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {lang === 'ar' ? 'الشركة المصنعة / المورد' : 'Manufacturer / Supplier'}
                      </label>
                      <input
                        type="text"
                        value={manufacturer}
                        onChange={(e) => setManufacturer(e.target.value)}
                        placeholder={lang === 'ar' ? 'اسم المعمل أو المستودع' : 'Manufacturer or supplier'}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {lang === 'ar' ? 'الباركود' : 'Barcode'}
                      </label>
                      <div className="relative">
                        <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={scannedBarcode}
                          onChange={(e) => setScannedBarcode(e.target.value)}
                          placeholder="621..."
                          className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl font-mono text-slate-900 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* PHARMACIST INTAKE FIELDS (Quantity, Expiry, Price, Batch) */}
              <div className={`space-y-4 transition-all ${(selectedItem || isManualMode) ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Quantity */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'الكمية المدخلة (علب) *' : 'Quantity (Units) *'}</span>
                      {!quantityValid && (
                        <span className="text-rose-500 text-[10px] font-semibold">{lang === 'ar' ? 'مطلوب > 0' : 'Required > 0'}</span>
                      )}
                    </label>
                    <div className="relative">
                      <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="number"
                        id="input-intake-quantity"
                        min="1"
                        step="1"
                        value={quantity}
                        onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                        className={`w-full pl-9 pr-3 py-2 bg-white border rounded-xl font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 transition-all ${
                          !quantityValid 
                            ? 'border-rose-300 ring-rose-400 focus:ring-rose-400' 
                            : 'border-slate-200 focus:ring-brand-500'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Expiration Date — optional; Unknown stays Unknown (P1 #5) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'تاريخ الصلاحية (اختياري)' : 'Expiration Date'}</span>
                      {!expiryValid ? (
                        <span className="text-rose-500 text-[10px] font-semibold">{lang === 'ar' ? 'تاريخ غير صالح' : 'Invalid date'}</span>
                      ) : expiryUnknown ? (
                        <span className="text-amber-600 text-[10px] font-semibold">{lang === 'ar' ? 'غير معروف' : 'Unknown'}</span>
                      ) : null}
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="date"
                        id="input-intake-expiry"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        className={`w-full pl-9 pr-3 py-2 bg-white border rounded-xl font-semibold text-slate-900 text-sm focus:outline-none focus:ring-2 transition-all ${
                          !expiryValid 
                            ? 'border-rose-300 ring-rose-400 focus:ring-rose-400' 
                            : 'border-slate-200 focus:ring-brand-500'
                        }`}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {lang === 'ar' ? 'اتركه فارغاً إذا كان غير معروف — لا يتم اختراع تاريخ.' : 'Leave empty if unknown — no date will be invented.'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {/* Purchase Cost — defaults from catalog, editable */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'سعر الشراء (ل.س)' : 'Purchase Cost (SYP)'}</span>
                      <span className="text-slate-400 text-[10px]">{lang === 'ar' ? 'من الكتالوج' : 'From catalog'}</span>
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="number"
                        id="input-intake-cost-price"
                        min="0"
                        step="50"
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        placeholder="0"
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
                      />
                    </div>
                  </div>

                  {/* Selling Price */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'سعر البيع (ل.س) *' : 'Selling Price (SYP) *'}</span>
                      <span className="text-slate-400 text-[10px]">{lang === 'ar' ? 'سعر الصيدلية' : 'Unit Price'}</span>
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="number"
                        id="input-intake-selling-price"
                        min="0"
                        step="50"
                        value={sellingPrice}
                        onChange={(e) => setSellingPrice(e.target.value)}
                        placeholder="0"
                        className={`w-full pl-9 pr-3 py-2 bg-white border rounded-xl font-mono font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 transition-all ${
                          !priceValid 
                            ? 'border-rose-300 ring-rose-400 focus:ring-rose-400' 
                            : 'border-slate-200 focus:ring-brand-500'
                        }`}
                      />
                    </div>
                    {isRestockOfExisting && (
                      <p className="text-[10px] text-brand-600 mt-1 font-semibold">
                        {lang === 'ar'
                          ? 'دواء موجود — تم الاحتفاظ بسعره الحالي. عدّله فقط إذا تغيّر.'
                          : 'Existing medicine — current price kept. Change only if it changed.'}
                      </p>
                    )}
                  </div>

                  {/* Batch Number */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center justify-between">
                      <span>{lang === 'ar' ? 'رقم التشغيلة (الطبخة)' : 'Batch / Lot Number'}</span>
                      <span className="text-slate-400 text-[10px]">{lang === 'ar' ? 'توليد تلقائي' : 'Auto Generated'}</span>
                    </label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        id="input-intake-batch"
                        value={batchNumber}
                        onChange={(e) => setBatchNumber(e.target.value)}
                        placeholder="e.g. BATCH-2026-001"
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl font-mono text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Initial placeholder state if neither scanned nor manual mode */}
              {!selectedItem && !isManualMode && (
                <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2">
                  <PackagePlus className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold text-slate-600">
                    {lang === 'ar' ? 'قم بمسح الباركود بالكاميرا أو اختر "إدخال يدوي"' : 'Scan barcode with camera or choose "Manual Entry"'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {lang === 'ar' ? 'الأدوية المسجلة ستجلب بياناتها تلقائياً، والأدوية غير المسجلة يمكن إدخالها وحفظها يدوياً.' : 'Catalog medicines will auto-fill; unregistered medicines can be entered and saved manually.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Modal Footer with Centered Controls */}
          {!successData && (
            <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <button 
                type="button" 
                onClick={resetForm}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold text-xs hover:bg-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'إعادة تعيين' : 'Reset'}</span>
              </button>
              
              <button
                type="button"
                id="btn-save-stock-intake"
                onClick={handleSaveToLedger}
                disabled={!isFormValid || isSubmitting}
                className={`px-5 sm:px-6 py-2.5 rounded-xl text-white font-bold text-xs sm:text-sm transition-all shadow-sm flex items-center gap-2 cursor-pointer ${
                  !isFormValid || isSubmitting 
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none' 
                    : 'bg-brand-600 hover:bg-brand-700 active:scale-98 shadow-md shadow-brand-600/20'
                }`}
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>{lang === 'ar' ? 'حفظ الدواء في السجل' : 'Save to Ledger'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Central Camera Scanner Modal */}
      <CentralScannerModal
        isOpen={isScannerOpen}
        mode="ADD_STOCK"
        onClose={() => setIsScannerOpen(false)}
        catalogData={catalogRaw}
        onAddStockItem={resolveScannedBarcode}
        onUnknownScanned={(barcode) => resolveScannedBarcode(barcode)}
        lang={lang}
      />
    </>
  );
}
