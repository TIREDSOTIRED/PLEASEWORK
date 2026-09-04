import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, updateDoc, writeBatch, increment } from 'firebase/firestore';
import { db } from '../../infrastructure/firebase';
import { B2BOrder } from '../../domain/b2b';
import { DrugBatch } from '../../domain/inventory';
import { FEFOStockAllocator } from '../../domain/services';
import { syncOffersInBatch } from '../../infrastructure/b2b/syncOfferAvailability';
import {
  Package,
  CheckCircle,
  XCircle,
  Clock,
  MapPin,
  Building,
  Activity,
  FileWarning,
  PackageCheck,
  Printer,
  Phone,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  Inbox,
  AlertTriangle,
  X,
  History as HistoryIcon,
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../../application/auth/AuthContext';
import DispatchDrawer from './DispatchDrawer';
import ShippingManifest, { ShippingManifestData } from './ShippingManifest';
import { Badge } from '../ui/Badge';
import { StatusBadge } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import OrderReceiptDocument from '../receipts/OrderReceiptDocument';

interface B2BQueueTabProps {
  activeTenantId?: string;
  triggerToast: (message: string, type: 'success' | 'info' | 'error') => void;
  lang?: 'en' | 'ar';
}

/**
 * Fire-and-forget order-event notification scoped to the affected tenant.
 * NEVER blocks or fails the primary workflow: rules denials / offline are
 * warn-only, matching the existing offer-deactivation writer pattern.
 */
async function pushOrderNotification(payload: Record<string, any>): Promise<void> {
  try {
    const { db: fsDb } = await import('../../infrastructure/firebase');
    const { addDoc, collection } = await import('firebase/firestore');
    if (!fsDb) return;
    await addDoc(collection(fsDb, 'b2b_notifications'), {
      ...payload,
      createdAt: new Date().toISOString()
    });
  } catch (e) {
    console.warn('Order notification skipped:', e);
  }
}

export interface EnrichedB2BOrder extends B2BOrder {
  buyerName?: string;
  buyerNameAr?: string;
  buyerLocation?: string;
  buyerLocationAr?: string;
  buyerPhone?: string;
  buyerLicense?: string;
  totalValue: number;
  timeWaiting: string;
  /** Set when the pharmacy reported the package as never delivered (audit). */
  deliveryFailedAt?: string;
}

export default function B2BQueueTab({ activeTenantId, triggerToast, lang = 'ar' }: B2BQueueTabProps) {
  const { currentSession, activePharmacy } = useAuth();
  const isPharmacySeller = activePharmacy?.tenantType === 'RETAIL_PHARMACY';

  // Cosmetic language value must not resubscribe the incoming-orders listener.
  const langRef = React.useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const [orders, setOrders] = useState<EnrichedB2BOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDispatchOrder, setActiveDispatchOrder] = useState<EnrichedB2BOrder | null>(null);
  const [activeManifest, setActiveManifest] = useState<ShippingManifestData | null>(null);
  const [orderToReject, setOrderToReject] = useState<EnrichedB2BOrder | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);

  // Counter-offer fields: optional available-quantity + free-text reason are
  // composed into rejectionReason (the whitelisted field) so the pharmacy
  // receives an actionable message instead of a bare refusal.
  const [counterQty, setCounterQty] = useState<string>('');
  const [rejectNote, setRejectNote] = useState<string>('');

  // ---- Order History (terminal orders) ----
  type OrderHistoryFilter = 'ALL' | 'DISPATCHED' | 'RECEIVED' | 'DRAFT';
  const [historyOrders, setHistoryOrders] = useState<EnrichedB2BOrder[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<OrderHistoryFilter>('ALL');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  // Printable order receipt (warehouse copy)
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);

  const statusBadge = (status: string) => <StatusBadge status={status as any} lang={lang} />;

  const effectiveTenantId = activeTenantId || currentSession?.pharmacyId || activePharmacy?.tenantId || activePharmacy?.id || '';
  const isInitialLoadRef = useRef(true);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const cleanupRef = useRef<(() => void) | null>(null);

  const loadOrderHistory = async () => {
    if (!db || !effectiveTenantId || isLoadingHistory) return;
    setIsLoadingHistory(true);
    try {
      const { getDocs } = await import('firebase/firestore');
      const q = query(collection(db, 'b2b_orders'), where('sellerTenantId', '==', effectiveTenantId));
      const snap = await getDocs(q);
      const terminal: EnrichedB2BOrder[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data() as B2BOrder;
        if (data.status === 'PENDING_APPROVAL') return; // live queue handles these
        terminal.push({
          ...data,
          orderId: docSnap.id,
          buyerName: data.buyerName || '',
          totalValue: data.totalValue ?? (data.items || []).reduce((acc, it) => acc + (it.costAtOrder || 0) * (it.requestedQuantity || 0), 0),
          timeWaiting: ''
        });
      });
      terminal.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setHistoryOrders(terminal.slice(0, 50));
      setHistoryLoaded(true);
    } catch (err) {
      console.error('Failed to load order history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (showHistory && !historyLoaded && effectiveTenantId) {
      loadOrderHistory();
    }
  }, [showHistory, historyLoaded, effectiveTenantId]);

  // Realtime receipt notifications for this warehouse (bounded 1h window,
  // tenant-scoped client-side). Complements the existing new-order toast.
  useEffect(() => {
    if (!db || !effectiveTenantId) return;
    let cancelled = false;
    const setup = async () => {
      const { onSnapshot: snap, query: q, where: w, collection: col } = await import('firebase/firestore');
      if (cancelled) return;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const unsub = snap(
        q(col(db, 'b2b_notifications'), w('createdAt', '>=', oneHourAgo)),
        (snapshot) => {
          snapshot.docChanges().forEach(change => {
            if (change.type !== 'added') return;
            const data = change.doc.data();
            if (data.type === 'ORDER_RECEIVED' && data.sellerTenantId === effectiveTenantId) {
              triggerToast(
                langRef.current === 'ar'
                  ? `تم استلام الطلبية #${data.orderId} من الصيدلية`
                  : `Pharmacy confirmed receipt of order #${data.orderId}`,
                'success'
              );
            }
          });
        },
        (err) => console.warn('Receipt notification listener error:', err)
      );
      cleanupRef.current = unsub;
    };
    setup();
    return () => {
      cancelled = true;
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    };
  }, [effectiveTenantId]);

  const filteredHistory = historyOrders.filter(o => historyFilter === 'ALL' || o.status === historyFilter);

  useEffect(() => {
    if (!effectiveTenantId || !db) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const q = query(
      collection(db, 'b2b_orders'),
      where('sellerTenantId', '==', effectiveTenantId),
      where('status', '==', 'PENDING_APPROVAL')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      setIsLoading(false);
      try {
        const enrichedOrders: EnrichedB2BOrder[] = [];
        const incomingNewOrders: EnrichedB2BOrder[] = [];

        for (const orderDoc of snapshot.docs) {
          const data = orderDoc.data() as B2BOrder;
          const orderId = orderDoc.id;

          let buyerName = data.buyerName || '';
          let buyerNameAr = data.buyerNameAr || '';
          let buyerLocation = data.buyerAddress || data.buyerCity || '';
          let buyerLocationAr = data.buyerAddressAr || data.buyerCityAr || '';
          let buyerPhone = data.buyerPhone || '';
          let buyerLicense = data.buyerLicense || '';

          // Canonical check for developer mock environments
          if (data.buyerTenantId === 'dev_retail_id') {
            buyerName = buyerName || 'Fawbi Pharmacy';
            buyerNameAr = buyerNameAr || 'صيدلية الفوعي النموذجية';
            buyerLocation = buyerLocation || 'Damascus, Mezzeh';
            buyerLocationAr = buyerLocationAr || 'دمشق، المزة';
            buyerPhone = buyerPhone || '+963 944 112 233';
            buyerLicense = buyerLicense || 'PHAR-LIC-9921-SY';
          } else if (data.buyerTenantId === 'wh_default' || data.buyerTenantId === 'dev_warehouse_id') {
            buyerName = buyerName || 'Fawbi Central Warehouse';
            buyerNameAr = buyerNameAr || 'مستودع الفوعي المركزي';
            buyerLocation = buyerLocation || 'Damascus Industrial Zone';
            buyerLocationAr = buyerLocationAr || 'المنطقة الصناعية، دمشق';
            buyerPhone = buyerPhone || '+963 11 662 8800';
            buyerLicense = buyerLicense || 'WH-LIC-8821-SY';
          }

          // Non-blocking fetch for legacy order without complete profile snapshot
          if (!buyerName && data.buyerTenantId && typeof data.buyerTenantId === 'string' && data.buyerTenantId.trim()) {
            try {
              const tenantDocRef = doc(db, 'tenants', data.buyerTenantId.trim());
              const tenantDoc = await getDoc(tenantDocRef);
              if (tenantDoc.exists()) {
                const tData = tenantDoc.data();
                buyerName = tData.name || tData.displayName || buyerName;
                buyerNameAr = tData.nameAr || tData.displayName || buyerName;
                buyerLocation = tData.address || (typeof tData.location === 'string' ? tData.location : tData.location?.city) || tData.verifiedLocation || buyerLocation;
                buyerLocationAr = tData.addressAr || tData.address || buyerLocation;
                buyerPhone = tData.contactPhone || buyerPhone;
                buyerLicense = tData.licenseNumber || buyerLicense;
              }
            } catch (e) {
              console.warn("Could not fetch buyer tenant details", e);
            }
          }

          // Fallbacks for display
          if (!buyerName) {
            const shortId = (data.buyerTenantId || orderId).slice(-6);
            buyerName = `Pharmacy (${shortId})`;
            buyerNameAr = `صيدلية (${shortId})`;
          }
          if (!buyerLocation) {
            buyerLocation = 'Damascus, Syria';
            buyerLocationAr = 'دمشق، سوريا';
          }

          const items = data.items || [];
          const totalValue = data.totalValue ?? items.reduce((acc, it) => acc + (it.costAtOrder || 0) * (it.requestedQuantity || 0), 0);

          // Calculate time waiting
          const orderTime = data.createdAt ? new Date(data.createdAt).getTime() : Date.now();
          const now = Date.now();
          const diffMins = Math.max(0, Math.floor((now - orderTime) / 60000));
          let timeWaiting = `${diffMins} min`;
          let timeWaitingAr = `${diffMins} دقيقة`;
          if (diffMins >= 60 && diffMins < 1440) {
            const hrs = Math.floor(diffMins / 60);
            const mins = diffMins % 60;
            timeWaiting = `${hrs}h ${mins}m`;
            timeWaitingAr = `${hrs} س ${mins} د`;
          } else if (diffMins >= 1440) {
            const days = Math.floor(diffMins / 1440);
            const hrs = Math.floor((diffMins % 1440) / 60);
            timeWaiting = `${days}d ${hrs}h`;
            timeWaitingAr = `${days} يوم ${hrs} س`;
          }

          const enrichedOrder: EnrichedB2BOrder = {
            ...data,
            orderId,
            buyerName,
            buyerNameAr,
            buyerLocation,
            buyerLocationAr,
            buyerPhone,
            buyerLicense,
            totalValue,
            timeWaiting: langRef.current === 'ar' ? timeWaitingAr : timeWaiting
          };

          enrichedOrders.push(enrichedOrder);

          if (!knownOrderIdsRef.current.has(orderId)) {
            if (!isInitialLoadRef.current) {
              incomingNewOrders.push(enrichedOrder);
            }
            knownOrderIdsRef.current.add(orderId);
          }
        }

        // Trigger real-time notifications for incoming orders
        if (!isInitialLoadRef.current && incomingNewOrders.length > 0) {
          const firstNew = incomingNewOrders[0];
          const name = langRef.current === 'ar' ? (firstNew.buyerNameAr || firstNew.buyerName) : firstNew.buyerName;
          triggerToast(
            langRef.current === 'ar' 
              ? `وصل طلب شراء جديد #${firstNew.orderId} من ${name}!` 
              : `New purchase order #${firstNew.orderId} received from ${name}!`, 
            'info'
          );
        }

        isInitialLoadRef.current = false;

        // Sort by oldest first
        enrichedOrders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setOrders(enrichedOrders);
      } catch (err) {
        console.error("Error processing B2B orders:", err);
      } finally {
        setIsLoading(false);
      }
    }, (error) => {
      console.error("B2B queue snapshot subscription error:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [effectiveTenantId]);

  const handleOrderDispatchedFromDrawer = async (
    dispatchedOrder: B2BOrder,
    manifest: ShippingManifestData
  ): Promise<boolean> => {
    if (!db) {
      triggerToast(lang === 'ar' ? 'قاعدة البيانات غير متصلة' : 'Database unavailable', 'error');
      return false;
    }
    if (!effectiveTenantId) {
      triggerToast(lang === 'ar' ? 'لا يمكن تحديد هوية المستودع' : 'Cannot resolve warehouse identity', 'error');
      return false;
    }

    try {
      const orderRef = doc(db, 'b2b_orders', dispatchedOrder.orderId);

      // Duplicate-dispatch guard: verify current server status before any write.
      const existingSnap = await getDoc(orderRef);
      if (!existingSnap.exists()) {
        triggerToast(lang === 'ar' ? 'الطلبية غير موجودة في الخادم' : 'Order not found on server', 'error');
        return false;
      }

      const existingData = existingSnap.data() as B2BOrder;
      if (existingData.status !== 'PENDING_APPROVAL') {
        triggerToast(
          lang === 'ar' 
            ? `الطلبية بحالة "${existingData.status}" مسبقاً ولا يمكن شحنها مجدداً` 
            : `Order is already in state "${existingData.status}"`, 
          'info'
        );
        return false;
      }

      // Ensure clean manifest data with non-undefined fields. Firestore rejects
      // undefined values outright — absent keys via conditional spread only.
      const sanitizedManifest = {
        dispatchToken: manifest.dispatchToken || `DISPATCH-${Date.now().toString().slice(-6)}`,
        totalQuantity: Number(manifest.totalQuantity) || 0,
        totalValue: Number(manifest.totalValue) || 0,
        dispatchDate: manifest.dispatchDate || new Date().toISOString(),
        // Delivery commitment window set by the warehouse at dispatch time.
        ...(manifest.expectedDeliveryAt ? { expectedDeliveryAt: manifest.expectedDeliveryAt } : {}),
        ...(manifest.deliveryWindowEnd ? { deliveryWindowEnd: manifest.deliveryWindowEnd } : {})
      };

      const nowIso = new Date().toISOString();
      const batch = writeBatch(db);
      const orderItems = dispatchedOrder.items || [];

      if (orderItems.length === 0) {
        triggerToast(lang === 'ar' ? 'الطلبية لا تحتوي أصنافاً' : 'Order contains no items', 'error');
        return false;
      }

      // ------------------------------------------------------------------
      // PHASE A — Validate & allocate FEFO batches for EVERY item first.
      // Nothing is written until all items pass. FEFOStockAllocator throws
      // InsufficientActiveStockError when active (unexpired/unspoiled) stock
      // cannot cover the request, which aborts the whole dispatch and keeps
      // the order PENDING_APPROVAL (no silent partial success).
      // Identity chain: item.originalCatalogId -> sanitized -> warehouse
      // storage_inventory doc id AND wholesale_offers doc id component
      // (never name matching).
      // ------------------------------------------------------------------
      for (const item of orderItems) {
        const rawCatalogId = String(item.originalCatalogId || '').trim();
        if (!rawCatalogId) {
          throw new Error(`Item "${item.name}" has no catalog identity — cannot locate warehouse stock.`);
        }
        const safeMedId = rawCatalogId.replace(/\//g, '_');
        const requestedQty = Number(item.approvedQuantity ?? item.requestedQuantity) || 0;

        const invRef = doc(db, 'tenants', effectiveTenantId, 'storage_inventory', safeMedId);
        const invSnap = await getDoc(invRef);

        const batchesRef = collection(db, 'tenants', effectiveTenantId, 'storage_inventory', safeMedId, 'batches');
        const batchesSnapshot = await getDocs(batchesRef);

        const drugBatches = batchesSnapshot.docs.map(d => {
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

        // Throws InsufficientActiveStockError when stock < requested or the
        // inventory document/batches are missing entirely (empty list).
        const allocations = FEFOStockAllocator.allocateStock(drugBatches, requestedQty);

        for (const alloc of allocations) {
          batch.update(
            doc(db, 'tenants', effectiveTenantId, 'storage_inventory', safeMedId, 'batches', alloc.batchId),
            { stock: increment(-alloc.quantityToDeduct), lastUpdated: nowIso }
          );
        }

        // Aggregate private stock must exist to decrement it.
        if (!invSnap.exists()) {
          throw new Error(`No warehouse inventory record for "${item.name}" (${safeMedId}).`);
        }
        batch.update(invRef, { stock: increment(-requestedQty), lastUpdated: nowIso });

 // Offer availability sync — shared helper (Option B): increment-based so
 // concurrent dispatches/POS sales cannot clobber each other; floors at 0
 // and deactivates when the offer drains. Deterministic id
 // (off_{sellerTenantId}_{safeCatalogId}) first, legacy docs by
 // sellerTenantId + catalogId + active. No-op when no offer exists.
 await syncOffersInBatch({
 batch,
 tenantId: effectiveTenantId,
 safeCatalogId: safeMedId,
 delta: -requestedQty
 });
 }

      // ------------------------------------------------------------------
      // PHASE B — Atomic commit: stock deduction + offer availability +
      // DISPATCHED status flip land in ONE Firestore writeBatch. If ANY
      // operation fails, nothing applies — a DISPATCHED state can never
      // exist without its matching stock deduction.
      // ------------------------------------------------------------------
      batch.update(orderRef, {
        status: 'DISPATCHED',
        dispatchedAt: nowIso,
        updatedAt: nowIso,
        manifest: sanitizedManifest
      });

      await batch.commit();

      // Notify the buying pharmacy (scoped to that tenant only).
      pushOrderNotification({
        type: 'ORDER_DISPATCHED',
        orderId: dispatchedOrder.orderId,
        buyerTenantId: existingData.buyerTenantId,
        sellerTenantId: effectiveTenantId,
        expectedDeliveryAt: sanitizedManifest.expectedDeliveryAt,
        deliveryWindowEnd: sanitizedManifest.deliveryWindowEnd || undefined
      });

      setActiveManifest(manifest);
      triggerToast(
        lang === 'ar' 
          ? `تم اعتماد وتجهيز شحن الطلبية #${dispatchedOrder.orderId} وخصم المخزون بنجاح!` 
          : `Order #${dispatchedOrder.orderId} dispatched and stock deducted successfully!`, 
        'success'
      );
      return true;
    } catch (err: any) {
      console.error('FORENSIC_ERROR Dispatch failed:', err, err.code, err.stack);

      if (err?.name === 'InsufficientActiveStockError') {
        triggerToast(
          lang === 'ar' 
            ? `مخزون غير كافٍ للشحن: ${err.message}` 
            : `Insufficient stock to dispatch: ${err.message}`, 
          'error'
        );
        return false;
      }

      const errorMsg = err?.message ? ` (${err.message}) [Code: ${err.code}]` : '';
      triggerToast(
        lang === 'ar' ? `فشل حفظ حالة الشحن في الخادم${errorMsg}` : `Failed to update dispatch status on server${errorMsg}`, 
        'error'
      );
      return false;
    }
  };

  const confirmRejectOrder = async () => {
    if (!orderToReject || !db || isRejecting) return;
    setIsRejecting(true);

    try {
      const orderRef = doc(db, 'b2b_orders', orderToReject.orderId);
      const existingSnap = await getDoc(orderRef);
      if (!existingSnap.exists()) {
        triggerToast(lang === 'ar' ? 'الطلبية غير موجودة' : 'Order not found', 'error');
        setOrderToReject(null);
        return;
      }

      const existingData = existingSnap.data() as B2BOrder;
      if (existingData.status !== 'PENDING_APPROVAL') {
        triggerToast(
          lang === 'ar' 
            ? `الطلبية بحالة "${existingData.status}" ولا يمكن رفضها الآن` 
            : `Order is already in state "${existingData.status}"`, 
          'info'
        );
        setOrderToReject(null);
        return;
      }

      const counterQtyNum = parseInt(counterQty, 10);
      let rejectionReason = 'Rejected by warehouse dispatch manager';
      if (!Number.isNaN(counterQtyNum) && counterQtyNum > 0) {
        rejectionReason = `COUNTER-OFFER: ${counterQtyNum} units available now.`;
      }
      if (rejectNote.trim()) {
        rejectionReason += ` ${rejectNote.trim()}`;
      }

      await updateDoc(orderRef, {
        status: 'DRAFT',
        rejectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rejectionReason
      });

      // Notify the buying pharmacy (scoped to that tenant only).
      pushOrderNotification({
        type: 'ORDER_REJECTED',
        orderId: orderToReject.orderId,
        buyerTenantId: existingData.buyerTenantId,
        sellerTenantId: effectiveTenantId,
        reason: rejectionReason
      });

      triggerToast(
        lang === 'ar' ? `تم رفض طلب الشراء #${orderToReject.orderId}` : `Order #${orderToReject.orderId} has been rejected`, 
        'info'
      );
      setOrderToReject(null);
    } catch (err: any) {
      console.error('FORENSIC_ERROR Reject failed:', err, err.code, err.stack);
      const errorMsg = err?.message ? ` (${err.message}) [Code: ${err.code}]` : '';
      triggerToast(
        lang === 'ar' ? `فشل رفض الطلبية${errorMsg}` : `Failed to reject order${errorMsg}`, 
        'error'
      );
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-lg border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-brand-50 text-brand-700 rounded-xl border border-brand-200/60 shadow-2xs">
            <PackageCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              {isPharmacySeller
                ? (lang === 'ar' ? 'طلبات الفائض الواردة' : 'Surplus Requests')
                : (lang === 'ar' ? 'قائمة تجهيز الشحنات الواردة' : 'Dispatch Queue')}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isPharmacySeller
                ? (lang === 'ar'
                    ? 'طلبات الشراء من فائض مخزونك — جهّز الكمية وأرسلها للصيدلية الطالبة'
                    : 'Requests for your surplus listings — pick, pack and dispatch to the requesting pharmacy')
                : (lang === 'ar'
                    ? 'طلبات التوريد بالجملة المعلقة بانتظار الاعتماد وتجهيز الإرسال في المستودع'
                    : 'Incoming wholesale requests pending your approval & fulfillment')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 font-mono">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {lang === 'ar' ? `${orders.length} طلبات قيد الانتظار` : `${orders.length} Pending`}
          </span>
        </div>
      </div>

      {/* Main Order Stream */}
      {isLoading && orders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto"></div>
          <p className="mt-4 text-slate-500 font-mono text-sm">
            {lang === 'ar' ? 'جارٍ مزامنة قائمة الطلبات الواردة...' : 'Syncing queue in real time...'}
          </p>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-xs space-y-3">
          <div className="w-16 h-16 bg-brand-50 rounded-lg flex items-center justify-center mx-auto border border-brand-100 text-brand-700">
            <CheckCircle className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-900">
            {lang === 'ar' ? 'لا توجد طلبات معلقة حالياً' : 'Queue Clear'}
          </h3>
          <p className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
            {lang === 'ar' 
              ? 'ستظهر طلبات الشراء الواردة من الصيدليات فور إرسالها بشكل فوري وبدون الحاجة لتحديث الصفحة.' 
              : 'Incoming purchase orders from pharmacies will appear here in real time without refreshing.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          <AnimatePresence>
            {orders.map((order) => {
              const displayName = lang === 'ar' ? (order.buyerNameAr || order.buyerName) : order.buyerName;
              const displayLocation = lang === 'ar' ? (order.buyerLocationAr || order.buyerLocation) : order.buyerLocation;

              return (
                <motion.div
                  key={order.orderId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                >
                  {/* Top Status Bar */}
                  <div className="bg-slate-50/80 px-5 py-3 border-b border-brand-100/60 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-600"></span>
                      </span>
                      <span className="text-xs font-black uppercase tracking-wider text-brand-900">
                        {lang === 'ar' ? 'طلب توريد جديد' : 'NEW ORDER'}
                      </span>
                      {(order as any).deliveryFailedAt && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md border border-rose-200">
                          <AlertTriangle className="w-3 h-3" />
                          {lang === 'ar' ? 'فشل توصيل سابق' : 'Delivery failed'}
                        </span>
                      )}
                      <span className="font-mono text-xs font-bold text-brand-800 bg-white px-2.5 py-0.5 rounded-md border border-brand-200 shadow-2xs">
                        #{order.orderId}
                      </span>
                      <button
                        id={`btn-print-queue-${order.orderId}`}
                        onClick={() => setReceiptOrderId(order.orderId)}
                        title={lang === 'ar' ? 'طباعة إيصال الطلبية' : 'Print order receipt'}
                        className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-300 transition-colors cursor-pointer shrink-0"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-800 bg-amber-50/90 px-2.5 py-1 rounded-lg border border-amber-200/80 shadow-2xs">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        {lang === 'ar' ? `قيد الانتظار: ${order.timeWaiting}` : `Waiting: ${order.timeWaiting}`}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-2xs">
                        <Activity className="w-3 h-3 text-brand-600" />
                        {lang === 'ar' ? 'بانتظار الموافقة' : 'Pending Approval'}
                      </span>
                    </div>
                  </div>

                  {/* Failed-delivery guidance */}
                  {(order as any).deliveryFailedAt && (
                    <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-[10px] font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {lang === 'ar'
                        ? 'أبلغت الصيدلية بعدم استلام الشحنة. المخزون لا يزال محجوزاً لهذا الطلب — أعد إدخال الكمية المستلمة فعلياً عبر الإدخال قبل إعادة الشحن، أو ارفض الطلب.'
                        : 'Pharmacy reported non-delivery. Stock remains reserved for this order — intake any returned units via normal intake before re-dispatching, or Reject.'}
                    </div>
                  )}

                  {/* Pharmacy Identification & Meta Details */}
                  <div className="p-5 sm:p-6 bg-slate-50/40 border-b border-slate-100">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
                      {/* Left/Right Org Details */}
                      <div className="flex items-start gap-4">
                        <div className="w-13 h-13 rounded-lg bg-brand-100/90 border border-brand-200 flex items-center justify-center shrink-0 text-brand-800 shadow-xs">
                          <Building className="w-6 h-6 stroke-[2]" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-slate-600 tracking-wider">
                              {lang === 'ar' ? 'الصيدلية الطالبة:' : 'Pharmacy:'}
                            </span>
                            <h3 className="font-black text-slate-900 text-base sm:text-lg tracking-tight">
                              {displayName}
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-0.5">
                            {/* Location */}
                            <span className="flex items-center gap-1.5 font-medium">
                              <MapPin className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                              <span className="text-slate-700">{displayLocation}</span>
                            </span>

                            {/* Phone */}
                            {order.buyerPhone && (
                              <span className="flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                                <span className="text-slate-600">{lang === 'ar' ? 'الهاتف:' : 'Phone:'}</span>
                                <span dir="ltr" className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-800">
                                  {order.buyerPhone}
                                </span>
                              </span>
                            )}

                            {/* License */}
                            {order.buyerLicense && (
                              <span className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
                                <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                {order.buyerLicense}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Summary Value Box */}
                      <div className="bg-white p-3.5 sm:px-5 sm:py-3.5 rounded-xl border border-slate-200/90 shadow-2xs self-start md:self-auto min-w-[200px]">
                        <span className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block mb-0.5">
                          {lang === 'ar' ? 'إجمالي قيمة الطلب' : 'Total Order Value'}
                        </span>
                        <div className="text-xl font-black font-mono text-brand-900">
                          {(Number(order?.totalValue) || 0).toLocaleString()}{' '}
                          <span className="text-xs text-brand-700 font-bold">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
                        </div>
                        <span className="text-[10px] text-slate-600 font-mono block mt-0.5">
                          {order.items.length} {lang === 'ar' ? 'أصناف دوائية مطلوبة' : 'line items requested'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Items Table */}
                  <div className="p-4 sm:p-5 overflow-x-auto">
                    <table className="w-full text-left border-collapse" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          <th className="pb-2.5 text-right">{lang === 'ar' ? 'اسم المادة / الدواء' : 'Item Description'}</th>
                          <th className="pb-2.5 text-center">{lang === 'ar' ? 'الكمية المطلوبة' : 'Quantity'}</th>
                          <th className="pb-2.5 text-center">{lang === 'ar' ? 'سعر الإفراد (ل.س)' : 'Unit Price (SYP)'}</th>
                          <th className="pb-2.5 text-left">{lang === 'ar' ? 'المجموع (ل.س)' : 'Line Total (SYP)'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {order.items.map((item, idx) => {
                          const itemName = (lang === 'ar' && item.nameAr) ? item.nameAr : item.name;
                          return (
                            <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-3 font-bold text-slate-800">
                                <div className="text-slate-900 font-bold">{itemName}</div>
                                {lang === 'ar' && item.nameEn && item.nameEn !== itemName && (
                                  <div className="text-[10px] text-slate-600 font-mono font-normal">{item.nameEn}</div>
                                )}
                              </td>
                              <td className="py-3 font-mono text-center text-slate-800 font-bold">
                                <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                  {item.requestedQuantity} <span className="text-[10px] text-slate-600 font-normal">{lang === 'ar' ? 'عبوة' : 'units'}</span>
                                </span>
                              </td>
                              <td className="py-3 font-mono text-center text-slate-600">
                                {(Number(item?.costAtOrder) || 0).toLocaleString()}
                              </td>
                              <td className="py-3 font-mono text-left font-bold text-brand-900">
                                {(Number((item?.costAtOrder || 0) * (item?.requestedQuantity || 0))).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Primary Action Buttons */}
                  <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
                    <button 
                      id={`btn-pick-verify-${order.orderId}`}
                      onClick={() => setActiveDispatchOrder(order)}
                      className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-brand-800 bg-white hover:bg-brand-50 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer border border-brand-200/80 shadow-2xs active:scale-98"
                    >
                      <PackageCheck className="w-4 h-4 text-brand-600" />
                      {lang === 'ar' ? 'فحص الباركود والصلاحيات (FEFO)' : 'Pick & Verify Items'}
                    </button>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                      <button 
                        id={`btn-reject-${order.orderId}`}
                        onClick={() => { setOrderToReject(order); setCounterQty(''); setRejectNote(''); }}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-rose-700 bg-white hover:bg-rose-50 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer border border-rose-200 shadow-2xs active:scale-98"
                      >
                        <FileWarning className="w-4 h-4" />
                        {lang === 'ar' ? 'رفض الطلب' : 'Reject'}
                      </button>
                      <button 
                        id={`btn-dispatch-${order.orderId}`}
                        onClick={() => setActiveDispatchOrder(order)}
                        className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 bg-brand-700 hover:bg-brand-800 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <CheckCircle className="w-4 h-4 stroke-[2.2]" />
                        {lang === 'ar' ? 'اعتماد وتجهيز الإرسال' : 'Accept / Dispatch'}
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ===================== ORDER HISTORY (terminal orders) ===================== */}
      <div className="pt-2">
        <div className="flex items-center gap-2">
          <button
            id="btn-toggle-order-history"
            onClick={() => setShowHistory(v => !v)}
            className="flex-1 flex items-center justify-between px-5 py-3.5 bg-white border border-slate-200 rounded-lg shadow-xs hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 text-sm font-black text-slate-700">
              <HistoryIcon className="w-4 h-4 text-slate-400" />
              {lang === 'ar' ? 'سجل الطلبات المنتهية' : 'Order History'}
              {!showHistory && historyLoaded && historyOrders.length > 0 && (
                <span className="font-mono text-[10px] font-bold text-slate-400">({historyOrders.length})</span>
              )}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <button
              id="btn-refresh-order-history"
              onClick={loadOrderHistory}
              disabled={isLoadingHistory}
              title={lang === 'ar' ? 'تحديث السجل' : 'Refresh history'}
              className="p-3 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-brand-600 hover:border-brand-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingHistory ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3">
                {/* Status filters */}
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: 'ALL', ar: 'الكل', en: 'All' },
                    { key: 'DISPATCHED', ar: 'تم الشحن', en: 'Dispatched' },
                    { key: 'RECEIVED', ar: 'مستلمة', en: 'Received' },
                    { key: 'DRAFT', ar: 'مرفوضة', en: 'Rejected' }
                  ] as const).map(f => (
                    <button
                      key={f.key}
                      onClick={() => setHistoryFilter(f.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        historyFilter === f.key
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {lang === 'ar' ? f.ar : f.en}
                    </button>
                  ))}
                </div>

                {isLoadingHistory ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-lg">
                    <EmptyState
                      icon={<Inbox className="w-8 h-8 text-slate-300" />}
                      title={lang === 'ar' ? 'لا توجد طلبات منتهية بعد' : 'No finished orders yet'}
                      description={
                        lang === 'ar'
                          ? 'ستظهر هنا الطلبيات المشحونة أو المستلمة أو المرفوضة للرجوع إليها لاحقاً.'
                          : 'Dispatched, received and rejected orders will be archived here for audit.'
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredHistory.map(o => {
                      const dateStr = o.createdAt
                        ? new Date(o.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-SY' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—';
                      const isExpanded = expandedHistoryId === o.orderId;
                      return (
                        <motion.div
                          key={o.orderId}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18 }}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                        >
                          <button
                            onClick={() => setExpandedHistoryId(isExpanded ? null : o.orderId)}
                            className="w-full p-4 flex items-center justify-between gap-3 text-left rtl:text-right cursor-pointer hover:bg-slate-50/70 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {statusBadge(o.status)}
                              <div className="min-w-0">
                                <span className="block font-mono text-xs font-bold text-slate-800 truncate">#{o.orderId}</span>
                                <span className="block text-[11px] text-slate-500 truncate">
                                  {(lang === 'ar' ? o.buyerNameAr || o.buyerName : o.buyerName) || o.buyerTenantId}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-3">
                              <div>
                                <span className="block font-mono text-sm font-black text-brand-800">
                                  {(Number(o.totalValue) || 0).toLocaleString()}
                                </span>
                                <span className="block text-[10px] text-slate-400 font-mono">{dateStr}</span>
                              </div>
                              <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-1.5">
                              {(o.items || []).map((it, idx) => (
                                <div key={idx} className="flex justify-between text-[11px] font-mono text-slate-600">
                                  <span className="truncate">{(lang === 'ar' && it.nameAr) ? it.nameAr : it.name}</span>
                                  <span className="shrink-0 ps-3">{it.requestedQuantity} × {(Number(it.costAtOrder) || 0).toLocaleString()}</span>
                                </div>
                              ))}
                              <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                                <span>{lang === 'ar' ? 'آخر تحديث:' : 'Last update:'} {o.updatedAt ? new Date(o.updatedAt).toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-GB') : '—'}</span>
                                <span>{(o.items || []).length} {lang === 'ar' ? 'أصناف' : 'items'}</span>
                              </div>
                              <div className="flex justify-end pt-1">
                                <button
                                  id={`btn-print-history-${o.orderId}`}
                                  onClick={() => setReceiptOrderId(o.orderId)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer transition-colors"
                                >
                                  {lang === 'ar' ? 'طباعة الإيصال' : 'Print receipt'}
                                </button>
                            </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Warehouse Dispatch Drawer */}
      <DispatchDrawer
        isOpen={!!activeDispatchOrder}
        onClose={() => setActiveDispatchOrder(null)}
        order={activeDispatchOrder}
        activeTenantId={effectiveTenantId}
        triggerToast={triggerToast}
        onOrderDispatched={handleOrderDispatchedFromDrawer}
        lang={lang}
      />

      {/* In-App Rejection Confirmation Modal (No iframe-blocking window.confirm) */}
      <AnimatePresence>
        {orderToReject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-12 h-12 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                  <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
                </div>
                <button
                  onClick={() => !isRejecting && setOrderToReject(null)}
                  disabled={isRejecting}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {lang === 'ar' ? 'تأكيد رفض طلب الشراء' : 'Confirm Order Rejection'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {lang === 'ar' 
                    ? `هل أنت متأكد من رفض الطلبية #${orderToReject.orderId} المقدمة من "${orderToReject.buyerNameAr || orderToReject.buyerName}"؟`
                    : `Are you sure you want to reject purchase order #${orderToReject.orderId} from "${orderToReject.buyerName}"?`}
                </p>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>{lang === 'ar' ? 'رقم الطلب:' : 'Order ID:'}</span>
                  <span className="font-bold text-slate-900 font-mono">#{orderToReject.orderId}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>{lang === 'ar' ? 'إجمالي الأصناف:' : 'Total Items:'}</span>
                  <span className="font-bold text-slate-900">{orderToReject.items.length} {lang === 'ar' ? 'أصناف' : 'items'}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>{lang === 'ar' ? 'القيمة الإجمالية:' : 'Total Value:'}</span>
                  <span className="font-bold text-brand-900 font-mono">{(Number(orderToReject.totalValue) || 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-normal">
                {lang === 'ar'
                  ? 'سيتم إشعار الصيدلية بأن الطلب تم رفضه وإعادته لحالة مسودة.'
                  : 'The requesting pharmacy will see this order returned as rejected/draft.'}
              </p>

              {/* Counter-offer (optional): tell the pharmacy what IS possible */}
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-1">
                  <span className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    {lang === 'ar' ? 'متوفر (اختياري)' : 'Available qty'}
                  </span>
                  <input
                    type="number" min="0"
                    value={counterQty}
                    onChange={(e) => setCounterQty(e.target.value)}
                    placeholder="e.g. 6"
                    className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500"
                  />
                </label>
                <label className="col-span-2">
                  <span className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    {lang === 'ar' ? 'ملاحظة للصيدلية (اختياري)' : 'Note to pharmacy'}
                  </span>
                  <input
                    type="text"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder={lang === 'ar' ? 'مثال: يتوفر الأسبوع القادم' : 'e.g. restocking next week'}
                    className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-brand-500"
                  />
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOrderToReject(null)}
                  disabled={isRejecting}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  id="btn-confirm-reject-dialog"
                  onClick={confirmRejectOrder}
                  disabled={isRejecting}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer active:scale-98 disabled:opacity-50"
                >
                  {isRejecting ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <>
                      <FileWarning className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'تأكيد الرفض' : 'Reject Order'}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Printable Order Receipt (shared document, warehouse copy) */}
      {receiptOrderId && (() => {
        const o = orders.find(x => x.orderId === receiptOrderId) ||
                  historyOrders.find(x => x.orderId === receiptOrderId);
        return o ? (
          <OrderReceiptDocument order={o} copyFor="seller" lang={lang} />
        ) : null;
      })()}

      {/* Printable Shipping Manifest Portal */}
      {activeManifest && (
        <ShippingManifest data={activeManifest} />
      )}
    </div>
  );
}
