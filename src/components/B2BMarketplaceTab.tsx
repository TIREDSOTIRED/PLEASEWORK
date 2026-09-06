import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  ShoppingCart, 
  Package, 
  Building2, 
  Loader2,
  X,
  CreditCard,
  MapPin,
  Tag,
  Gift,
  CheckCircle2,
  Clock,
  Truck,
  CheckCircle,
  FileText,
  Calendar,
  Sparkles,
  RefreshCw,
  Printer,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Store,
  Layers,
  Check,
  Info,
  SlidersHorizontal,
  BadgeAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { IndexedDbB2BOrderRepository } from '../infrastructure/storage/IndexedDbB2BOrderRepository';
import { useAuth } from '../application/auth/AuthContext';
import { db } from '../infrastructure/firebase';
import { collection, query, where, onSnapshot, setDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { confirmWarehouseOrderReceipt } from '../infrastructure/b2b/confirmWarehouseOrderReceipt';
import { isResolvableSellerId, resolveOfferSeller, type AuthoritativeTenant } from '../domain/b2b/sellerResolution';
import { StatusBadge } from './ui/StatusBadge';
import OrderReceiptDocument from './receipts/OrderReceiptDocument';
import { Badge } from './ui/Badge';
import { WholesaleOffer, B2BOrder } from '../domain/b2b';
import WarehouseProfileView from './warehouse/WarehouseProfileView';

interface B2BMarketplaceTabProps {
  triggerToast: (msg: string, type: 'success' | 'info' | 'error') => void;
  lang: 'en' | 'ar';
}

interface WarehouseSummary {
  id: string; // sellerTenantId
  name: string;
  city?: string;
  offers: WholesaleOffer[];
  totalOffers: number;
  bonusOffersCount: number;
  clearanceOffersCount: number;
  surplusOffersCount?: number;
  /** 'RETAIL_PHARMACY' | 'WHOLESALE_WAREHOUSE' — from offer.sellerType when present. */
  sellerType?: string;
  totalStockUnits: number;
  sampleMedicines: string[];
  categories: string[];
}

interface WarehouseCartGroup {
  sellerTenantId: string;
  sellerName: string;
  sellerType?: string;
  sellerCity?: string;
  items: { offer: WholesaleOffer; qty: number; validationError?: string }[];
  subtotalSyp: number;
  itemCount: number;
}

interface OrderConfirmationSummary {
  orderId: string;
  warehouseName: string;
  itemCount: number;
  totalSyp: number;
  status: 'PENDING_APPROVAL';
}

export default function B2BMarketplaceTab({ triggerToast, lang }: B2BMarketplaceTabProps) {
  const { currentSession, activePharmacy } = useAuth();
  
  // Navigation & View States
  const [activeTab, setActiveTab] = useState<'marketplace' | 'tracking'>('marketplace');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  
  // Search & Filter States
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  // Debounced shadow of the global search input: the expensive grouping memo
  // recomputes at most ~4x/sec while typing; the realtime offers listener is
  // completely independent of this debounce.
  const [debouncedGlobalSearch, setDebouncedGlobalSearch] = useState('');
  const [storefrontSearchQuery, setStorefrontSearchQuery] = useState('');
  const [storefrontFilter, setStorefrontFilter] = useState<'all' | 'bonus' | 'high_stock' | 'clearance'>('all');
  
  // Data States
  const [offers, setOffers] = useState<WholesaleOffer[]>([]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(true);
  
  // Cart State (Key: offerId, Value: quantity) — persisted in localStorage
  // with a 7-day rolling expiry so a built order survives reloads AND browser
  // restarts, without keeping stale carts forever.
  const CART_KEY = 'eshmun_b2b_active_cart';
  const CART_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return {};
      const { items, savedAt } = raw as { items?: Record<string, number>; savedAt?: number };
      if (!items || !savedAt || Date.now() - savedAt > CART_MAX_AGE_MS) return {};
      return items;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ items: cart, savedAt: Date.now() }));
    } catch {}
  }, [cart]);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify({ items: cart, savedAt: Date.now() })); } catch {}
  }, [cart]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('cash');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState<{ orderCount: number; orders: OrderConfirmationSummary[] } | null>(null);

  // Orders State
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  // Active vs History separation: client-side status filter + expandable terminal cards
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'PENDING_APPROVAL' | 'DISPATCHED' | 'RECEIVED' | 'DRAFT'>('ALL');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  // Two-step "package never arrived" report on DISPATCHED orders.
  const [pendingNotDeliveredId, setPendingNotDeliveredId] = useState<string | null>(null);
  // Printable order receipt (pharmacy copy) — renders a print-only document.
  const [orderReceiptId, setOrderReceiptOrderId] = useState<string | null>(null);
  // Counter-offers the pharmacy declined (persisted so they stay dismissed).
  const [declinedCounters, setDeclinedCounters] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('eshmun_declined_counters') || '[]'); } catch { return []; }
  });
  // Persist dismissals so Accept/Dismiss choices survive reloads and re-logins.
  useEffect(() => {
    try { localStorage.setItem('eshmun_declined_counters', JSON.stringify(declinedCounters)); } catch {}
  }, [declinedCounters]);
  const filteredActiveOrders = orderStatusFilter === 'ALL'
    ? activeOrders
    : activeOrders.filter((o: any) => o.status === orderStatusFilter);

  // ---- Printable order receipt (pharmacy copy) ----
  const printTarget = activeOrders.find((o: any) => o.orderId === orderReceiptId) || null;
  const handlePrintOrderReceipt = (orderId: string) => {
    setOrderReceiptOrderId(orderId);
    setTimeout(() => window.print(), 80);
  };
  useEffect(() => {
    if (!orderReceiptId) return;
    const done = () => setOrderReceiptOrderId(null);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, [orderReceiptId]);

  const statusLabel = (s: string) => s === 'PENDING_APPROVAL'
    ? (lang === 'ar' ? 'قيد المعالجة' : 'Pending')
    : s === 'DISPATCHED' ? (lang === 'ar' ? 'تم الشحن' : 'Dispatched')
    : s === 'RECEIVED' ? (lang === 'ar' ? 'مستلمة' : 'Received')
    : (lang === 'ar' ? 'مرفوضة' : 'Rejected');

  // 1. Subscribe in REAL-TIME to Active Wholesale Offers from Firestore
  useEffect(() => {
    if (!db) {
      setIsLoadingOffers(false);
      return;
    }

    setIsLoadingOffers(true);
    const offersRef = collection(db, 'wholesale_offers');
    const q = query(offersRef, where('active', '==', true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: WholesaleOffer[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        loaded.push({
          id: docSnap.id,
          offerId: data.offerId || docSnap.id,
          sellerTenantId: data.sellerTenantId || '',
          sellerName: data.sellerName || (langRef.current === 'ar' ? 'مستودع أدوية' : 'Wholesale Warehouse'),
          sellerCity: data.sellerCity || undefined,
          catalogId: data.catalogId || docSnap.id,
          tradeNameEn: data.tradeNameEn || data.medName || 'Medicine',
          tradeNameAr: data.tradeNameAr || '',
          composition: data.composition || data.genericName || '',
          company: data.company || data.manufacturer || '',
          manufacturer: data.manufacturer || data.company || '',
          priceSyp: Number(data.priceSyp || data.price || 0),
          price: Number(data.priceSyp || data.price || 0),
          availableQuantity: Math.max(0, Number(data.availableQuantity ?? data.stock ?? 0)),
          stock: Math.max(0, Number(data.availableQuantity ?? data.stock ?? 0)),
          minimumOrderQuantity: Number(data.minimumOrderQuantity || data.moq || 1),
          moq: Number(data.minimumOrderQuantity || data.moq || 1),
          bonus: data.bonus || '',
          isClearance: !!data.isClearance,
          expiryDate: data.expiryDate || '',
          active: data.active !== false,
          reliability: data.reliability || 4.9,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        });
      });

      // Exclude offers published by this same pharmacy/warehouse if it's viewing marketplace
      const filteredForViewer = currentSession?.pharmacyId 
        ? loaded.filter(o => o.sellerTenantId !== currentSession.pharmacyId)
        : loaded;

      // Sort by newest updates first
      filteredForViewer.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      setOffers(filteredForViewer);
      setIsLoadingOffers(false);
    }, (error) => {
      console.error("Failed to load wholesale offers in B2B Marketplace:", error);
      setIsLoadingOffers(false);
    });

    return () => unsubscribe();
  }, [currentSession?.pharmacyId]);

  // 2. Subscribe in REAL-TIME to Purchase Orders
  useEffect(() => {
    if (!db || !currentSession?.pharmacyId) {
      setIsLoadingOrders(false);
      return;
    }

    setIsLoadingOrders(true);
    const q = query(
      collection(db, "b2b_orders"),
      where("buyerTenantId", "==", currentSession.pharmacyId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orders = snapshot.docs.map(docSnap => docSnap.data());
      setActiveOrders(orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setIsLoadingOrders(false);
    }, (err) => {
      console.error("Failed to load B2B orders", err);
      setIsLoadingOrders(false);
    });

    return () => unsubscribe();
  }, [currentSession?.pharmacyId]);

  // 2.5. Subscribe to Deactivation Notifications
  const cartRef = React.useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Listener-stability refs: cosmetic values (language/toast identity) must not
  // tear down and re-create Firestore subscriptions on every toggle.
  const langRef = React.useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const triggerToastRef = React.useRef(triggerToast);
  useEffect(() => { triggerToastRef.current = triggerToast; }, [triggerToast]);

  useEffect(() => {
    if (!db || !currentSession?.pharmacyId) return;

    // Only listen to very recent notifications to avoid startup spam.
    // Type filtering happens client-side so no composite index is required;
    // every handled event is tenant-scoped before it is surfaced.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const notifQuery = query(
      collection(db, 'b2b_notifications'),
      where('createdAt', '>=', oneHourAgo)
    );

    const unsubscribe = onSnapshot(notifQuery, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const myTenantId = currentSession?.pharmacyId;

          // Offer deactivation: warn + prune from cart if affected
          if (data.type === 'OFFER_DEACTIVATED') {
            if (cartRef.current[data.offerId]) {
              triggerToastRef.current(
                langRef.current === 'ar'
                  ? `تنبيه: تم إيقاف عرض "${data.drugName}" من المستودع. السبب: ${data.reason}`
                  : `Alert: "${data.drugName}" was deactivated. Reason: ${data.reason}`,
                'error'
              );

              // Remove from cart
              setCart(prev => {
                const newCart = { ...prev };
                delete newCart[data.offerId];
                return newCart;
              });
            }
            return;
          }

          // Order lifecycle events scoped strictly to this buyer tenant
          if (data.buyerTenantId !== myTenantId) return;

          if (data.type === 'ORDER_DISPATCHED') {
            const etaStr = data.expectedDeliveryAt
              ? new Date(data.expectedDeliveryAt).toLocaleString(langRef.current === 'ar' ? 'ar-SY' : 'en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
              : '';
            triggerToastRef.current(
              langRef.current === 'ar'
                ? `تم شحن الطلبية #${data.orderId}${etaStr ? ` — التسليم المتوقع: ${etaStr}` : ''}`
                : `Order #${data.orderId} dispatched${etaStr ? ` — expected: ${etaStr}` : ''}`,
              'info'
            );
          } else if (data.type === 'ORDER_REJECTED') {
            triggerToastRef.current(
              langRef.current === 'ar'
                ? `تم رفض الطلبية #${data.orderId} من المستودع`
                : `Order #${data.orderId} was rejected by the warehouse`,
              'error'
            );
          }
        }
      });
    }, (err) => {
      console.warn('Failed to listen to B2B notifications', err);
    });

    return () => unsubscribe();
  }, [currentSession?.pharmacyId]);

  // 3. Aggregate Warehouses from Active Offers
  const warehouses = useMemo<WarehouseSummary[]>(() => {
    const warehouseMap: Record<string, WarehouseSummary> = {};

    for (const offer of offers) {
      const warehouseId = offer.sellerTenantId || offer.sellerName || 'default-warehouse';
      if (!warehouseMap[warehouseId]) {
        warehouseMap[warehouseId] = {
          id: warehouseId,
          name: offer.sellerName || (lang === 'ar' ? 'مستودع أدوية' : 'Wholesale Warehouse'),
          city: offer.sellerCity,
          offers: [],
          totalOffers: 0,
          bonusOffersCount: 0,
          clearanceOffersCount: 0,
          totalStockUnits: 0,
          sampleMedicines: [],
          categories: []
        };
      }

      const wh = warehouseMap[warehouseId];
      wh.offers.push(offer);
      wh.totalOffers += 1;
      if (offer.bonus) wh.bonusOffersCount += 1;
      if (offer.isClearance) wh.clearanceOffersCount += 1;
      if ((offer as any).offerKind === 'surplus') wh.surplusOffersCount = (wh.surplusOffersCount || 0) + 1;
      // Seller type: first non-null wins; legacy warehouse offers carry no
      // sellerType — default them so storefronts always classify cleanly.
      if (!wh.sellerType && (offer as any).sellerType) {
        wh.sellerType = (offer as any).sellerType;
      }
      if (!wh.sellerType) wh.sellerType = 'WHOLESALE_WAREHOUSE';
      wh.totalStockUnits += offer.availableQuantity;

      const medName = (lang === 'ar' && offer.tradeNameAr) ? offer.tradeNameAr : offer.tradeNameEn;
      if (wh.sampleMedicines.length < 3 && !wh.sampleMedicines.includes(medName)) {
        wh.sampleMedicines.push(medName);
      }
      if (offer.company && !wh.categories.includes(offer.company) && wh.categories.length < 4) {
        wh.categories.push(offer.company);
      }
    }

    return Object.values(warehouseMap).sort((a, b) => b.totalOffers - a.totalOffers);
  }, [offers, lang]);

  // 4. Selected Warehouse Object
  const selectedWarehouse = useMemo<WarehouseSummary | null>(() => {
    if (!selectedWarehouseId) return null;
    return warehouses.find(w => w.id === selectedWarehouseId) || null;
  }, [selectedWarehouseId, warehouses]);

  // 4.5 Real seller trust score — lazily computed from the seller's actual
  // b2b_orders history (replaces the fabricated reliability: 4.9 constant).
  const [trustScores, setTrustScores] = useState<Record<string, { fulfilledPct: number | null; rejectedPct: number; total: number }>>({});
  const trustInFlightRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    const sellerId = selectedWarehouse?.id;
    if (!db || !sellerId || trustScores[sellerId] || trustInFlightRef.current.has(sellerId)) return;
    trustInFlightRef.current.add(sellerId);
    (async () => {
      try {
        const { getDocs: gd, limit: qLimit } = await import('firebase/firestore');
        const snap = await gd(query(
          collection(db, 'b2b_orders'),
          where('sellerTenantId', '==', sellerId),
          qLimit(100)
        ));
        let total = 0, fulfilled = 0, rejected = 0;
        snap.forEach(d => {
          const s = d.data().status;
          if (s === 'PENDING_APPROVAL') return;
          total += 1;
          if (s === 'DISPATCHED' || s === 'RECEIVED') fulfilled += 1;
          else if (s === 'DRAFT') rejected += 1;
        });
        setTrustScores(prev => ({
          ...prev,
          [sellerId]: {
            fulfilledPct: total > 0 ? Math.round((fulfilled / total) * 100) : null,
            rejectedPct: total > 0 ? Math.round((rejected / total) * 100) : 0,
            total
          }
        }));
      } catch (e) {
        console.warn('Trust score computation failed:', e);
      } finally {
        trustInFlightRef.current.delete(sellerId);
      }
    })();
  }, [selectedWarehouse?.id]);

  // 5. Filtered Offers for the Selected Warehouse Storefront
  const storefrontOffers = useMemo(() => {
    if (!selectedWarehouse) return [];
    const q = storefrontSearchQuery.toLowerCase().trim();

    return selectedWarehouse.offers.filter(offer => {
      const matchesSearch = !q ||
        offer.tradeNameEn.toLowerCase().includes(q) ||
        (offer.tradeNameAr && offer.tradeNameAr.toLowerCase().includes(q)) ||
        (offer.composition && offer.composition.toLowerCase().includes(q)) ||
        (offer.company && offer.company.toLowerCase().includes(q));

      let matchesFilter = true;
      if (storefrontFilter === 'bonus') matchesFilter = !!offer.bonus;
      if (storefrontFilter === 'high_stock') matchesFilter = offer.availableQuantity >= 200;
      if (storefrontFilter === 'clearance') matchesFilter = !!offer.isClearance;

      return matchesSearch && matchesFilter;
    });
  }, [selectedWarehouse, storefrontSearchQuery, storefrontFilter]);

  // 6. Global Medicine Search Across All Warehouses
  const globalSearchResults = useMemo(() => {
    const q = debouncedGlobalSearch.toLowerCase().trim();
    if (!q) return null;

    // Group matching offers by generic/trade name
    const matchingOffers = offers.filter(offer => 
      offer.tradeNameEn.toLowerCase().includes(q) ||
      (offer.tradeNameAr && offer.tradeNameAr.toLowerCase().includes(q)) ||
      (offer.composition && offer.composition.toLowerCase().includes(q)) ||
      (offer.company && offer.company.toLowerCase().includes(q)) ||
      offer.sellerName.toLowerCase().includes(q)
    );

    // Group by canonical medicine or trade name
    const groupedByMed: Record<string, {
      title: string;
      subtitle: string;
      offers: WholesaleOffer[];
    }> = {};

    for (const off of matchingOffers) {
      const key = off.catalogId || off.tradeNameEn.toLowerCase();
      if (!groupedByMed[key]) {
        groupedByMed[key] = {
          title: (lang === 'ar' && off.tradeNameAr) ? off.tradeNameAr : off.tradeNameEn,
          subtitle: off.composition || off.company || '',
          offers: []
        };
      }
      groupedByMed[key].offers.push(off);
    }

    return Object.values(groupedByMed);
  }, [offers, debouncedGlobalSearch, lang]);

  // 250ms input debounce — search semantics unchanged, only recomputation cadence.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedGlobalSearch(globalSearchQuery), 250);
    return () => clearTimeout(timer);
  }, [globalSearchQuery]);

  // 7. Cart State Management with validation and instant user feedback
  const updateCart = (id: string, requestedQty: number) => {
    const offer = offers.find(o => o.id === id || o.offerId === id);
    const prevQty = cart[id] || 0;

    // P0 seller-routing guard: an offer whose seller identity is missing or a
    // known ghost placeholder can never produce a deliverable PO. Block the
    // add here so the buyer never builds an order the seller will never see.
    if (offer && requestedQty > 0 && !isResolvableSellerId(offer.sellerTenantId)) {
      if (triggerToast) {
        triggerToast(
          lang === 'ar'
            ? 'هذا العرض غير متاح حالياً — لا يمكن التحقق من هوية البائع.'
            : 'This offer is currently unavailable — the seller could not be verified.',
          'error'
        );
      }
      return;
    }

    if (requestedQty <= 0) {
      setCart(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (offer && triggerToast) {
        const medName = (lang === 'ar' && offer.tradeNameAr) ? offer.tradeNameAr : offer.tradeNameEn;
        triggerToast(lang === 'ar' ? `تمت إزالة "${medName}" من السلة` : `Removed "${medName}" from cart`, 'info');
      }
      return;
    }

    // Validate stock
    if (offer && requestedQty > offer.availableQuantity) {
      if (triggerToast) {
        triggerToast(
          lang === 'ar'
            ? `الكمية المطلوبة تتجاوز المتوفر بالمستودع (${offer.availableQuantity} عبوة)`
            : `Quantity exceeds available stock (${offer.availableQuantity} units)`,
          'error'
        );
      }
      return;
    }

    setCart(prev => ({
      ...prev,
      [id]: requestedQty
    }));

    // Immediate visual feedback when added
    if (prevQty === 0 && requestedQty > 0 && offer) {
      const medName = (lang === 'ar' && offer.tradeNameAr) ? offer.tradeNameAr : offer.tradeNameEn;
      if (triggerToast) {
        triggerToast(
          lang === 'ar'
            ? `تمت إضافة "${medName}" إلى سلة المشتريات (${requestedQty} عبوة)`
            : `Added "${medName}" to cart (${requestedQty} units)`,
          'success'
        );
      }
    }
  };

  // 8. Cart Items & Calculations
  const cartItems = useMemo(() => {
    return Object.entries(cart).map(([id, qty]) => {
      const offer = offers.find(o => o.id === id || o.offerId === id);
      if (!offer) return null;
      return { offer, qty: qty as number };
    }).filter(Boolean) as { offer: WholesaleOffer; qty: number }[];
  }, [cart, offers]);

  const cartTotalSyp = useMemo(() => {
    return cartItems.reduce((acc, { offer, qty }) => acc + (offer.priceSyp * qty), 0);
  }, [cartItems]);

  const cartItemCount = useMemo(() => {
    return cartItems.reduce((acc, { qty }) => acc + qty, 0);
  }, [cartItems]);

  // 9. Group Cart Items by Warehouse (Seller)
  const cartByWarehouse = useMemo<Record<string, WarehouseCartGroup>>(() => {
    const groups: Record<string, WarehouseCartGroup> = {};

    for (const [offerId, rawQty] of Object.entries(cart)) {
      const qty = Number(rawQty) || 0;
      if (qty <= 0) continue;
      const offer = offers.find(o => o.id === offerId || o.offerId === offerId);
      if (!offer) continue;

      const warehouseKey = offer.sellerTenantId || offer.sellerName || 'Wholesale Partner';
      if (!groups[warehouseKey]) {
        groups[warehouseKey] = {
          sellerTenantId: offer.sellerTenantId,
          sellerName: offer.sellerName || (lang === 'ar' ? 'مستودع أدوية' : 'Wholesale Partner'),
          sellerType: (offer as any).sellerType || ((offer as any).offerKind === 'surplus' ? 'RETAIL_PHARMACY' : 'WHOLESALE_WAREHOUSE'),
          sellerCity: offer.sellerCity,
          items: [],
          subtotalSyp: 0,
          itemCount: 0
        };
      }

      let validationError: string | undefined;
      if (!isResolvableSellerId(offer.sellerTenantId)) {
        // P0 seller routing: legacy/ghost seller identity — ordering blocked
        // up front instead of silently creating an order no seller receives.
        validationError = lang === 'ar'
          ? 'العرض غير متاح — لا يمكن التحقق من البائع'
          : 'Offer unavailable — seller could not be verified';
      } else if (!offer.active) {
        validationError = lang === 'ar' ? 'العرض غير نشط حالياً' : 'Offer is no longer active';
      } else if (offer.availableQuantity < qty) {
        validationError = lang === 'ar' ? `المتوفر فقط ${offer.availableQuantity} عبوة` : `Only ${offer.availableQuantity} units available`;
      } else if (offer.minimumOrderQuantity && qty < offer.minimumOrderQuantity) {
        validationError = lang === 'ar' ? `الحد الأدنى للطلب ${offer.minimumOrderQuantity}` : `MOQ is ${offer.minimumOrderQuantity}`;
      }

      groups[warehouseKey].items.push({ offer, qty, validationError });
      groups[warehouseKey].subtotalSyp += offer.priceSyp * qty;
      groups[warehouseKey].itemCount += qty;
    }

    return groups;
  }, [cart, offers, lang]);

  const warehouseOrderCount = useMemo(() => {
    return Object.keys(cartByWarehouse).length;
  }, [cartByWarehouse]);

  // Check if any cart items have validation errors
  const hasCartValidationErrors = useMemo(() => {
    return (Object.values(cartByWarehouse) as WarehouseCartGroup[]).some(group => 
      group.items.some(item => !!item.validationError)
    );
  }, [cartByWarehouse]);

  // 10. Multi-Warehouse Checkout: Split and Dispatch Purchase Orders
  const handleDispatchOrders = async () => {
    if (cartItems.length === 0 || !currentSession?.pharmacyId || hasCartValidationErrors) return;
    setIsSubmitting(true);

    try {
      const repo = new IndexedDbB2BOrderRepository();
      const createdOrdersSummary: OrderConfirmationSummary[] = [];

      const warehouseGroups = Object.values(cartByWarehouse) as WarehouseCartGroup[];

      // Build pharmacy snapshot information from the REAL organization profile.
      // No fabricated fallbacks: if required contact data is missing, ordering
      // is blocked with a clear "complete your profile" message instead of
      // writing invented business data into Firestore.
      const buyerName = activePharmacy?.name || activePharmacy?.displayName || currentSession.fullName || currentSession.name || 'Pharmacy';
      const buyerNameAr = activePharmacy?.nameAr || undefined;
      const buyerCity = (typeof activePharmacy?.location === 'string' ? activePharmacy.location : activePharmacy?.location?.city) || '';
      const buyerCityAr = activePharmacy?.locationAr || undefined;
      const buyerAddress = activePharmacy?.address || '';
      const buyerAddressAr = activePharmacy?.addressAr || undefined;
      const buyerPhone = activePharmacy?.contactPhone || '';
      const buyerLicense = activePharmacy?.licenseNumber || '';

      // Pilot gate: a warehouse cannot fulfill an order it cannot call about.
      if (!buyerPhone.trim()) {
        triggerToast(
          lang === 'ar'
            ? 'أكمل ملف المؤسسة (رقم الهاتف) من الإعدادات قبل إرسال الطلبات.'
            : 'Complete your organization profile (phone number) in Settings before placing orders.',
          'error'
        );
        setIsSubmitting(false);
        return;
      }

      // Per-group isolation: one warehouse failing must not lose the record
      // of orders that were already created, and must not be reported as a
      // total failure. Succeeded groups are pruned from the cart; failed
      // groups stay in the cart for an explicit retry (fresh stable IDs).
      const failedGroups: string[] = [];
      const succeededOfferIds = new Set<string>();

      for (const group of warehouseGroups) {
        try {
        // P0 seller routing: resolve the REAL seller from the authoritative
        // tenant document before writing anything. A stale/ghost identity on
        // the offer must fail LOUDLY here — never produce a PO the actual
        // seller will never receive.
        const { getDoc: getTenantDoc } = await import('firebase/firestore');
        let authoritativeTenant: AuthoritativeTenant | null = null;
        if (isResolvableSellerId(group.sellerTenantId) && db) {
          const tenantSnap = await getTenantDoc(doc(db, 'tenants', String(group.sellerTenantId)));
          if (tenantSnap.exists()) {
            authoritativeTenant = { ...(tenantSnap.data() as any), id: tenantSnap.id };
          }
        }
        const sellerResolution = resolveOfferSeller(
          { sellerTenantId: group.sellerTenantId, sellerName: group.sellerName, offerKind: (group.items[0]?.offer as any)?.offerKind },
          authoritativeTenant
        );
        if (!sellerResolution.ok) {
          throw new Error(
            lang === 'ar'
              ? `العرض غير متاح حالياً — تعذّر التحقق من هوية البائع (${group.sellerName}). لم يتم إنشاء الطلبية.`
              : `Offer currently unavailable — seller "${group.sellerName}" could not be verified. Order NOT placed.`
          );
        }

        const sellerTenantId = sellerResolution.sellerTenantId;
        const orderId = `PO-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
        const orderTotalValue = group.subtotalSyp;
        const orderTotalQty = group.itemCount;

        const newOrder: B2BOrder = {
          orderId: orderId,
          buyerTenantId: currentSession.pharmacyId,
          buyerName: buyerName,
          ...(buyerNameAr ? { buyerNameAr } : {}),
          buyerCity: buyerCity,
          ...(buyerCityAr ? { buyerCityAr } : {}),
          buyerAddress: buyerAddress,
          ...(buyerAddressAr ? { buyerAddressAr } : {}),
          buyerPhone: buyerPhone,
          buyerLicense: buyerLicense,
          sellerTenantId: sellerTenantId,
          // Live tenant identity is authoritative — replaces stale
          // denormalized names (e.g. pre-rename warehouse names).
          sellerName: sellerResolution.sellerName,
          sellerType: sellerResolution.sellerType,
          ...(sellerResolution.sellerCity ? { sellerCity: sellerResolution.sellerCity } : {}),
          status: 'PENDING_APPROVAL',
          // Canonical 'Cash' | 'Credit' (POS vocabulary) — normalized from
          // the checkout's lowercase paymentType. Historical orders lack
          // this field and are treated as Cash (no receivable).
          paymentMethod: paymentType === 'credit' ? 'Credit' : 'Cash',
          totalValue: orderTotalValue,
          totalQuantity: orderTotalQty,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items: group.items.map(ci => ({
            id: `item-${Math.random().toString(36).substring(2, 9)}`,
            originalCatalogId: ci.offer.catalogId || ci.offer.id,
            name: (lang === 'ar' && ci.offer.tradeNameAr) ? ci.offer.tradeNameAr : ci.offer.tradeNameEn,
            nameEn: ci.offer.tradeNameEn || ci.offer.tradeNameAr || 'Medicine',
            nameAr: ci.offer.tradeNameAr || '',
            requestedQuantity: ci.qty,
            costAtOrder: ci.offer.priceSyp
          }))
        };

        // 1. Direct Firestore write for instant real-time dispatch to warehouse
        if (db) {
          await setDoc(doc(db, "b2b_orders", orderId), newOrder);
        }

        // 2. Save to local IndexedDB repository
        try {
          await repo.saveOrder(newOrder);
        } catch (storageErr) {
          console.warn("IndexedDB order save notice:", storageErr);
        }

        createdOrdersSummary.push({
          orderId,
          warehouseName: sellerResolution.sellerName,
          itemCount: orderTotalQty,
          totalSyp: orderTotalValue,
          status: 'PENDING_APPROVAL'
        });

        // Track exactly which cart entries this successful order consumed.
        group.items.forEach(ci => {
          const offerKey = ci.offer.id || ci.offer.offerId;
          if (offerKey) succeededOfferIds.add(offerKey);
        });
        } catch (groupErr: any) {
          console.error(`Order creation failed for warehouse "${group.sellerName}":`, groupErr);
          failedGroups.push(group.sellerName || group.sellerTenantId || 'unknown-warehouse');
        }
      }

      if (createdOrdersSummary.length === 0) {
        // Nothing was created — full failure, cart untouched for retry.
        triggerToast(
          lang === 'ar'
            ? 'فشل إنشاء جميع الطلبات. لم يتم خصم أي أصناف من السلة.'
            : 'All order submissions failed. Your cart is untouched.',
          'error'
        );
        setIsSubmitting(false);
        return;
      }

      // Prune ONLY the successfully ordered items from the cart.
      setCart(prev => {
        const next: Record<string, number> = {};
        for (const key of Object.keys(prev)) {
          if (!succeededOfferIds.has(key)) next[key] = prev[key];
        }
        return next;
      });
      setIsCartOpen(false);

      const partial = failedGroups.length > 0;
      setShowSuccessModal({
        orderCount: createdOrdersSummary.length,
        orders: createdOrdersSummary
      });

      if (triggerToast) {
        triggerToast(
          partial
            ? (lang === 'ar'
                ? `تم إرسال ${createdOrdersSummary.length} من ${warehouseGroups.length} طلبات. تعذر إرسال طلبات: ${failedGroups.join('، ')} — أعد المحاولة من السلة.`
                : `${createdOrdersSummary.length} of ${warehouseGroups.length} orders placed. Failed warehouses: ${failedGroups.join(', ')} — retry from your cart.`)
            : (lang === 'ar' 
                ? `تم إرسال ${createdOrdersSummary.length} طلبات شراء بنجاح إلى المستودعات!` 
                : `Successfully created and dispatched ${createdOrdersSummary.length} purchase orders!`), 
          partial ? 'info' : 'success'
        );
      }
    } catch (e: any) {
      console.error("Multi-warehouse order dispatch error:", e);
      triggerToast(
        lang === 'ar' ? `فشل إرسال الطلبات: ${e.message || ''}` : `Failed to dispatch orders: ${e.message || ''}`, 
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 11. Receive Order & Ingest to Pharmacy Inventory
  const handleReceiveOrder = async (orderId: string) => {
    try {
      const itemsReceived = await confirmWarehouseOrderReceipt(orderId, currentSession);
      if (itemsReceived > 0) {
        // Notify the supplying warehouse (scoped; warn-only — never blocks receipt).
        try {
          const sellerTenantId = activeOrders.find((o: any) => o.orderId === orderId)?.sellerTenantId;
          const { addDoc: addNotif, collection: notifCol } = await import('firebase/firestore');
          if (db && sellerTenantId) {
            await addNotif(notifCol(db, 'b2b_notifications'), {
              type: 'ORDER_RECEIVED',
              orderId,
              buyerTenantId: currentSession?.pharmacyId,
              sellerTenantId,
              createdAt: new Date().toISOString()
            });
          }
        } catch (notifErr) {
          console.warn('Order received notification skipped:', notifErr);
        }
        triggerToast(
          lang === 'ar' 
            ? `تم استلام الطلبية #${orderId} وتحديث مخزون الصيدلية بـ ${itemsReceived} أصناف بنجاح ✓` 
            : `Inventory updated with ${itemsReceived} items from Order #${orderId} ✓`, 
          "success"
        );
      } else {
        triggerToast(
          lang === 'ar' ? `تم استلام الطلبية #${orderId} مسبقاً` : `Order #${orderId} was already received.`, 
          "info"
        );
      }
    } catch (err: any) {
      console.error("Failed to receive order:", err);
      triggerToast(err.message || "Failed to receive order", "error");
    }
  };

  return (
    <div className="flex flex-col bg-[#F4F7F5] font-sans text-slate-800 min-h-0" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      
      {/* Top Header & View Navigation */}
      <header className="bg-white border-b border-brand-100/80 px-4 py-3.5 shrink-0 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          
          {/* Title & Badge */}
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <div className="w-9 h-9 rounded-xl bg-brand-700 text-white flex items-center justify-center shadow-xs">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight flex items-center gap-2">
                {lang === 'ar' ? 'سوق مستودعات الأدوية B2B' : 'B2B Warehouse Marketplace'}
                <span className="text-[10px] font-mono font-bold bg-brand-50 text-brand-800 border border-brand-200 px-2 py-0.5 rounded-full">
                  {warehouses.length} {lang === 'ar' ? 'مستودع نشط' : 'Active Warehouses'}
                </span>
              </h1>
              <p className="text-[11px] text-slate-500">
                {lang === 'ar' ? 'تصفح مستودعات الأدوية المعتمدة واطلب طلبياتك المباشرة' : 'Browse verified wholesale warehouses and place direct procurement orders'}
              </p>
            </div>
          </div>

          {/* Primary View Switcher & Header Cart Button */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap sm:flex-nowrap">
            <div className="flex items-center p-1 bg-slate-100/90 rounded-xl flex-1 sm:flex-initial border border-slate-200/60">
              <button
                id="btn-nav-market"
                onClick={() => {
                  setActiveTab('marketplace');
                }}
                className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'marketplace' 
                    ? 'bg-white text-brand-800 shadow-xs border border-slate-200/50' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Store className="w-3.5 h-3.5 text-brand-600" />
                <span>{lang === 'ar' ? 'سوق المستودعات' : 'Warehouses'}</span>
              </button>
              <button
                id="btn-nav-tracking"
                onClick={() => setActiveTab('tracking')}
                className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === 'tracking' 
                    ? 'bg-white text-brand-800 shadow-xs border border-slate-200/50' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Truck className="w-3.5 h-3.5 text-brand-600" />
                <span>{lang === 'ar' ? 'تتبع الطلبات' : 'Order Tracking'}</span>
                {activeOrders.length > 0 && (
                  <span className="text-[10px] font-mono font-bold bg-brand-100 text-brand-800 px-1.5 py-0.2 rounded-full">
                    {activeOrders.length}
                  </span>
                )}
              </button>
            </div>

            {/* Dedicated Top-Bar Cart Button */}
            <button
              id="btn-header-cart"
              onClick={() => setIsCartOpen(true)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer border ${
                cartItemCount > 0
                  ? 'bg-brand-700 hover:bg-brand-800 text-white border-brand-600 shadow-md shadow-brand-700/20 active:scale-95'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              <div className="relative flex items-center">
                <ShoppingCart className={`w-3.5 h-3.5 ${cartItemCount > 0 ? 'text-white' : 'text-brand-700'}`} />
                {cartItemCount > 0 && (
                  <span className="absolute -top-2 -right-2.5 bg-amber-400 text-slate-950 font-mono font-black text-[9px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center shadow-xs">
                    {cartItemCount}
                  </span>
                )}
              </div>
              <span className="whitespace-nowrap">
                {lang === 'ar' ? 'سلة المشتريات' : 'Cart'}
              </span>
              {cartItemCount > 0 && (
                <span className="hidden md:inline font-mono font-black text-[11px] bg-white/20 px-2 py-0.5 rounded-md">
                  {cartTotalSyp.toLocaleString()} SYP
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 p-4 sm:p-6 pb-6">
        {/* Single-scroll: content flows in the app shell's main scroller; the bottom dock is in-flow, so no extra clearance is needed. */}
        <div className="max-w-6xl mx-auto space-y-6">

          {/* ========================================================================= */}
          {/* 1. MARKETPLACE TAB                                                        */}
          {/* ========================================================================= */}
          {activeTab === 'marketplace' && (
            <>
              {/* STOREFRONT VIEW FOR A SELECTED WAREHOUSE */}
              {selectedWarehouse ? (
                <WarehouseProfileView
                  warehouse={selectedWarehouse}
                  offers={selectedWarehouse.offers}
                  cart={cart}
                  updateCart={updateCart}
                  onBack={() => {
                    setSelectedWarehouseId(null);
                    setStorefrontSearchQuery('');
                  }}
                  lang={lang}
                  isLoading={isLoadingOffers}
                  viewerLocation={activePharmacy?.location}
                  trust={trustScores[selectedWarehouse.id]}
                />
              ) : (
                /* WAREHOUSES DIRECTORY (LANDING SCREEN) */
                <div className="space-y-6">
                  
                  {/* Global Cross-Marketplace Search Bar */}
                  <div className="bg-white p-4 rounded-lg border border-brand-100 shadow-xs space-y-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-brand-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={globalSearchQuery}
                        onChange={(e) => setGlobalSearchQuery(e.target.value)}
                        placeholder={
                          lang === 'ar'
                            ? 'ابحث عن دواء، مادة فعالة، أو مستودع عبر كامل السوق المركزي...'
                            : 'Search medicine, active ingredient, or warehouse across the entire marketplace...'
                        }
                        className="w-full pl-10 pr-10 py-3 rounded-xl bg-[#F4F7F5] text-slate-900 text-xs font-bold border border-brand-100 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-none transition-all"
                      />
                      {globalSearchQuery && (
                        <button
                          onClick={() => setGlobalSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
                      <span>
                        {lang === 'ar' ? 'اختر مستودعاً لتصفح عروضه، أو ابحث عن دواء لمعرفة المستودعات التي توفره' : 'Select a warehouse to browse its catalog, or search a drug to compare offering warehouses'}
                      </span>
                    </div>
                  </div>

                  {/* If Global Search Active: Show Grouped Medicine Search Results */}
                  {globalSearchQuery && globalSearchResults && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Search className="w-3.5 h-3.5 text-brand-600" />
                          <span>{lang === 'ar' ? 'نتائج البحث الدوائي' : 'Medicine Search Results'}</span>
                          <span className="bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full text-[10px] font-mono">
                            {globalSearchResults.length}
                          </span>
                        </h2>
                      </div>

                      {globalSearchResults.length > 0 ? (
                        <div className="space-y-3">
                          {globalSearchResults.map((group, idx) => (
                            <div key={idx} className="bg-white border border-brand-100 rounded-lg p-4 sm:p-5 shadow-xs space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                <div>
                                  <h3 className="text-base font-bold text-slate-900">{group.title}</h3>
                                  {group.subtitle && (
                                    <p className="text-xs text-slate-500 font-medium">{group.subtitle}</p>
                                  )}
                                </div>
                                <span className="text-xs font-bold text-brand-800 bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-xl self-start sm:self-auto">
                                  {group.offers.length} {lang === 'ar' ? 'بائعون يوفرونه' : 'Sellers Offering'}
                                </span>
                              </div>

                              {/* Warehouse Offers for this Medicine */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                                {group.offers.map(offer => {
                                  const inCartQty = cart[offer.id] || 0;
                                  const minOrder = offer.minimumOrderQuantity || 1;

                                  return (
                                    <div 
                                      key={offer.id}
                                      className="p-3 bg-[#F8FAF9] border border-brand-100/90 rounded-xl flex items-center justify-between gap-3 hover:border-brand-300 transition-all"
                                    >
                                      <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <Building2 className="w-3.5 h-3.5 text-brand-700 shrink-0" />
                                          <button
                                            onClick={() => setSelectedWarehouseId(offer.sellerTenantId)}
                                            className="text-xs font-bold text-slate-800 hover:text-brand-800 underline-offset-2 hover:underline truncate cursor-pointer text-left"
                                          >
                                            {offer.sellerName}
                                          </button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px]">
                                          <span className="font-black text-brand-800 font-mono">
                                            {offer.priceSyp.toLocaleString()} SYP
                                          </span>
                                          <span className="text-slate-400">•</span>
                                          <span className="text-slate-500">
                                            {offer.availableQuantity} {lang === 'ar' ? 'متوفر' : 'units'}
                                          </span>
                                          {offer.bonus && (
                                            <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded text-[10px]">
                                              {offer.bonus}
                                            </span>
                                          )}
                                          {(offer as any).offerKind === 'surplus' && (
                                            <span className="font-bold bg-teal-50 text-teal-800 border border-teal-200 px-1.5 py-0.2 rounded text-[10px]">
                                              {lang === 'ar' ? 'فائض' : 'Surplus'}
                                            </span>
                                          )}
                                          {offer.expiryDate && (() => {
                                            const dte = Math.ceil((new Date(offer.expiryDate).getTime() - Date.now()) / 86400000);
                                            return dte > 0 && dte <= 90 ? (
                                              <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded text-[10px]" title={offer.expiryDate}>
                                                {dte}{lang === 'ar' ? 'ي' : 'd'}
                                              </span>
                                            ) : null;
                                          })()}
                                        </div>
                                      </div>

                                      {/* Quick Add Button */}
                                      <div className="shrink-0">
                                        {inCartQty === 0 ? (
                                          <button
                                            id={`btn-search-add-${offer.id}`}
                                            onClick={() => updateCart(offer.id, minOrder)}
                                            className="px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-2xs"
                                          >
                                            <ShoppingCart className="w-3 h-3" />
                                            <span>{lang === 'ar' ? 'إضافة للسلة' : 'Add to Cart'}</span>
                                          </button>
                                        ) : (
                                          <div className="flex items-center bg-white border border-brand-300 rounded-lg overflow-hidden h-[30px]">
                                            <button
                                              onClick={() => updateCart(offer.id, inCartQty - (inCartQty <= minOrder ? minOrder : 1))}
                                              className="w-7 h-full text-brand-800 font-bold hover:bg-brand-50 cursor-pointer"
                                            >
                                              -
                                            </button>
                                            <span className="px-2 text-xs font-mono font-bold text-brand-950">
                                              {inCartQty}
                                            </span>
                                            <button
                                              onClick={() => updateCart(offer.id, inCartQty + 1)}
                                              className="w-7 h-full text-brand-800 font-bold hover:bg-brand-50 cursor-pointer"
                                            >
                                              +
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-white border border-brand-100 rounded-lg p-10 text-center space-y-2">
                          <p className="text-sm font-bold text-slate-700">
                            {lang === 'ar' ? 'لا توجد أدوية مطابقة معروضة حالياً' : 'No matching medicines are currently offered.'}
                          </p>
                          <p className="text-xs text-slate-400">
                            {lang === 'ar' ? 'جرب البحث بكلمات أخرى أو تصفح المستودعات مباشرة أدناه.' : 'Try a different keyword or explore individual warehouses below.'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Warehouses Grid Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5 text-brand-600" />
                        <span>{lang === 'ar' ? 'البائعون المعتمدون' : 'Verified Sellers'}</span>
                        <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-mono">
                          {warehouses.length}
                        </span>
                      </h2>
                    </div>

                    {isLoadingOffers ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map(n => (
                          <div key={n} className="bg-white rounded-lg p-5 border border-slate-100 shadow-2xs space-y-3 animate-pulse">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 bg-slate-200 rounded-xl"></div>
                              <div className="space-y-1.5 flex-1">
                                <div className="h-4 bg-slate-200 rounded-md w-3/4"></div>
                                <div className="h-3 bg-slate-100 rounded-md w-1/2"></div>
                              </div>
                            </div>
                            <div className="h-10 bg-slate-50 rounded-xl"></div>
                          </div>
                        ))}
                      </div>
                    ) : warehouses.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {warehouses.map(wh => (
                          <div
                            key={wh.id}
                            id={`warehouse-card-${wh.id}`}
                            onClick={() => setSelectedWarehouseId(wh.id)}
                            className="bg-white border border-brand-100/90 hover:border-brand-400 rounded-lg p-5 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between cursor-pointer group relative overflow-hidden"
                          >
                            <div className="space-y-3">
                              {/* Warehouse Header */}
                              <div className="flex items-start gap-3">
                                <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-700 group-hover:bg-brand-700 group-hover:text-white transition-colors shrink-0 shadow-2xs">
                                  <Building2 className="w-6 h-6" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-800 transition-colors truncate">
                                      {wh.name}
                                    </h3>
                                    {wh.sellerType === 'RETAIL_PHARMACY' ? (
                                      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide bg-teal-50 text-teal-800 border border-teal-300 px-2 py-0.5 rounded-md">
                                        {lang === 'ar' ? 'صيدلية — فائض' : 'Pharmacy · Surplus'}
                                      </span>
                                    ) : (
                                      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-300 px-2 py-0.5 rounded-md">
                                        {lang === 'ar' ? 'مستودع جملة' : 'Warehouse'}
                                      </span>
                                    )}
                                  </div>
                                  {wh.city && (
                                    <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                      <MapPin className="w-3 h-3 text-brand-600" />
                                      {wh.city}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Badges / Metrics */}
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                <span className="bg-brand-50 text-brand-800 border border-brand-200 text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                                  <Package className="w-3.5 h-3.5 text-brand-600" />
                                  {wh.totalOffers} {lang === 'ar' ? 'أصناف معروضة' : 'Active Offers'}
                                </span>

                                {wh.bonusOffersCount > 0 && (
                                  <span className="bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                                    <Gift className="w-3.5 h-3.5 text-amber-600" />
                                    {wh.bonusOffersCount} {lang === 'ar' ? 'بونص' : 'Bonus'}
                                  </span>
                                )}

                                {wh.clearanceOffersCount > 0 && (
                                  <span className="bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-2.5 py-1 rounded-lg">
                                    {wh.clearanceOffersCount} {lang === 'ar' ? 'تصفيات' : 'Clearance'}
                                  </span>
                                )}
                              </div>

                              {/* Sample Product Tags */}
                              {wh.sampleMedicines.length > 0 && (
                                <div className="bg-[#F8FAF9] p-2.5 rounded-xl border border-slate-100 space-y-1">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                    {lang === 'ar' ? 'أمثلة من الأصناف المتاحة:' : 'Featured inventory:'}
                                  </span>
                                  <div className="flex flex-wrap gap-1">
                                    {wh.sampleMedicines.map((med, i) => (
                                      <span key={i} className="text-[10px] bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md font-medium">
                                        {med}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* P0 seller routing: legacy/unverified seller identity */}
                              {!isResolvableSellerId(wh.id) && (
                                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 text-[11px] font-bold flex items-center gap-2">
                                  <span>⚠️</span>
                                  <span>
                                    {lang === 'ar'
                                      ? 'عروض هذا البائع غير متاحة حالياً — تعذّر التحقق من حسابه.'
                                      : 'Offers from this seller are currently unavailable — their account could not be verified.'}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Storefront Enter CTA */}
                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-brand-700 group-hover:text-brand-900">
                              <span>{lang === 'ar' ? 'فتح متجر المستودع' : 'Browse Warehouse Offers'}</span>
                              <div className="w-6 h-6 rounded-full bg-brand-50 flex items-center justify-center group-hover:bg-brand-700 group-hover:text-white transition-colors">
                                {lang === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-white border border-brand-100 rounded-lg p-12 text-center space-y-3 shadow-xs">
                        <div className="w-16 h-16 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-700 mx-auto mb-2">
                          <Building2 className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">
                          {lang === 'ar' ? 'لا توجد مستودعات تعرض أدوية حالياً' : 'No warehouses are currently offering products.'}
                        </h3>
                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                          {lang === 'ar'
                            ? 'عندما تنشر المستودعات عروضها التجارية، ستظهر هنا فوراً في دليل المستودعات.'
                            : 'When partner warehouses publish active wholesale offers, they will appear here in the warehouse registry.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* 2. ORDER TRACKING TAB                                                     */}
          {/* ========================================================================= */}
          {activeTab === 'tracking' && (
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {lang === 'ar' ? 'تتبع طلبيات الشراء B2B' : 'B2B Purchase Orders'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {lang === 'ar' ? 'متابعة وتأكيد استلام الطلبيات الصادرة إلى المستودعات' : 'Track and confirm receipt of purchase orders sent to wholesale warehouses'}
                  </p>
                </div>
                <span className="text-xs font-mono font-bold bg-brand-100 text-brand-800 px-3 py-1 rounded-xl">
                  {filteredActiveOrders.length}{filteredActiveOrders.length !== activeOrders.length ? ` / ${activeOrders.length}` : ''} {lang === 'ar' ? 'طلبية' : 'Orders'}
                </span>
              </div>

              {/* Status filters — Active vs History separation */}
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'ALL', ar: 'الكل', en: 'All' },
                  { key: 'PENDING_APPROVAL', ar: 'قيد المعالجة', en: 'Pending' },
                  { key: 'DISPATCHED', ar: 'تم الشحن', en: 'Dispatched' },
                  { key: 'RECEIVED', ar: 'مستلمة', en: 'Received' },
                  { key: 'DRAFT', ar: 'مرفوضة', en: 'Rejected' }
                ] as const).map(f => {
                  const count = f.key === 'ALL' ? activeOrders.length : activeOrders.filter((o: any) => o.status === f.key).length;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setOrderStatusFilter(f.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                        orderStatusFilter === f.key
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {lang === 'ar' ? f.ar : f.en}
                      <span className={`ms-1.5 font-mono text-[10px] ${orderStatusFilter === f.key ? 'text-white/70' : 'text-slate-400'}`}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {isLoadingOrders ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-7 h-7 text-brand-600 animate-spin" />
                  <p className="text-xs font-bold text-slate-500">
                    {lang === 'ar' ? 'جارٍ تحميل طلبيات الشراء...' : 'Loading purchase orders...'}
                  </p>
                </div>
              ) : filteredActiveOrders.length > 0 ? (
                <div className="space-y-4">
                  {filteredActiveOrders.map(order => {
                    const isTerminal = order.status === 'DRAFT' || order.status === 'RECEIVED';
                    const isExpanded = !isTerminal || expandedOrderId === order.orderId;
                    return (
                    <div key={order.orderId} className={`bg-white rounded-lg border shadow-xs overflow-hidden transition-colors ${order.status === 'PENDING_APPROVAL' ? 'border-amber-200/70' : order.status === 'DISPATCHED' ? 'border-purple-200/70' : 'border-brand-100 opacity-90 hover:opacity-100'}`}>
                      <div className="p-4 border-b border-brand-50 flex justify-between items-center bg-slate-50/70">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-brand-800 bg-brand-100 px-2.5 py-1 rounded-lg font-mono">
                            {order.orderId}
                          </span>
                          {(() => {
                            const st = order.sellerType
                              || offers.find(o => o.sellerTenantId === order.sellerTenantId)?.sellerType
                              || 'WHOLESALE_WAREHOUSE';
                            return st === 'RETAIL_PHARMACY' ? (
                              <span className="text-[10px] font-black uppercase tracking-wide bg-teal-50 text-teal-800 border border-teal-300 px-2 py-0.5 rounded-md">
                                {lang === 'ar' ? 'صيدلية — فائض' : 'Pharmacy · Surplus'}
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-300 px-2 py-0.5 rounded-md">
                                {lang === 'ar' ? 'مستودع جملة' : 'Warehouse'}
                              </span>
                            );
                          })()}
                          <span className="text-[11px] text-slate-400 font-medium">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div>
                          {order.status === 'DRAFT' && (
                            <StatusBadge status="DRAFT" lang={lang} />
                          )}
                          {order.status === 'PENDING_APPROVAL' && (
                            <StatusBadge status="PENDING_APPROVAL" lang={lang} />
                          )}
                          {order.status === 'DISPATCHED' && (
                            <span className="animate-pulse inline-flex">
                              <StatusBadge status="DISPATCHED" lang={lang} />
                            </span>
                          )}
                          {order.status === 'RECEIVED' && (
                            <StatusBadge status="RECEIVED" lang={lang} />
                          )}
                        </div>
                        <button
                          id={`btn-print-order-${order.orderId}`}
                          onClick={(e) => { e.stopPropagation(); handlePrintOrderReceipt(order.orderId); }}
                          title={lang === 'ar' ? 'طباعة إيصال الطلبية' : 'Print order receipt'}
                          className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-brand-700 hover:border-brand-300 transition-colors cursor-pointer shrink-0 print:hidden"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Rejection / counter-offer communication */}
                      {order.status === 'DRAFT' && !declinedCounters.includes(order.orderId) && (() => {
                        const raw = String(order.rejectionReason || '');
                        const m = raw.match(/^COUNTER-OFFER:\s*(\d+)\s*units?\s+available/i);
                        const counterQty = m ? parseInt(m[1], 10) : null;
                        const note = m ? raw.replace(/^COUNTER-OFFER:.*?(?=(Note|—|-|$))/i, '').trim() : raw;
                        const firstItem = (order.items || [])[0];
                        return (
                          <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50/60 overflow-hidden">
                            <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-rose-100">
                              <span className="text-[10px] font-black uppercase tracking-wide text-rose-800">
                                {counterQty !== null
                                  ? (lang === 'ar' ? `عرض بديل: ${counterQty} وحدة متوفرة فقط` : `Counter offer: only ${counterQty} units available`)
                                  : (lang === 'ar' ? 'سبب الرفض' : 'Rejection reason')}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                {order.updatedAt ? new Date(order.updatedAt).toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <div className="px-3 py-2 text-xs text-slate-700 space-y-1">
                              <p><span className="font-bold">{lang === 'ar' ? 'المستودع:' : 'Warehouse:'}</span> {order.sellerName || order.sellerTenantId}</p>
                              <p>{note || (lang === 'ar' ? 'لا يوجد سبب مذكور.' : 'No reason provided.')}</p>
                              {firstItem && (
                                <p className="text-[11px]"><span className="font-semibold">{lang === 'ar' ? 'الصنف:' : 'Item:'}</span> {firstItem.name} · {lang === 'ar' ? 'المطلوب' : 'requested'} {firstItem.requestedQuantity}</p>
                              )}
                            </div>
                            <div className="px-3 pb-2 flex items-center gap-2">
                              {counterQty !== null && firstItem && (
                                <button
                                  id={`btn-accept-counter-${order.orderId}`}
                                  onClick={() => {
                                    const off = offers.find(o =>
                                      (o.catalogId || o.id) === firstItem.originalCatalogId &&
                                      o.sellerTenantId === order.sellerTenantId);
                                    if (!off) {
                                      triggerToast(lang === 'ar' ? 'لم يتم العثور على العرض في السوق.' : 'Original listing not found in marketplace.', 'error');
                                      return;
                                    }
                                    updateCart(off.id || off.offerId, counterQty || firstItem.requestedQuantity);
                                    setIsCartOpen(true);
                                    setDeclinedCounters(prev => [...prev, order.orderId]);
                                  }}
                                  className="flex-1 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg font-bold text-[11px] transition-colors cursor-pointer"
                                >
                                  {lang === 'ar' ? `قبول ${counterQty} وحدة وإضافة للسلة` : `Accept ${counterQty} units → cart`}
                                </button>
                              )}
                              <button
                                onClick={() => setDeclinedCounters(prev => [...prev, order.orderId])}
                                className="flex-1 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg font-bold text-[11px] cursor-pointer"
                              >
                                {lang === 'ar' ? 'حفظ وإغلاق' : 'Dismiss'}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="p-4 space-y-3">
                        {isExpanded ? (
                          <>
                        <div className="space-y-2">
                          {order.items?.map((item: any) => (
                            <div key={item.id} className="flex justify-between items-center text-xs">
                              <span className="font-bold text-slate-800">{item.name}</span>
                              <span className="text-slate-500 font-mono">
                                {item.requestedQuantity}x <span className="font-bold text-brand-800 font-mono">{(item.costAtOrder || 0).toLocaleString()} SYP</span>
                              </span>
                            </div>
                          ))}
                        </div>
                          </>
                        ) : (
                          <button
                            onClick={() => setExpandedOrderId(order.orderId)}
                            className="w-full text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 py-1 transition-colors cursor-pointer"
                          >
                            {lang === 'ar' ? 'عرض تفاصيل الأصناف' : 'Show item details'} ({order.items?.length || 0})
                          </button>
                        )}

                        <div className="pt-3 border-t border-brand-50 flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            {lang === 'ar' ? 'إجمالي قيمة الطلبية' : 'Total Order Value'}
                          </span>
                          <span className="font-black text-brand-900 font-mono text-base">
                            {(order.items?.reduce((sum: number, item: any) => sum + (item.requestedQuantity * (item.costAtOrder || 0)), 0) || 0).toLocaleString()} SYP
                          </span>
                        </div>

                        {order.status === 'DISPATCHED' && (() => {
                          const eta = order.manifest?.expectedDeliveryAt ? new Date(order.manifest.expectedDeliveryAt) : null;
                          const etaEnd = order.manifest?.deliveryWindowEnd ? new Date(order.manifest.deliveryWindowEnd) : null;
                          const isLate = eta ? Date.now() > (etaEnd ?? eta).getTime() + 3600000 : false;
                          const fmt = (d: Date) => d.toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                          return (
                            <div className="mx-4 mt-3 rounded-xl border border-brand-200 bg-brand-50/50 overflow-hidden">
                              {/* Incoming delivery header */}
                              <div className="px-4 py-2.5 bg-brand-100/60 border-b border-brand-200 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-brand-900 flex items-center gap-1.5">
                                  <Truck className="w-3.5 h-3.5" />
                                  {lang === 'ar' ? 'شحنة واردة' : 'Incoming Delivery'}
                                </span>
                                {isLate && (
                                  <Badge variant="error">{lang === 'ar' ? 'متأخر' : 'Late'}</Badge>
                                )}
                              </div>

                              {/* Arrival window */}
                              <div className="px-4 pt-2.5 text-xs">
                                <p className={`font-bold flex items-center gap-1.5 ${isLate ? 'text-rose-700' : 'text-slate-800'}`}>
                                  <Calendar className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                                  {lang === 'ar' ? 'موعد التسليم المتوقع:' : 'Expected arrival:'}
                                </p>
                                <p className="font-mono text-[11px] text-slate-600 mt-0.5">
                                  {eta ? fmt(eta) : '—'}{etaEnd ? ` – ${fmt(etaEnd).split(', ').slice(1).join(', ')}` : ''}
                                </p>
                                {isLate && (
                                  <p className="text-[10px] text-rose-600 font-semibold mt-0.5">
                                    {lang === 'ar' ? 'تجاوزت هذه الشحنة موعدها المتوقع.' : 'This shipment is past its promised window.'}
                                  </p>
                                )}
                              </div>

                              {/* Dispatch token */}
                              {order.manifest?.dispatchToken && (
                                <p className="px-4 pt-1.5 text-[10px] font-mono text-slate-400">
                                  {lang === 'ar' ? 'رمز الشحن:' : 'Dispatch token:'}{' '}
                                  <span className="font-bold">{order.manifest.dispatchToken}</span>
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        {order.status === 'DISPATCHED' && (
                          <div className="pt-1 pb-3 px-4">
                            {pendingNotDeliveredId === order.orderId ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setPendingNotDeliveredId(null)}
                                  className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
                                >
                                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                                </button>
                                <button
                                  id={`btn-confirm-not-delivered-${order.orderId}`}
                                  onClick={async () => {
                                    setPendingNotDeliveredId(null);
                                    try {
                                      if (!db) throw new Error('offline');
                                      await updateDoc(doc(db, 'b2b_orders', order.orderId), {
                                        status: 'PENDING_APPROVAL',
                                        updatedAt: new Date().toISOString(),
                                        deliveryFailedAt: new Date().toISOString()
                                      });
                                      try {
                                        const sellerTenantId = order.sellerTenantId;
                                        const { addDoc: addN, collection: colN } = await import('firebase/firestore');
                                        if (db && sellerTenantId) {
                                          await addN(colN(db, 'b2b_notifications'), {
                                            type: 'ORDER_NOT_RECEIVED',
                                            orderId: order.orderId,
                                            buyerTenantId: currentSession?.pharmacyId,
                                            sellerTenantId,
                                            reason: lang === 'ar' ? 'الشحنة لم تصل إلى الصيدلية' : 'Package was not delivered to the pharmacy',
                                            createdAt: new Date().toISOString()
                                          });
                                        }
                                      } catch (nErr) { console.warn('notification skipped:', nErr); }
                                      triggerToast(
                                        lang === 'ar'
                                          ? `أُعيدت الطلبية #${order.orderId} إلى المستودع للمعالجة`
                                          : `Order #${order.orderId} returned to the warehouse for re-handling`,
                                        'info'
                                      );
                                    } catch (e: any) {
                                      triggerToast(
                                        lang === 'ar' ? 'فشل الإبلاغ: ' + (e?.message || '') : 'Failed to report: ' + (e?.message || ''),
                                        'error'
                                      );
                                    }
                                  }}
                                  className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl font-bold text-xs cursor-pointer"
                                >
                                  {lang === 'ar' ? 'تأكيد: لم تصل الشحنة' : 'Confirm: never arrived'}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPendingNotDeliveredId(order.orderId)}
                                className="w-full text-center text-[11px] font-semibold text-slate-400 hover:text-rose-600 py-1 transition-colors cursor-pointer"
                              >
                                {lang === 'ar' ? 'لم تصل الشحنة؟ أبلغ المستودع' : 'Package never arrived? Report it'}
                              </button>
                            )}
                          </div>
                        )}

                        {order.status === 'DISPATCHED' && (
                          <div className="px-4 pb-4">
                            <button
                              id={`btn-receive-order-${order.orderId}`}
                              onClick={() => handleReceiveOrder(order.orderId)}
                              className="w-full flex items-center justify-center gap-2 py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
                            >
                              <Package className="w-4 h-4" />
                              {lang === 'ar' ? 'تأكيد استلام الطلبية وتحديث المخزون' : 'Confirm Delivery & Update Inventory'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-16 text-center text-slate-500 bg-white rounded-lg border border-brand-100 shadow-sm space-y-2">
                  <FileText className="w-12 h-12 mx-auto text-brand-200" />
                  <p className="text-sm font-bold text-slate-800">
                    {orderStatusFilter === 'ALL'
                      ? (lang === 'ar' ? 'لا توجد طلبات شراء مسجلة حالياً.' : 'No active purchase orders recorded.')
                      : (lang === 'ar' ? 'لا توجد طلبات بهذه الحالة.' : 'No orders with this status.')}
                  </p>
                  <p className="text-xs text-slate-400">
                    {lang === 'ar' ? 'تصفح سوق المستودعات لإرسال طلبيات الشراء.' : 'Browse the warehouse marketplace to send purchase orders to wholesale partners.'}
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      {/* Printable order receipt (pharmacy copy) — print-only document */}
      {printTarget && (
        <div id="printable-order-receipt" className="hidden print:block fixed left-0 top-0 w-full bg-white text-black p-6 font-sans" dir="ltr">
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '8px', marginBottom: '12px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em' }}>Eshmun Pharmacy</h1>
              <p style={{ fontSize: '11px', color: '#475569' }}>
                {printTarget.buyerName || currentSession?.fullName || 'Pharmacy'}
                {currentSession?.pharmacyId ? ` · ${currentSession.pharmacyId}` : ''}
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '10px' }}>
              <div>
                <p><strong>Order ref:</strong> #{printTarget.orderId}</p>
                <p><strong>Supplier:</strong> {printTarget.sellerName || printTarget.sellerTenantId}</p>
                <p><strong>Date:</strong> {new Date(printTarget.createdAt).toLocaleString('en-GB')}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p><strong>Status:</strong> {statusLabel(printTarget.status)}</p>
                {printTarget.manifest?.expectedDeliveryAt && (
                  <p><strong>Expected delivery:</strong> {new Date(printTarget.manifest.expectedDeliveryAt).toLocaleString('en-GB')}</p>
                )}
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #0f172a', textAlign: 'left' }}>
                  <th style={{ padding: '6px 4px' }}>Item</th>
                  <th style={{ padding: '6px 4px', textAlign: 'center' }}>Qty</th>
                  <th style={{ padding: '6px 4px', textAlign: 'center' }}>Unit</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(printTarget.items || []).map((it: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 4px' }}>{it.name}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>{it.requestedQuantity}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'center' }}>{(Number(it.costAtOrder) || 0).toLocaleString()} SYP</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right' }}>{((Number(it.requestedQuantity) || 0) * (Number(it.costAtOrder) || 0)).toLocaleString()} SYP</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '13px', fontWeight: 800, borderTop: '1.5px solid #0f172a', paddingTop: '8px' }}>
              <span>Total ({statusLabel(printTarget.status)})</span>
              <span>{(Number(printTarget.totalValue) || (printTarget.items || []).reduce((s: number, it: any) => s + (Number(it.requestedQuantity) || 0) * (Number(it.costAtOrder) || 0), 0)).toLocaleString()} SYP</span>
            </div>

            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#475569' }}>
              <span>Received by: ______________________</span>
              <span>Printed: {new Date().toLocaleString('en-GB')}</span>
            </div>
          </div>
        </div>
      )}
      </main>

      {/* ========================================================================= */}
      {/* 3. FLOATING MULTI-WAREHOUSE CART SUMMARY BAR                              */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {cartItemCount > 0 && activeTab === 'marketplace' && !isCartOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
              className="fixed z-[60] left-4 right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] md:left-auto md:w-96 mx-auto"
          >
            <button
              id="btn-open-cart-drawer"
              onClick={() => setIsCartOpen(true)}
              className="w-full bg-brand-800 hover:bg-brand-900 text-white rounded-lg p-4 shadow-xl flex items-center justify-between cursor-pointer border border-brand-700 active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="absolute -top-2 -right-2 bg-amber-500 text-brand-950 text-[10px] font-black px-1.5 rounded-full shadow-2xs">
                    {cartItemCount}
                  </span>
                </div>
                <div className="text-left leading-tight">
                  <span className="block text-[10px] text-brand-300 font-bold uppercase tracking-wider">
                    {lang === 'ar' 
                      ? `${warehouseOrderCount} طلبيات مستودعات` 
                      : `${warehouseOrderCount} Warehouse Order${warehouseOrderCount > 1 ? 's' : ''}`}
                  </span>
                  <span className="block font-black text-sm font-mono text-white">
                    {cartTotalSyp.toLocaleString()} SYP
                  </span>
                </div>
              </div>
              <div className="text-xs font-bold bg-white/20 hover:bg-white/30 px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 text-white transition-colors">
                <span>{lang === 'ar' ? 'مراجعة وتأكيد الطلبيات' : 'Review & Place Orders'}</span>
                {lang === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 4. MULTI-WAREHOUSE CHECKOUT DRAWER / MODAL                                */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isCartOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => setIsCartOpen(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-[#F4F7F5] rounded-xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden my-auto border border-brand-100"
            >
              {/* Cart Drawer Header */}
              <div className="p-5 border-b border-brand-100 bg-white flex justify-between items-center sticky top-0 z-10">
                <div>
                  <h2 className="text-lg font-black text-slate-900">
                    {lang === 'ar' ? 'مراجعة طلبات الشراء للمستودعات' : 'Multi-Warehouse Order Review'}
                  </h2>
                  <p className="text-xs font-bold text-brand-700">
                    {lang === 'ar'
                      ? `سيتم إنشاء ${warehouseOrderCount} طلبيات شراء منفصلة (${cartItemCount} عبوة)`
                      : `Will create ${warehouseOrderCount} separate POs for each warehouse (${cartItemCount} units)`}
                  </p>
                </div>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Grouped Cart Items List */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {(Object.values(cartByWarehouse) as WarehouseCartGroup[]).map(group => (
                  <div key={group.sellerTenantId} className="bg-white border border-brand-100 rounded-lg overflow-hidden shadow-xs">
                    
                    {/* Warehouse Group Header */}
                    <div className="bg-brand-50/80 px-4 py-3 border-b border-brand-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-brand-700" />
                        <span className="font-bold text-xs text-brand-950">{group.sellerName}</span>
                        {group.sellerCity && (
                          <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                            {group.sellerCity}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-mono font-bold text-brand-900">
                        {group.subtotalSyp.toLocaleString()} SYP
                      </span>
                    </div>

                    {/* Items within this Warehouse */}
                    <div className="p-4 space-y-3 divide-y divide-slate-100">
                      {group.items.map(({ offer, qty, validationError }) => {
                        let bonusText = '';
                        if (offer.bonus) {
                          const match = offer.bonus.match(/(\d+)\s*\+\s*(\d+)/);
                          if (match) {
                            const base = parseInt(match[1]);
                            const free = parseInt(match[2]);
                            const earned = Math.floor(qty / base) * free;
                            if (earned > 0) bonusText = `+ ${earned} Bonus Units`;
                          }
                        }

                        return (
                          <div key={offer.id} className="pt-3 first:pt-0 space-y-1.5">
                            <div className="flex justify-between items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-bold text-xs text-slate-900 truncate">
                                  {(lang === 'ar' && offer.tradeNameAr) ? offer.tradeNameAr : offer.tradeNameEn}
                                </h4>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                  <span>{qty}x <span className="font-mono text-brand-800 font-bold">{offer.priceSyp.toLocaleString()} SYP</span></span>
                                  {bonusText && (
                                    <span className="text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded text-[10px]">
                                      {bonusText}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <span className="font-black text-brand-900 font-mono text-xs whitespace-nowrap">
                                {(qty * offer.priceSyp).toLocaleString()} SYP
                              </span>
                            </div>

                            {/* Validation warning if item invalid */}
                            {validationError && (
                              <div className="bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>{validationError}</span>
                              </div>
                            )}

                            {/* In-Cart Stepper & Remove */}
                            <div className="flex items-center justify-between pt-1">
                              <button
                                onClick={() => updateCart(offer.id, 0)}
                                className="text-[10px] text-rose-600 hover:text-rose-800 font-bold underline cursor-pointer"
                              >
                                {lang === 'ar' ? 'إزالة' : 'Remove'}
                              </button>

                              <div className="flex items-center bg-slate-100 rounded-lg overflow-hidden border border-slate-200 h-6">
                                <button
                                  onClick={() => updateCart(offer.id, qty - 1)}
                                  className="px-2 text-slate-600 hover:bg-slate-200 font-bold cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="px-2 text-xs font-mono font-bold text-slate-800 bg-white h-full flex items-center">
                                  {qty}
                                </span>
                                <button
                                  onClick={() => updateCart(offer.id, qty + 1)}
                                  className="px-2 text-slate-600 hover:bg-slate-200 font-bold cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Payment Terms Selector */}
                <div className="bg-white border border-brand-100 rounded-lg p-4 space-y-3 shadow-xs">
                  <h3 className="font-bold text-xs text-slate-800">
                    {lang === 'ar' ? 'طريقة السداد المعتمدة' : 'Payment Terms'}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentType('cash')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentType === 'cash' 
                          ? 'bg-brand-50 border-brand-500 text-brand-900 shadow-xs' 
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      {lang === 'ar' ? 'نقداً عند التسليم' : 'Cash on Delivery'}
                    </button>
                    <button
                      onClick={() => setPaymentType('credit')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        paymentType === 'credit' 
                          ? 'bg-brand-50 border-brand-500 text-brand-900 shadow-xs' 
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {lang === 'ar' ? 'آجل / ذمة مستودع' : 'Deferred / Ledger'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Checkout Submission Action Bar */}
              <div className="p-4 bg-white border-t border-brand-100 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] sticky bottom-0">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <span className="font-bold text-slate-500 text-xs block">
                      {lang === 'ar' ? 'إجمالي الطلبيات:' : 'Total Procurement Value:'}
                    </span>
                    <span className="text-[11px] text-brand-700 font-bold">
                      {warehouseOrderCount} {lang === 'ar' ? 'طلبيات شراء مستقلة' : 'distinct warehouse orders'}
                    </span>
                  </div>
                  <span className="font-black text-xl text-brand-950 font-mono">
                    {cartTotalSyp.toLocaleString()} <span className="text-xs text-brand-700">SYP</span>
                  </span>
                </div>

                <button
                  id="btn-place-orders"
                  onClick={handleDispatchOrders}
                  disabled={isSubmitting || hasCartValidationErrors}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer disabled:opacity-60 active:scale-95"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Truck className="w-4 h-4" />
                      <span>
                        {lang === 'ar' 
                          ? `إرسال ${warehouseOrderCount} طلبات الشراء إلى المستودعات` 
                          : `Place ${warehouseOrderCount} Warehouse Order${warehouseOrderCount > 1 ? 's' : ''}`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 5. SUCCESS CONFIRMATION MODAL                                             */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showSuccessModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-xl p-6 w-full max-w-lg text-center shadow-xl border border-brand-100 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="w-14 h-14 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  {lang === 'ar' ? 'تم إرسال الطلب بنجاح' : 'Order Sent Successfully'}
                </h2>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  {lang === 'ar'
                    ? `تم اعتماد وإرسال ${showSuccessModal.orderCount} طلبات شراء إلى المستودعات:`
                    : `Dispatched ${showSuccessModal.orderCount} separate purchase orders to warehouses:`}
                </p>
              </div>

              {/* List of Created Orders with item count, total, and status */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-3 text-left">
                {showSuccessModal.orders.map((ord) => (
                  <div key={ord.orderId} className="bg-white rounded-xl p-3 border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-brand-700" />
                        <span className="font-bold text-xs text-slate-900">{ord.warehouseName}</span>
                      </div>
                      <span className="font-mono text-xs font-bold text-brand-800 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                        {ord.orderId}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-[11px]">
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          {lang === 'ar' ? 'عدد المواد:' : 'Item Count:'}
                        </span>
                        <span className="font-bold text-slate-700 font-mono">{ord.itemCount}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          {lang === 'ar' ? 'الإجمالي:' : 'Total:'}
                        </span>
                        <span className="font-bold text-brand-900 font-mono">{ord.totalSyp.toLocaleString()} SYP</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">
                          {lang === 'ar' ? 'الحالة:' : 'Status:'}
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                          <Clock className="w-3 h-3" />
                          {lang === 'ar' ? 'قيد الموافقة' : 'PENDING_APPROVAL'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  id="btn-confirm-success-tracking"
                  onClick={() => {
                    setShowSuccessModal(null);
                    setActiveTab('tracking');
                  }}
                  className="w-full py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-sm"
                >
                  {lang === 'ar' ? 'متابعة الطلبيات في التتبع' : 'Track Orders in Purchase Tracking'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
