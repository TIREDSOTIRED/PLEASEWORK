import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { B2BOrder, B2BOrderItemSnapshot } from '../../domain/b2b';
import { useHardware } from '../../application/hooks/useHardware';
import { useAuth } from '../../application/auth/AuthContext';
import { IndexedDbInventoryRepository } from '../../infrastructure/storage/IndexedDbInventoryRepository';
import { ShippingManifestData } from './ShippingManifest';
import {
  X,
  PackageCheck,
  Barcode,
  CheckCircle2,
  AlertCircle,
  Building,
  MapPin,
  Clock,
  Printer,
  Sparkles,
  Layers,
  ChevronRight,
  ShieldCheck,
  Search,
  RefreshCw,
  Phone
} from 'lucide-react';

export interface DispatchItemState extends B2BOrderItemSnapshot {
  allocatedBatch: string;
  expiryDate: string;
  shelfLocation: string;
  isVerified: boolean;
  availableBatches: {
    batchNumber: string;
    expiryDate: string;
    stock: number;
  }[];
}

interface DispatchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  order: (B2BOrder & { 
    buyerName?: string; 
    buyerNameAr?: string;
    buyerLocation?: string; 
    buyerLocationAr?: string;
    buyerPhone?: string;
    timeWaiting?: string; 
    buyerLicense?: string;
  }) | null;
  activeTenantId: string;
  triggerToast: (message: string, type: 'success' | 'info' | 'error') => void;
  onOrderDispatched: (dispatchedOrder: B2BOrder, manifest: ShippingManifestData) => Promise<boolean> | void;
  lang?: 'ar' | 'en';
}

export default function DispatchDrawer({
  isOpen,
  onClose,
  order,
  activeTenantId,
  triggerToast,
  onOrderDispatched,
  lang = 'ar'
}: DispatchDrawerProps) {
  const hardware = useHardware();
  const { activePharmacy } = useAuth();
  const [items, setItems] = useState<DispatchItemState[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [selectedItemForBatchChange, setSelectedItemForBatchChange] = useState<DispatchItemState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Delivery commitment window: defaults to tomorrow 10:00–12:00 (warehouse
  // work hours) — both ends editable. Shown to the pharmacy on the order.
  const toLocalInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
  const [deliveryAt, setDeliveryAt] = useState<string>(() => toLocalInput(new Date(Date.now() + 86400000)));
  const [deliveryEndAt, setDeliveryEndAt] = useState<string>(() => {
    const d = new Date(Date.now() + 86400000);
    d.setHours(12, 0, 0, 0);
    return toLocalInput(d);
  });
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Initialize picking list with batches and shelf locations when order changes
  useEffect(() => {
    if (!order || !isOpen) return;

    let isMounted = true;
    const repo = new IndexedDbInventoryRepository();

    async function loadBatchesAndShelves() {
      try {
        const itemStates: DispatchItemState[] = await Promise.all(
          order!.items.map(async (item) => {
            let availableBatches: { batchNumber: string; expiryDate: string; stock: number }[] = [];
            let shelfLocation = 'Zone A-01';

            try {
              const validBatches = await repo.getValidBatchesForDrug(item.originalCatalogId);
              if (validBatches && validBatches.length > 0) {
                availableBatches = validBatches
                  .filter((b) => b.currentRemainingQuantity > 0)
                  .map((b) => ({
                    batchNumber: b.batchNumber,
                    expiryDate: b.expiryDate instanceof Date ? b.expiryDate.toISOString().split('T')[0] : String(b.expiryDate),
                    stock: b.currentRemainingQuantity
                  }));
              }
            } catch (e) {
              console.warn(`Could not load local batches for medicine ${item.name}:`, e);
            }

            // FEFO Sorting: Oldest expiry first
            const sortedBatches = [...availableBatches].sort(
              (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
            );

            // Default FEFO Batch assignment
            const primaryBatch = sortedBatches[0] || {
              batchNumber: `BAT-${Math.floor(1000 + Math.random() * 9000)}`,
              expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              stock: item.requestedQuantity + 20
            };

            return {
              ...item,
              allocatedBatch: primaryBatch.batchNumber,
              expiryDate: primaryBatch.expiryDate,
              shelfLocation,
              isVerified: false,
              availableBatches:
                sortedBatches.length > 0
                  ? sortedBatches
                  : [primaryBatch]
            };
          })
        );

        if (isMounted) {
          setItems(itemStates);
          // Focus barcode input
          setTimeout(() => scanInputRef.current?.focus(), 200);
        }
      } catch (err) {
        console.error('Error loading picking batches:', err);
      }
    }

    loadBatchesAndShelves();

    return () => {
      isMounted = false;
    };
  }, [order, isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Calculate picking progress
  const verifiedCount = useMemo(() => items.filter((i) => i.isVerified).length, [items]);
  const isAllVerified = useMemo(() => items.length > 0 && verifiedCount === items.length, [items, verifiedCount]);

  // Barcode scanning verification
  const handleScanVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim()) return;

    const term = scanInput.trim().toLowerCase();
    
    // Find matching item by batch, name, catalogId, or index
    const matchIndex = items.findIndex((item) => {
      if (item.isVerified) return false;
      return (
        item.allocatedBatch.toLowerCase() === term ||
        item.name.toLowerCase().includes(term) ||
        (item.nameAr && item.nameAr.toLowerCase().includes(term)) ||
        (item.nameEn && item.nameEn.toLowerCase().includes(term)) ||
        item.originalCatalogId.toLowerCase() === term ||
        item.id.toLowerCase() === term
      );
    });

    if (matchIndex !== -1) {
      hardware.playScanSuccess();
      const matchedItemName = (lang === 'ar' && items[matchIndex].nameAr) ? items[matchIndex].nameAr : items[matchIndex].name;
      setItems((prev) =>
        prev.map((item, idx) => (idx === matchIndex ? { ...item, isVerified: true } : item))
      );
      triggerToast(
        lang === 'ar' ? `تم التحقق وتجهيز: ${matchedItemName}` : `Verified & Packed: ${matchedItemName}`, 
        'success'
      );
      setScanInput('');
    } else {
      hardware.playScanError();
      triggerToast(
        lang === 'ar' ? `الرمز "${scanInput}" غير مطابق لأي صنف في هذه الطلبية!` : `Barcode "${scanInput}" not found in this order!`, 
        'info'
      );
    }
  };

  const toggleVerifyItem = (index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const isNowVerified = !next[index].isVerified;
      next[index] = { ...next[index], isVerified: isNowVerified };
      if (isNowVerified) {
        hardware.playScanSuccess();
      }
      return next;
    });
  };

  const handleVerifyAll = () => {
    hardware.playScanSuccess();
    setItems((prev) => prev.map((item) => ({ ...item, isVerified: true })));
    triggerToast(
      lang === 'ar' ? 'تم التحقق من كافة المواد بنجاح!' : 'All items verified!', 
      'success'
    );
  };

  const handleBatchSelect = (itemIndex: number, newBatch: { batchNumber: string; expiryDate: string }) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[itemIndex] = {
        ...updated[itemIndex],
        allocatedBatch: newBatch.batchNumber,
        expiryDate: newBatch.expiryDate
      };
      return updated;
    });
    setSelectedItemForBatchChange(null);
    triggerToast(
      lang === 'ar' ? `تم تخصيص الطبخة ${newBatch.batchNumber}` : `Assigned batch ${newBatch.batchNumber}`, 
      'info'
    );
  };

  // Final Dispatch Action
  const handleConfirmDispatch = async () => {
    if (!order || isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 1. Prepare Manifest Data using active warehouse details
      const totalQuantity = items.reduce((sum, i) => sum + i.requestedQuantity, 0);
      const totalValue = items.reduce((sum, i) => sum + i.costAtOrder * i.requestedQuantity, 0);

      const warehouseName = activePharmacy?.name || 'Warehouse';
      const warehouseLicense = activePharmacy?.licenseNumber || '';
      const warehouseAddress = activePharmacy?.address || (typeof activePharmacy?.location === 'string' ? activePharmacy.location : activePharmacy?.location?.city) || '';
      const warehousePhone = activePharmacy?.contactPhone || '';

      const buyerName = (lang === 'ar' && order.buyerNameAr) ? order.buyerNameAr : (order.buyerName || 'Client Pharmacy');
      const buyerAddress = (lang === 'ar' && order.buyerLocationAr) ? order.buyerLocationAr : (order.buyerLocation || 'Central District');
      const buyerLicense = order.buyerLicense || 'PHAR-LIC-4421';

      const manifestData: ShippingManifestData = {
        orderId: order.orderId,
        dispatchDate: new Date().toISOString(),
        warehouseName,
        warehouseLicense,
        warehouseAddress,
        warehousePhone,
        buyerName,
        buyerLicense,
        buyerAddress,
        contactPerson: lang === 'ar' ? 'الصيدلاني المسؤول' : 'Lead Pharmacist',
        items: items.map((item) => ({
          id: item.id,
          name: (lang === 'ar' && item.nameAr) ? item.nameAr : item.name,
          genericName: item.nameEn !== item.name ? item.nameEn : undefined,
          allocatedBatch: item.allocatedBatch,
          expiryDate: item.expiryDate,
          quantity: item.requestedQuantity,
          unitPrice: item.costAtOrder,
          totalPrice: item.costAtOrder * item.requestedQuantity
        })),
        totalQuantity,
        totalValue,
        dispatchToken: `DISPATCH-${Date.now().toString().slice(-6)}`,
        expectedDeliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
        deliveryWindowEnd: deliveryEndAt ? new Date(deliveryEndAt).toISOString() : undefined
      };

      // 2. Trigger parent dispatch callback and await persistence
      const result = await onOrderDispatched(
        {
          ...order,
          status: 'DISPATCHED',
          updatedAt: new Date().toISOString()
        },
        manifestData
      );

      // Only close and succeed if persistence succeeded
      if (result !== false) {
        hardware.playCheckoutSuccess();
        onClose();
      }
    } catch (err: any) {
      console.error('Dispatch failed:', err);
      triggerToast(
        lang === 'ar' ? `فشل إتمام عملية التجهيز والشحن: ${err?.message || ''}` : `Failed to complete dispatch: ${err?.message || ''}`, 
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!order) return null;

  const displayName = lang === 'ar' ? (order.buyerNameAr || order.buyerName) : order.buyerName;
  const displayLocation = lang === 'ar' ? (order.buyerLocationAr || order.buyerLocation) : order.buyerLocation;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
            onClick={onClose}
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
          >
            {/* Centered Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl bg-slate-50 rounded-lg shadow-2xl flex flex-col max-h-[88vh] overflow-hidden my-auto border border-slate-200"
            >
              {/* Drawer Header */}
              <div className="p-5 bg-white border-b border-slate-200 shrink-0">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-50 text-brand-700 rounded-xl border border-brand-200/60">
                      <PackageCheck className="w-6 h-6 stroke-[2.5]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold bg-brand-50 text-brand-800 border border-brand-200 px-2.5 py-0.5 rounded-full uppercase">
                          {lang === 'ar' ? `طلب #${order.orderId}` : `Order #${order.orderId}`}
                        </span>
                        {order.timeWaiting && (
                          <span className="text-xs font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded flex items-center gap-1 border border-amber-200">
                            <Clock className="w-3 h-3" /> {order.timeWaiting}
                          </span>
                        )}
                      </div>
                      <h2 className="text-lg font-black text-slate-900 mt-1">
                        {lang === 'ar' ? 'فحص وتجهيز طلبية التوريد (FEFO)' : 'Warehouse Order Picking & Verification'}
                      </h2>
                    </div>
                  </div>
                  <button
                    id="btn-close-dispatch-drawer"
                    onClick={onClose}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Destination Pharmacy Banner */}
                <div className="p-3 bg-slate-100/80 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-slate-700">
                    <Building className="w-4 h-4 text-slate-500" />
                    <span className="font-bold text-slate-900">{displayName}</span>
                    <span className="text-slate-400">•</span>
                    <span className="flex items-center gap-1 text-slate-500">
                      <MapPin className="w-3 h-3" /> {displayLocation}
                    </span>

                    {/* Numeric phone display */}
                    {order.buyerPhone && (
                      <>
                        <span className="text-slate-400">•</span>
                        <span className="flex items-center gap-1 text-slate-600">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span dir="ltr" className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {order.buyerPhone}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  <div className="font-mono font-bold text-brand-800 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                    {lang === 'ar' ? `${items.length} أصناف` : `${items.length} Line Items`}
                  </div>
                </div>
              </div>

              {/* Scan Verification Bar & Progress */}
              <div className="p-4 bg-white border-b border-slate-200 space-y-3 shrink-0">
                <form onSubmit={handleScanVerify} className="flex gap-2">
                  <div className="relative flex-1">
                    <Barcode className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      ref={scanInputRef}
                      type="text"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      placeholder={lang === 'ar' ? 'امسح الباركود أو اكتب اسم المادة للتجهيز...' : 'Scan barcode or type item name to pack...'}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-brand-500 transition-all text-slate-800"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs rounded-xl transition-all shadow-xs shrink-0 cursor-pointer"
                  >
                    {lang === 'ar' ? 'تحقق' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifyAll}
                    className="px-3 py-2 bg-brand-50 text-brand-800 border border-brand-200 hover:bg-brand-100 font-bold text-xs rounded-xl transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {lang === 'ar' ? 'تحقق من الكل' : 'Verify All'}
                  </button>
                </form>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500 mb-1.5 font-mono">
                    <span>{lang === 'ar' ? 'نسبة إنجاز تجهيز الطرد' : 'PACKING PROGRESS'}</span>
                    <span>
                      {lang === 'ar' ? `تم تجهيز ${verifiedCount} من أصل ${items.length} أصناف` : `${verifiedCount} / ${items.length} Items Packed`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                    <div
                      className="bg-brand-600 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${items.length > 0 ? (verifiedCount / items.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Picking Items List */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <Layers className="w-4 h-4 text-brand-600" />
                    {lang === 'ar' ? 'قائمة المواد المسحوبة حسب أولوية الصلاحية (FEFO)' : 'Warehouse Picking List (FEFO Priority)'}
                  </h3>
                </div>

                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const itemName = (lang === 'ar' && item.nameAr) ? item.nameAr : item.name;
                    return (
                      <div
                        key={item.id || idx}
                        className={`border rounded-xl p-3.5 transition-all ${
                          item.isVerified
                            ? 'bg-brand-50/60 border-brand-200'
                            : 'bg-white border-slate-200 shadow-xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => toggleVerifyItem(idx)}
                              className={`mt-0.5 p-1 rounded-lg transition-colors cursor-pointer ${
                                item.isVerified
                                  ? 'text-brand-700 bg-brand-100'
                                  : 'text-slate-300 hover:text-slate-400 bg-slate-100'
                              }`}
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                            <div>
                              <h4 className="font-bold text-slate-900 text-sm">
                                {itemName}
                              </h4>
                              {lang === 'ar' && item.nameEn && item.nameEn !== itemName && (
                                <p className="text-[10px] text-slate-400 font-mono">{item.nameEn}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                                <span className="font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                                  {item.shelfLocation}
                                </span>
                                <span className="font-mono text-brand-800 bg-brand-50 px-2 py-0.5 rounded font-bold border border-brand-200 text-[11px]">
                                  {lang === 'ar' ? `طبخة: ${item.allocatedBatch}` : `Batch: ${item.allocatedBatch}`}
                                </span>
                                <span className="text-slate-400 font-mono text-[11px]">
                                  {lang === 'ar' ? `صلاحية: ${item.expiryDate}` : `Exp: ${item.expiryDate}`}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className={lang === 'ar' ? 'text-left' : 'text-right'}>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">
                              {lang === 'ar' ? 'الكمية' : 'Qty'}
                            </span>
                            <span className="text-base font-black font-mono text-slate-800">
                              {item.requestedQuantity}
                            </span>
                          </div>
                        </div>

                        {/* Batch selector toggle */}
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-medium">
                            {lang === 'ar' ? 'إجمالي السطر:' : 'Line Total:'}{' '}
                            <strong className="text-brand-900 font-mono font-bold">
                              {(item.costAtOrder * item.requestedQuantity).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
                            </strong>
                          </span>
                          <button
                            onClick={() => setSelectedItemForBatchChange(item)}
                            className="text-brand-700 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {lang === 'ar' ? 'تغيير الطبخة (FEFO)' : 'Change Batch (FEFO)'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer & Confirm Dispatch Button */}
              <div className="p-5 bg-white border-t border-slate-200 shrink-0 space-y-3">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-500 font-bold uppercase">
                    {lang === 'ar' ? 'إجمالي قيمة الشحنة' : 'Total Order Value'}
                  </span>
                  <span className="text-xl font-black text-brand-900 font-mono">
                    {items.reduce((sum, i) => sum + i.costAtOrder * i.requestedQuantity, 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
                  </span>
                </div>

                {/* Scheduled delivery commitment window (shown to the pharmacy) */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      {lang === 'ar' ? 'من' : 'Window start'}
                    </span>
                    <input
                      type="datetime-local"
                      value={deliveryAt}
                      onChange={(e) => setDeliveryAt(e.target.value)}
                      className="mt-1 w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-brand-700 bg-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {lang === 'ar' ? 'إلى' : 'Window end'}
                    </span>
                    <input
                      type="datetime-local"
                      value={deliveryEndAt}
                      onChange={(e) => setDeliveryEndAt(e.target.value)}
                      className="mt-1 w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-brand-700 bg-white"
                    />
                  </label>
                  <p className="col-span-2 text-[10px] text-slate-400 mt-0.5">
                    {lang === 'ar' ? 'سيراها الصيدلية كموعد تسليم متوقع.' : 'The pharmacy sees this as the expected arrival window.'}
                  </p>
                </div>

                <button
                  id="btn-confirm-dispatch-order"
                  onClick={handleConfirmDispatch}
                  disabled={isSubmitting}
                  className="w-full py-3 text-white font-bold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer bg-brand-700 hover:bg-brand-800 active:scale-98 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  ) : (
                    <>
                      <Printer className="w-5 h-5 stroke-[2.5]" />
                      <span>{lang === 'ar' ? 'اعتماد وشحن الطلبية وطباعة بيان الشحن' : 'Confirm & Dispatch Order'}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>

          {/* Batch Selector Modal Overlay */}
          {selectedItemForBatchChange && (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[70] flex items-center justify-center p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <div className="bg-white rounded-lg max-w-md w-full p-5 shadow-xl border border-slate-200">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-base text-slate-900">
                      {lang === 'ar' ? 'اختر الطبخة (أولوية الصلاحية FEFO)' : 'Select Batch (FEFO Priority)'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">
                      {(lang === 'ar' && selectedItemForBatchChange.nameAr) ? selectedItemForBatchChange.nameAr : selectedItemForBatchChange.name}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedItemForBatchChange(null)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-2 mb-5 max-h-60 overflow-y-auto">
                  {selectedItemForBatchChange.availableBatches.map((b, bIdx) => (
                    <button
                      key={b.batchNumber}
                      onClick={() => {
                        const itemIdx = items.findIndex((i) => i.id === selectedItemForBatchChange.id);
                        if (itemIdx !== -1) {
                          handleBatchSelect(itemIdx, b);
                        }
                      }}
                      className={`w-full p-3 rounded-xl border text-left flex justify-between items-center transition-colors cursor-pointer ${
                        selectedItemForBatchChange.allocatedBatch === b.batchNumber
                          ? 'border-brand-500 bg-brand-50/60'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="font-bold font-mono text-xs text-slate-800 flex items-center gap-2">
                          {b.batchNumber}
                          {bIdx === 0 && (
                            <span className="text-[10px] bg-brand-100 text-brand-800 font-sans font-bold px-1.5 py-0.5 rounded">
                              {lang === 'ar' ? 'الأقرب انتهاءً (FEFO)' : 'FEFO Top Pick'}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                          {lang === 'ar' ? `تاريخ الانتهاء: ${b.expiryDate}` : `Expires: ${b.expiryDate}`}
                        </div>
                      </div>
                      <div className={lang === 'ar' ? 'text-left' : 'text-right'}>
                        <span className="text-xs font-mono font-bold text-slate-700">
                          {b.stock} {lang === 'ar' ? 'عبوة' : 'units'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setSelectedItemForBatchChange(null)}
                  className="w-full py-2.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-200 cursor-pointer"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
