import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { 
  Tag, 
  Plus, 
  Search, 
  EyeOff, 
  CheckCircle, 
  Package, 
  Loader2, 
  Trash2, 
  Edit, 
  Gift, 
  Check, 
  Layers, 
  AlertCircle,
  Building2,
  Calendar,
  Sparkles,
  RefreshCw,
  Copy,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCatalog } from '../../context/CatalogContext';
import { useAuth } from '../../application/auth/AuthContext';
import { db } from '../../infrastructure/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  setDoc, 
  addDoc,
  updateDoc, 
  deleteDoc, 
  doc 
} from 'firebase/firestore';
import { Medicine } from '../../types';
import { WholesaleOffer } from '../../domain/b2b';

const FIRESTORE_RULES_SNIPPET = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /wholesale_offers/{offerId} {
      allow read, write: if request.auth != null;
    }
    match /b2b_orders/{orderId} {
      allow read, write: if request.auth != null;
    }
    match /tenants/{tenantId} {
      allow read, write: if request.auth != null;
      match /{document=**} {
        allow read, write: if request.auth != null;
      }
    }
    match /catalog/{drugId} {
      allow read, write: if true;
    }
    match /pharmacies/{pharmacyId} {
      allow read, write: if request.auth != null;
      match /{document=**} {
        allow read, write: if request.auth != null;
      }
    }
  }
}`;

const LOCAL_STORAGE_KEY_PREFIX = 'saidalete_warehouse_offers_';

const getCachedOffers = (pharmacyId: string): WholesaleOffer[] => {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pharmacyId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

const saveCachedOffers = (pharmacyId: string, offers: WholesaleOffer[]) => {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${pharmacyId}`, JSON.stringify(offers));
  } catch (e) {
    console.warn("Failed to cache offers to localStorage:", e);
  }
};

interface WarehouseOffersTabProps {
  medicines?: Medicine[];
  lang?: 'en' | 'ar';
  triggerToast?: (msg: string, type: 'success' | 'info' | 'error') => void;
}

interface DraftOfferForm {
  catalogId: string;
  tradeNameEn: string;
  tradeNameAr?: string;
  composition?: string;
  company?: string;
  priceSyp: number;
  availableQuantity: number;
  minimumOrderQuantity: number;
  bonus: string;
  isClearance: boolean;
  expiryDate: string;
}

export default function WarehouseOffersTab({ medicines = [], lang = 'en', triggerToast }: WarehouseOffersTabProps) {
  const { currentSession, activePharmacy } = useAuth();
  const { mappedCatalog } = useCatalog();
  
  const [offers, setOffers] = useState<WholesaleOffer[]>(() => {
    return currentSession?.pharmacyId ? getCachedOffers(currentSession.pharmacyId) : [];
  });
  // Cosmetic profile values must not resubscribe the offers listener.
  const activePharmacyRef = React.useRef(activePharmacy);
  useEffect(() => { activePharmacyRef.current = activePharmacy; }, [activePharmacy]);
  const [isLoadingOffers, setIsLoadingOffers] = useState(true);
  const [firestoreRulesNotice, setFirestoreRulesNotice] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'hidden' | 'clearance'>('all');

  // Modals & Forms
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<WholesaleOffer | null>(null);

  // Deactivation Flow
  const [offerToDeactivate, setOfferToDeactivate] = useState<WholesaleOffer | null>(null);
  const [deactivateReason, setDeactivateReason] = useState<string>('Out of stock');
  const [customDeactivateReason, setCustomDeactivateReason] = useState<string>('');
  const [isDeactivating, setIsDeactivating] = useState(false);

  // Selection & Bulk Publishing
  const [inventorySearch, setInventorySearch] = useState('');
  const [selectedMedIds, setSelectedMedIds] = useState<string[]>([]);
  const [draftForms, setDraftForms] = useState<Record<string, DraftOfferForm>>({});
  const [bulkPricingRatio, setBulkPricingRatio] = useState<number>(100); // % of standard price
  const [bulkMoq, setBulkMoq] = useState<number>(10);
  const [bulkBonus, setBulkBonus] = useState<string>('');

  // Publishing State Animation: 'idle' | 'publishing' | 'published' | 'error'
  const [publishStatus, setPublishStatus] = useState<'idle' | 'publishing' | 'published' | 'error'>('idle');
  const [publishingCount, setPublishingCount] = useState<number>(0);

  // Subscribe to warehouse's wholesale offers in Firestore
  useEffect(() => {
    if (!currentSession?.pharmacyId) {
      setIsLoadingOffers(false);
      return;
    }

    // Load initial cached items immediately
    const cached = getCachedOffers(currentSession.pharmacyId);
    if (cached.length > 0) {
      setOffers(cached);
    }

    if (!db) {
      setIsLoadingOffers(false);
      return;
    }

    setIsLoadingOffers(true);
    const offersRef = collection(db, 'wholesale_offers');
    const q = query(offersRef, where('sellerTenantId', '==', currentSession.pharmacyId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: WholesaleOffer[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        loaded.push({
          id: docSnap.id,
          offerId: data.offerId || docSnap.id,
          sellerTenantId: data.sellerTenantId,
      sellerName: data.sellerName || activePharmacyRef.current?.name || 'Warehouse',
      sellerCity: data.sellerCity || (typeof activePharmacyRef.current?.location === 'string' ? activePharmacyRef.current.location : activePharmacyRef.current?.location?.city) || 'Damascus',
          catalogId: data.catalogId || docSnap.id,
          tradeNameEn: data.tradeNameEn || data.medName || 'Medicine',
          tradeNameAr: data.tradeNameAr || '',
          composition: data.composition || data.genericName || '',
          company: data.company || data.manufacturer || '',
          manufacturer: data.manufacturer || data.company || '',
          priceSyp: data.priceSyp || data.price || 0,
          price: data.priceSyp || data.price || 0,
          availableQuantity: Math.max(0, Number(data.availableQuantity ?? data.stock ?? 0)),
          stock: Math.max(0, Number(data.availableQuantity ?? data.stock ?? 0)),
          minimumOrderQuantity: data.minimumOrderQuantity || data.moq || 10,
          moq: data.minimumOrderQuantity || data.moq || 10,
          bonus: data.bonus || '',
          isClearance: !!data.isClearance,
          expiryDate: data.expiryDate || new Date().toISOString().split('T')[0],
          active: data.active !== false,
          reliability: data.reliability || 5.0,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        });
      });

      // Sort by recently updated
      loaded.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setOffers(loaded);
      saveCachedOffers(currentSession.pharmacyId, loaded);
      setIsLoadingOffers(false);
      setFirestoreRulesNotice(false);
    }, (error: any) => {
      console.warn("Wholesale offers Firestore listener status:", error.message || error);
      setIsLoadingOffers(false);
      
      // If permission-denied or rule evaluation error, fallback smoothly to cached offers
      if (error?.code === 'permission-denied' || error?.message?.includes('permission')) {
        setFirestoreRulesNotice(true);
      }
    });

    return () => unsubscribe();
  }, [currentSession?.pharmacyId]);

  // Inventory source for publishing: warehouse inventory or catalog fallback
  const selectableInventory = useMemo(() => {
    // If warehouse has inventory items in state, use them; also allow searching full catalog
    const invMap = new Map<string, { id: string; name: string; genericName: string; price: number; stock: number; expiryDate: string; company?: string; barcode?: string }>();
    
    // Add existing warehouse inventory
    medicines.forEach(med => {
      const canonicalId = med.catalogId || med.id;
      invMap.set(canonicalId, {
        id: canonicalId,
        name: med.name,
        genericName: med.genericName || '',
        price: med.price || 0,
        stock: Math.max(0, Number(med.stock) || 0),
        expiryDate: med.expiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0],
        company: med.supplier || '',
        barcode: med.barcode || ''
      });
    });

    // If search term exists, also search mappedCatalog to allow publishing any medicine
    if (inventorySearch.trim().length >= 2) {
      const q = inventorySearch.toLowerCase();
      mappedCatalog.forEach(catItem => {
        const canonicalId = catItem.id || catItem.barcode;
        if (canonicalId && !invMap.has(canonicalId)) {
          if (
            catItem.name.toLowerCase().includes(q) ||
            catItem.name_en.toLowerCase().includes(q) ||
            catItem.composition.toLowerCase().includes(q)
          ) {
            invMap.set(canonicalId, {
              id: canonicalId,
              name: catItem.name_en || catItem.name,
              genericName: catItem.composition || '',
              price: catItem.price || 5000,
              // No storage_inventory doc → no sellable stock exists.
              // Catalog fallback items must never advertise an invented quantity.
              stock: 0,
              expiryDate: new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0],
              company: catItem.company || '',
              barcode: catItem.barcode || ''
            });
          }
        }
      });
    }

    const items = Array.from(invMap.values());
    if (!inventorySearch.trim()) return items.slice(0, 50);

    const q = inventorySearch.toLowerCase();
    return items.filter(item => 
      item.name.toLowerCase().includes(q) ||
      item.genericName.toLowerCase().includes(q) ||
      (item.company && item.company.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.includes(q))
    ).slice(0, 50);
  }, [medicines, mappedCatalog, inventorySearch]);

  // Handle single/multi selection
  const toggleSelectMedicine = (item: { id: string; name: string; genericName: string; price: number; stock: number; expiryDate: string; company?: string }) => {
    setSelectedMedIds(prev => {
      const isSelected = prev.includes(item.id);
      if (isSelected) {
        const next = prev.filter(id => id !== item.id);
        const nextForms = { ...draftForms };
        delete nextForms[item.id];
        setDraftForms(nextForms);
        return next;
      } else {
        const defaultWholesalePrice = item.price > 0 ? Math.round(item.price * (bulkPricingRatio / 100)) : 4000;
        setDraftForms(curr => ({
          ...curr,
          [item.id]: {
            catalogId: item.id,
            tradeNameEn: item.name,
            tradeNameAr: item.name,
            composition: item.genericName,
            company: item.company || '',
            priceSyp: defaultWholesalePrice,
            // Derived from actual sellable stock only — a zero-stock item
            // must never prefill a synthetic positive quantity (phantom 250).
            availableQuantity: Math.max(0, Number(item.stock) || 0),
            minimumOrderQuantity: bulkMoq || 10,
            bonus: bulkBonus || '',
            isClearance: false,
            expiryDate: item.expiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0]
          }
        }));
        return [...prev, item.id];
      }
    });
  };

  const updateDraftField = (medId: string, field: keyof DraftOfferForm, value: any) => {
    setDraftForms(prev => ({
      ...prev,
      [medId]: {
        ...prev[medId],
        [field]: value
      }
    }));
  };

  // Bulk Apply Settings to All Selected
  const handleApplyBulkSettings = () => {
    setDraftForms(prev => {
      const next = { ...prev };
      selectedMedIds.forEach(id => {
        if (next[id]) {
          if (bulkMoq > 0) next[id].minimumOrderQuantity = bulkMoq;
          if (bulkBonus) next[id].bonus = bulkBonus;
        }
      });
      return next;
    });
    if (triggerToast) triggerToast(lang === 'ar' ? 'تم تطبيق الإعدادات على العناصر المحددة' : 'Bulk settings applied to selected items', 'info');
  };

  // Execute Firestore Batch/Parallel Writes with Clinical Progress Animation
  const handlePublishOffers = async () => {
    if (!currentSession?.pharmacyId || selectedMedIds.length === 0) return;

    setPublishStatus('publishing');
    setPublishingCount(selectedMedIds.length);

    const sellerId = currentSession.pharmacyId;
    const warehouseName = activePharmacy?.name || 'Warehouse';
    const warehouseCity = (typeof activePharmacy?.location === 'string' ? activePharmacy.location : activePharmacy?.location?.city) || 'Damascus';

    // Sellable-stock truth: the canonical storage_inventory snapshot.
    // A published offer must never advertise more than real stock —
    // drafts with synthetic/inflated quantities are clamped here, and
    // zero-stock items are drained (qty 0 + inactive) instead of published.
    const stockByCanonicalId = new Map<string, number>();
    medicines.forEach(med => {
      const canonicalId = med.catalogId || med.id;
      stockByCanonicalId.set(canonicalId, Math.max(0, Number(med.stock) || 0));
    });

    let clampedCount = 0;
    let drainedCount = 0;

    const newOffers: WholesaleOffer[] = selectedMedIds.map((medId) => {
      const draft = draftForms[medId];
      const safeCatalogId = String(draft?.catalogId || medId).replace(/\//g, '_');
      const offerDocId = `off_${sellerId}_${safeCatalogId}`;

      const draftQty = Math.max(0, Number(draft?.availableQuantity) || 0);
      const actualStock = stockByCanonicalId.get(draft?.catalogId || medId) ?? 0;
      const finalQty = Math.min(draftQty, actualStock);
      if (draftQty > actualStock) clampedCount++;
      const publishable = finalQty > 0;
      if (!publishable) drainedCount++;

      return {
        id: offerDocId,
        offerId: offerDocId,
        sellerTenantId: sellerId,
        sellerName: warehouseName,
        sellerCity: warehouseCity,
        catalogId: draft?.catalogId || medId,
        tradeNameEn: draft?.tradeNameEn || 'Medicine',
        tradeNameAr: draft?.tradeNameAr || draft?.tradeNameEn || '',
        composition: draft?.composition || '',
        company: draft?.company || '',
        manufacturer: draft?.company || '',
        priceSyp: Number(draft?.priceSyp) || 0,
        price: Number(draft?.priceSyp) || 0,
        availableQuantity: finalQty,
        stock: finalQty,
        minimumOrderQuantity: Number(draft?.minimumOrderQuantity) || 1,
        moq: Number(draft?.minimumOrderQuantity) || 1,
        bonus: draft?.bonus ? String(draft.bonus).trim() : '',
        isClearance: !!draft?.isClearance,
        expiryDate: draft?.expiryDate || new Date().toISOString().split('T')[0],
        active: publishable,
        reliability: 4.9,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

    // Update local state and cache immediately
    setOffers(prev => {
      const merged = [...newOffers, ...prev.filter(p => !newOffers.some(n => n.id === p.id))];
      saveCachedOffers(sellerId, merged);
      return merged;
    });

    try {
      if (db) {
        const writePromises = newOffers.map(async (offerPayload) => {
          const offerRef = doc(db, 'wholesale_offers', offerPayload.id);
          await setDoc(offerRef, offerPayload, { merge: true });
        });
        await Promise.all(writePromises);
      }

      // Transition to Published state
      setPublishStatus('published');
      const publishedCount = newOffers.length - drainedCount;
      if (triggerToast) {
        const detailAr = [
          drainedCount ? `تم إيقاف ${drainedCount} صنف بلا مخزون` : '',
          clampedCount ? `تم تعديل كميات ${clampedCount} صنف لمطابقة المخزون الفعلي` : ''
        ].filter(Boolean).join(' — ');
        const detailEn = [
          drainedCount ? `${drainedCount} zero-stock item(s) deactivated` : '',
          clampedCount ? `${clampedCount} quantity(ies) clamped to real stock` : ''
        ].filter(Boolean).join(', ');
        triggerToast(
          lang === 'ar'
            ? `تم نشر ${publishedCount} عروض بنجاح في سوق الجملة${detailAr ? ` (${detailAr})` : ''}`
            : `Published ${publishedCount} wholesale offer(s)${detailEn ? ` (${detailEn})` : ''}`,
          'success'
        );
      }

      // Reset and close after brief visual confirmation
      setTimeout(() => {
        setIsPublishModalOpen(false);
        setSelectedMedIds([]);
        setDraftForms({});
        setPublishStatus('idle');
      }, 1200);

    } catch (error: any) {
      console.warn("Firestore write notice:", error);
      // Still keep local offers saved
      setPublishStatus('published');
      if (error?.code === 'permission-denied' || error?.message?.includes('permission')) {
        setFirestoreRulesNotice(true);
      }
      if (triggerToast) {
        triggerToast(
          lang === 'ar' 
            ? `تم حفظ العروض محلياً (${selectedMedIds.length} عرض)` 
            : `Saved ${selectedMedIds.length} offer(s) locally. Update Firestore rules to sync cloud-wide.`, 
          'info'
        );
      }
      setTimeout(() => {
        setIsPublishModalOpen(false);
        setSelectedMedIds([]);
        setDraftForms({});
        setPublishStatus('idle');
      }, 1200);
    }
  };

  // Toggle Active/Inactive status in Firestore & Local State
  const handleToggleOfferStatus = async (offer: WholesaleOffer) => {
    const updatedStatus = !offer.active;
    
    // Update local state and cache
    setOffers(prev => {
      const updated = prev.map(o => o.id === offer.id ? { ...o, active: updatedStatus, updatedAt: new Date().toISOString() } : o);
      if (currentSession?.pharmacyId) saveCachedOffers(currentSession.pharmacyId, updated);
      return updated;
    });

    if (triggerToast) {
      triggerToast(
        lang === 'ar' 
          ? (updatedStatus ? 'تم تفعيل العرض في السوق' : 'تم إخفاء العرض عن السوق') 
          : (updatedStatus ? 'Offer activated on marketplace' : 'Offer hidden from marketplace'),
        'info'
      );
    }

    if (db) {
      try {
        const offerRef = doc(db, 'wholesale_offers', offer.id);
        await updateDoc(offerRef, {
          active: updatedStatus,
          updatedAt: new Date().toISOString()
        });
      } catch (err: any) {
        console.warn("Firestore status toggle warning:", err);
      }
    }
  };

  // Deactivate Offer (keeps history, stops showing on marketplace)
  const handleDeactivateOffer = async () => {
    if (!offerToDeactivate) return;
    setIsDeactivating(true);

    try {
      const finalReason = deactivateReason === 'Other' ? customDeactivateReason : deactivateReason;
      
      if (db) {
        await updateDoc(doc(db, 'wholesale_offers', offerToDeactivate.id), {
          active: false,
          updatedAt: new Date().toISOString()
        });

        // Notify affected users
        try {
          const notificationData = {
            type: 'OFFER_DEACTIVATED',
            offerId: offerToDeactivate.id,
            catalogId: offerToDeactivate.catalogId,
            sellerTenantId: offerToDeactivate.sellerTenantId,
            sellerName: offerToDeactivate.sellerName,
            drugName: offerToDeactivate.tradeNameEn || offerToDeactivate.tradeNameAr || 'Medicine',
            reason: finalReason,
            createdAt: new Date().toISOString()
          };
          
          await addDoc(collection(db, 'b2b_notifications'), notificationData);
        } catch (notifErr) {
          console.warn("Failed to create offer deactivation notification:", notifErr);
        }
      }

      setOffers(prev => {
        const updated = prev.map(o => o.id === offerToDeactivate.id ? { ...o, active: false } : o);
        if (currentSession?.pharmacyId) saveCachedOffers(currentSession.pharmacyId, updated);
        return updated;
      });

      if (triggerToast) triggerToast(lang === 'ar' ? 'تم إيقاف العرض بنجاح' : 'Offer deactivated successfully', 'success');
      
      setOfferToDeactivate(null);
    } catch (err: any) {
      console.warn("Firestore deactivate warning:", err);
      if (triggerToast) triggerToast(lang === 'ar' ? 'فشل إيقاف العرض' : 'Failed to deactivate offer', 'error');
    } finally {
      setIsDeactivating(false);
    }
  };

  // Save edits on existing offer
  const handleSaveOfferEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOffer) return;

    const updatedOffer: WholesaleOffer = {
      ...editingOffer,
      priceSyp: Number(editingOffer.priceSyp),
      price: Number(editingOffer.priceSyp),
      availableQuantity: Number(editingOffer.availableQuantity),
      stock: Number(editingOffer.availableQuantity),
      minimumOrderQuantity: Number(editingOffer.minimumOrderQuantity),
      moq: Number(editingOffer.minimumOrderQuantity),
      bonus: editingOffer.bonus || '',
      isClearance: !!editingOffer.isClearance,
      expiryDate: editingOffer.expiryDate,
      updatedAt: new Date().toISOString()
    };

    setOffers(prev => {
      const updated = prev.map(o => o.id === editingOffer.id ? updatedOffer : o);
      if (currentSession?.pharmacyId) saveCachedOffers(currentSession.pharmacyId, updated);
      return updated;
    });

    setIsEditingModalOpen(false);
    setEditingOffer(null);
    if (triggerToast) triggerToast(lang === 'ar' ? 'تم تحديث العرض بنجاح' : 'Offer updated successfully', 'success');

    if (db) {
      try {
        const offerRef = doc(db, 'wholesale_offers', editingOffer.id);
        await updateDoc(offerRef, {
          priceSyp: Number(editingOffer.priceSyp),
          price: Number(editingOffer.priceSyp),
          availableQuantity: Number(editingOffer.availableQuantity),
          stock: Number(editingOffer.availableQuantity),
          minimumOrderQuantity: Number(editingOffer.minimumOrderQuantity),
          moq: Number(editingOffer.minimumOrderQuantity),
          bonus: editingOffer.bonus || '',
          isClearance: !!editingOffer.isClearance,
          expiryDate: editingOffer.expiryDate,
          updatedAt: new Date().toISOString()
        });
      } catch (err: any) {
        console.warn("Firestore edit save warning:", err);
      }
    }
  };

  // Copy Firestore rules to clipboard
  const handleCopyRules = () => {
    navigator.clipboard.writeText(FIRESTORE_RULES_SNIPPET);
    if (triggerToast) {
      triggerToast(
        lang === 'ar' ? 'تم نسخ قواعد Firestore إلى الحافظة بنجاح!' : 'Firestore security rules copied to clipboard!',
        'success'
      );
    }
  };

  // Filtered offers list for warehouse table
  const filteredOffers = useMemo(() => {
    return offers.filter(offer => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        offer.tradeNameEn.toLowerCase().includes(q) ||
        (offer.tradeNameAr && offer.tradeNameAr.toLowerCase().includes(q)) ||
        (offer.composition && offer.composition.toLowerCase().includes(q));

      let matchesFilter = true;
      if (activeFilter === 'active') matchesFilter = offer.active;
      if (activeFilter === 'hidden') matchesFilter = !offer.active;
      if (activeFilter === 'clearance') matchesFilter = !!offer.isClearance;

      return matchesSearch && matchesFilter;
    });
  }, [offers, searchQuery, activeFilter]);

  return (
    <div className="flex-1 bg-[#F4F7F5] min-h-[calc(100vh-140px)] p-4 lg:p-8 font-sans">
      {/* Firebase Rules Notice Banner if needed */}
      {firestoreRulesNotice && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-800 shrink-0 mt-0.5 sm:mt-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-black text-amber-950">
                {lang === 'ar' ? 'تحديث قواعد حماية Firebase لمزامنة العروض السحابية' : 'Update Firebase Security Rules for Wholesale Cloud Sync'}
              </h3>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                {lang === 'ar' 
                  ? 'العروض محفوظة محلياً وتعمل بشكل سليم. لمزامنة العروض مباشرة مع كافة الصيدليات الأخرى، انسخ قواعد Firestore المحدثة وضعها في Firebase Console.' 
                  : 'Your offers are saved locally and fully functional. To sync live across all retail pharmacies, copy the updated Firestore rules into your Firebase Console.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleCopyRules}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            {lang === 'ar' ? 'نسخ قواعد Firestore' : 'Copy Firestore Rules'}
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 bg-white p-5 rounded-lg border border-brand-100 shadow-sm gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-700">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
                {lang === 'ar' ? 'سوق الجملة وإدارة العروض' : 'Wholesale Offers & Pricing Hub'}
                <span className="text-xs font-bold font-mono px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-800">
                  {offers.length} {lang === 'ar' ? 'عرض' : 'Offers'}
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ar' 
                  ? 'اختر من مخزون مستودعك الخاص وانشر العروض المباشرة للصيدليات في سوق B2B' 
                  : 'Select from your private warehouse inventory to publish live deals to verified retail pharmacies'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button 
            onClick={() => {
              setSelectedMedIds([]);
              setDraftForms({});
              setInventorySearch('');
              setIsPublishModalOpen(true);
            }}
            className="flex-1 sm:flex-none bg-brand-700 hover:bg-brand-800 active:scale-95 text-white font-bold px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {lang === 'ar' ? 'نشر عروض من المخزون' : 'Publish Offers from Inventory'}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-brand-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={lang === 'ar' ? 'بحث في عروضك المنشورة...' : 'Search your published offers by medicine or active ingredient...'}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white text-slate-800 text-xs font-bold border border-brand-100 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 focus:outline-none transition-all shadow-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button 
            onClick={() => setActiveFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${activeFilter === 'all' ? 'bg-brand-800 text-white border-brand-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200'}`}
          >
            {lang === 'ar' ? 'الكل' : 'All'} ({offers.length})
          </button>
          <button 
            onClick={() => setActiveFilter('active')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${activeFilter === 'active' ? 'bg-brand-800 text-white border-brand-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200'}`}
          >
            {lang === 'ar' ? 'النشطة' : 'Active'} ({offers.filter(o => o.active).length})
          </button>
          <button 
            onClick={() => setActiveFilter('hidden')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${activeFilter === 'hidden' ? 'bg-brand-800 text-white border-brand-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200'}`}
          >
            {lang === 'ar' ? 'المخفية' : 'Hidden'} ({offers.filter(o => !o.active).length})
          </button>
          <button 
            onClick={() => setActiveFilter('clearance')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all border ${activeFilter === 'clearance' ? 'bg-brand-800 text-white border-brand-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200'}`}
          >
            {lang === 'ar' ? 'تصفيات' : 'Clearance'} ({offers.filter(o => o.isClearance).length})
          </button>
        </div>
      </div>

      {/* Offers Table */}
      <div className="bg-white rounded-lg border border-brand-100 shadow-sm overflow-hidden">
        {isLoadingOffers ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
            <p className="text-sm font-bold text-slate-500">
              {lang === 'ar' ? 'جارٍ مزامنة العروض من قاعدة البيانات...' : 'Synchronizing wholesale offers from Firestore...'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/70 border-b border-brand-100 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-4">{lang === 'ar' ? 'المادة الدوائية' : 'Medicine Details'}</th>
                  <th className="p-4">{lang === 'ar' ? 'سعر الجملة' : 'Wholesale Price'}</th>
                  <th className="p-4">{lang === 'ar' ? 'الحد الأدنى' : 'MOQ'}</th>
                  <th className="p-4">{lang === 'ar' ? 'البونص' : 'Bonus'}</th>
                  <th className="p-4">{lang === 'ar' ? 'المخزون المعروض' : 'Offer Stock'}</th>
                  <th className="p-4">{lang === 'ar' ? 'الصلاحية' : 'Expiry Date'}</th>
                  <th className="p-4 text-center">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="p-4 text-right">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {filteredOffers.map(offer => (
                  <tr 
                    key={offer.id} 
                    className={`transition-colors ${offer.active ? 'hover:bg-slate-50/60' : 'bg-slate-50/50 opacity-60'}`}
                  >
                    <td className="p-4">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">
                          {lang === 'ar' && offer.tradeNameAr ? offer.tradeNameAr : offer.tradeNameEn}
                        </div>
                        {offer.composition && (
                          <div className="text-xs text-slate-500 font-medium">{offer.composition}</div>
                        )}
                        {offer.company && (
                          <div className="text-[10px] text-brand-700 font-bold mt-0.5">{offer.company}</div>
                        )}
                      </div>
                    </td>
                    <td className="p-4 font-black text-brand-800 font-mono text-sm">
                      {offer.priceSyp.toLocaleString()} <span className="text-[10px] font-normal text-brand-600">SYP</span>
                    </td>
                    <td className="p-4 font-mono font-bold text-slate-700 text-xs">
                      {offer.minimumOrderQuantity} {lang === 'ar' ? 'قطع' : 'units'}
                    </td>
                    <td className="p-4">
                      {offer.bonus ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg shadow-2xs">
                          <Gift className="w-3 h-3 text-amber-600" />
                          {offer.bonus}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-mono">-</span>
                      )}
                    </td>
                    <td className="p-4 font-mono font-bold text-slate-800 text-xs">
                      {offer.availableQuantity.toLocaleString()} {lang === 'ar' ? 'علبة' : 'units'}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs text-slate-600">{String(offer.expiryDate).split('T')[0]}</span>
                        {offer.isClearance && (
                          <span className="text-[9px] font-black text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded w-fit uppercase tracking-wider">
                            Clearance
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      {offer.active ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2.5 py-1 rounded-full">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {lang === 'ar' ? 'نشط في السوق' : 'Live on Market'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                          <EyeOff className="w-3.5 h-3.5" />
                          {lang === 'ar' ? 'مخفي' : 'Hidden'}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button 
                          onClick={() => handleToggleOfferStatus(offer)}
                          className={`p-2 rounded-lg transition-colors cursor-pointer ${offer.active ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-brand-600 hover:bg-brand-50'}`}
                          title={offer.active ? (lang === 'ar' ? 'إخفاء العرض' : 'Hide Offer') : (lang === 'ar' ? 'تفعيل العرض' : 'Publish Offer')}
                        >
                          {offer.active ? <EyeOff className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                        </button>
                        <button 
                          onClick={() => {
                            setEditingOffer({ ...offer });
                            setIsEditingModalOpen(true);
                          }}
                          className="p-2 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition-colors cursor-pointer"
                          title={lang === 'ar' ? 'تعديل العرض' : 'Edit Offer'}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setOfferToDeactivate(offer)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title={lang === 'ar' ? 'إيقاف العرض' : 'Deactivate Offer'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredOffers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-slate-500">
                      <div className="w-12 h-12 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 mx-auto mb-3">
                        <Tag className="w-6 h-6" />
                      </div>
                      <h3 className="text-base font-bold text-slate-800 mb-1">
                        {lang === 'ar' ? 'لا توجد عروض مطابقة' : 'No Wholesale Offers Found'}
                      </h3>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                        {lang === 'ar' 
                          ? 'انقر على "نشر عروض من المخزون" لتحديد الأدوية وإتاحتها في سوق الصيدليات.' 
                          : 'Click "Publish Offers from Inventory" to select medicines and list them on the B2B marketplace.'}
                      </p>
                      <button
                        onClick={() => {
                          setSelectedMedIds([]);
                          setDraftForms({});
                          setIsPublishModalOpen(true);
                        }}
                        className="px-4 py-2 bg-brand-700 text-white rounded-xl text-xs font-bold hover:bg-brand-800 transition-colors cursor-pointer"
                      >
                        {lang === 'ar' ? 'نشر أول عرض الآن' : 'Publish First Offer'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk Publish / Inventory Selection Modal */}
      <Modal 
        isOpen={isPublishModalOpen} 
        onClose={() => {
          if (publishStatus !== 'publishing') {
            setIsPublishModalOpen(false);
          }
        }} 
        title={lang === 'ar' ? 'نشر عروض من مخزون المستودع' : 'Publish Wholesale Offers from Inventory'} 
        maxWidth="2xl"
      >
        <div className="space-y-5">
          {/* Search Inventory */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-brand-600 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث في مخزون المستودع بالاسم، التركيب، أو الباركود...' : 'Search warehouse stock by trade name, generic, or barcode...'}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 text-slate-800 text-xs font-bold border border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none transition-all"
              />
            </div>
            <div className="text-xs font-bold text-slate-500 flex items-center gap-1.5 px-3 py-2 bg-slate-100 rounded-xl whitespace-nowrap">
              <Layers className="w-4 h-4 text-brand-700" />
              <span>{selectedMedIds.length} {lang === 'ar' ? 'محدد' : 'selected'}</span>
            </div>
          </div>

          {/* Quick Bulk Settings */}
          {selectedMedIds.length > 1 && (
            <div className="bg-brand-50/70 border border-brand-200/80 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-brand-900 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand-700" />
                  {lang === 'ar' ? 'تطبيق إعدادات جماعية سريعة' : 'Quick Bulk Offer Presets'}
                </span>
                <button
                  type="button"
                  onClick={handleApplyBulkSettings}
                  className="text-xs font-bold text-brand-800 hover:text-brand-950 underline cursor-pointer"
                >
                  {lang === 'ar' ? 'تطبيق على الكل' : 'Apply to all selected'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    {lang === 'ar' ? 'الحد الأدنى للطلب (MOQ)' : 'Default MOQ'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={bulkMoq}
                    onChange={(e) => setBulkMoq(parseInt(e.target.value) || 1)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-white border border-brand-200 rounded-lg focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    {lang === 'ar' ? 'بونص افتراضي' : 'Default Bonus'}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 10+1"
                    value={bulkBonus}
                    onChange={(e) => setBulkBonus(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-bold bg-white border border-brand-200 rounded-lg focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Selectable Inventory Table */}
          <div className="max-h-[360px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
            {selectableInventory.map(item => {
              const isSelected = selectedMedIds.includes(item.id);
              const draft = draftForms[item.id];

              return (
                <div 
                  key={item.id} 
                  className={`p-3 transition-colors ${isSelected ? 'bg-brand-50/50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectMedicine(item)}
                      className="mt-1 w-4 h-4 rounded text-brand-600 focus:ring-brand-500 cursor-pointer border-slate-300"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-xs text-slate-900 block truncate">{item.name}</span>
                          <span className="text-[10px] text-slate-500 block truncate">{item.genericName}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-black font-mono text-brand-800 block">
                            {item.price > 0 ? `${item.price.toLocaleString()} SYP` : 'N/A'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {lang === 'ar' ? `المخزون: ${item.stock}` : `Stock: ${item.stock}`}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Draft Inputs when Selected */}
                      {isSelected && draft && (
                        <div className="mt-3 pt-3 border-t border-brand-100/70 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white p-2.5 rounded-lg border border-brand-100">
                          <div>
                            <label className="block text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                              {lang === 'ar' ? 'سعر الجملة (ل.س)' : 'Wholesale (SYP)'}
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={draft.priceSyp || ''}
                              onChange={(e) => updateDraftField(item.id, 'priceSyp', parseInt(e.target.value) || 0)}
                              className="w-full px-2 py-1 text-xs font-bold font-mono border border-slate-200 rounded focus:border-brand-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                              {lang === 'ar' ? 'الكمية المعروضة' : 'Offer Qty'}
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={draft.availableQuantity || ''}
                              onChange={(e) => updateDraftField(item.id, 'availableQuantity', parseInt(e.target.value) || 0)}
                              className="w-full px-2 py-1 text-xs font-bold font-mono border border-slate-200 rounded focus:border-brand-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                              {lang === 'ar' ? 'الحد الأدنى (MOQ)' : 'Min Qty (MOQ)'}
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={draft.minimumOrderQuantity || ''}
                              onChange={(e) => updateDraftField(item.id, 'minimumOrderQuantity', parseInt(e.target.value) || 1)}
                              className="w-full px-2 py-1 text-xs font-bold font-mono border border-slate-200 rounded focus:border-brand-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                              {lang === 'ar' ? 'بونص' : 'Bonus'}
                            </label>
                            <input
                              type="text"
                              placeholder="10+1"
                              value={draft.bonus || ''}
                              onChange={(e) => updateDraftField(item.id, 'bonus', e.target.value)}
                              className="w-full px-2 py-1 text-xs font-bold border border-slate-200 rounded focus:border-brand-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {selectableInventory.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs font-bold">
                {lang === 'ar' ? 'لم يتم العثور على أدوية مطابقة في المخزون' : 'No matching medicines found in warehouse inventory'}
              </div>
            )}
          </div>

          {/* Action Area with Clinical State Transitions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500 font-bold">
              {selectedMedIds.length > 0 && (
                <span>
                  {selectedMedIds.length} {lang === 'ar' ? 'عروض جاهزة للنشر' : 'offers ready to publish'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={publishStatus === 'publishing'}
                onClick={() => setIsPublishModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                type="button"
                disabled={selectedMedIds.length === 0 || publishStatus === 'publishing'}
                onClick={handlePublishOffers}
                className={`relative overflow-hidden px-6 py-2.5 text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 ${
                  publishStatus === 'published' 
                    ? 'bg-brand-600 text-white' 
                    : publishStatus === 'publishing'
                    ? 'bg-brand-800 text-white'
                    : 'bg-brand-700 hover:bg-brand-800 text-white active:scale-95'
                }`}
              >
                {/* Subtle Light-Green Fill Progress Animation during publishing */}
                {publishStatus === 'publishing' && (
                  <motion.div
                    className="absolute inset-0 bg-brand-500/30"
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                  />
                )}

                {publishStatus === 'publishing' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin relative z-10" />
                    <span className="relative z-10">
                      {lang === 'ar' ? `جارٍ النشر... (${publishingCount})` : `Publishing... (${publishingCount})`}
                    </span>
                  </>
                ) : publishStatus === 'published' ? (
                  <>
                    <Check className="w-4 h-4 text-brand-200 relative z-10" />
                    <span className="relative z-10">
                      {lang === 'ar' ? 'تم النشر بنجاح' : 'Published'}
                    </span>
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4 relative z-10" />
                    <span className="relative z-10">
                      {lang === 'ar' 
                        ? `نشر ${selectedMedIds.length > 0 ? `(${selectedMedIds.length})` : ''} في السوق` 
                        : `Publish to Marketplace ${selectedMedIds.length > 0 ? `(${selectedMedIds.length})` : ''}`}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Deactivation Confirmation Modal */}
      <Modal
        isOpen={!!offerToDeactivate}
        onClose={() => !isDeactivating && setOfferToDeactivate(null)}
        title={lang === 'ar' ? 'إيقاف عرض الجملة' : 'Deactivate Wholesale Offer'}
        maxWidth="md"
      >
        {offerToDeactivate && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {lang === 'ar' 
                ? 'هل أنت متأكد من إيقاف هذا العرض؟ سيختفي العرض من سوق الصيدليات، لكن سيتم الاحتفاظ به في سجلك السري الخاص.' 
                : 'Are you sure you want to deactivate this offer? It will be removed from the marketplace but kept in your private ledger.'}
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                {lang === 'ar' ? 'سبب الإيقاف (إلزامي)' : 'Reason for deactivation'}
              </label>
              <select
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:border-rose-500 focus:outline-none"
              >
                <option value="Out of stock">{lang === 'ar' ? 'نفدت الكمية' : 'Out of stock'}</option>
                <option value="Price changed">{lang === 'ar' ? 'تغير السعر' : 'Price changed'}</option>
                <option value="Temporarily unavailable">{lang === 'ar' ? 'غير متوفر مؤقتاً' : 'Temporarily unavailable'}</option>
                <option value="Other">{lang === 'ar' ? 'سبب آخر...' : 'Other...'}</option>
              </select>
            </div>

            {deactivateReason === 'Other' && (
              <div>
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'اكتب السبب هنا...' : 'Type custom reason...'}
                  value={customDeactivateReason}
                  onChange={(e) => setCustomDeactivateReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:border-rose-500 focus:outline-none"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
              <button
                type="button"
                disabled={isDeactivating}
                onClick={() => setOfferToDeactivate(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-50 transition-colors"
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isDeactivating || (deactivateReason === 'Other' && !customDeactivateReason.trim())}
                onClick={handleDeactivateOffer}
                className="px-4 py-2 bg-rose-600 text-white font-bold text-xs rounded-xl hover:bg-rose-700 transition-colors flex items-center gap-2"
              >
                {isDeactivating ? (
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {lang === 'ar' ? 'تأكيد الإيقاف' : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Single Offer Modal */}
      <Modal
        isOpen={isEditingModalOpen && !!editingOffer}
        onClose={() => {
          setIsEditingModalOpen(false);
          setEditingOffer(null);
        }}
        title={lang === 'ar' ? 'تعديل عرض الجملة' : 'Edit Wholesale Offer'}
        maxWidth="lg"
      >
        {editingOffer && (
          <form onSubmit={handleSaveOfferEdit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                {lang === 'ar' ? 'المادة الدوائية' : 'Medicine'}
              </label>
              <input
                type="text"
                disabled
                value={editingOffer.tradeNameEn}
                className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  {lang === 'ar' ? 'سعر الجملة (ل.س)' : 'Wholesale Price (SYP)'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={editingOffer.priceSyp || ''}
                  onChange={(e) => setEditingOffer({ ...editingOffer, priceSyp: parseInt(e.target.value) || 0 })}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  {lang === 'ar' ? 'الكمية المعروضة' : 'Available Stock'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={editingOffer.availableQuantity || ''}
                  onChange={(e) => setEditingOffer({ ...editingOffer, availableQuantity: parseInt(e.target.value) || 0 })}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  {lang === 'ar' ? 'الحد الأدنى للطلب (MOQ)' : 'Minimum Order Qty (MOQ)'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={editingOffer.minimumOrderQuantity || ''}
                  onChange={(e) => setEditingOffer({ ...editingOffer, minimumOrderQuantity: parseInt(e.target.value) || 1 })}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  {lang === 'ar' ? 'البونص' : 'Bonus Scheme'}
                </label>
                <input
                  type="text"
                  placeholder="e.g. 10 + 1"
                  value={editingOffer.bonus || ''}
                  onChange={(e) => setEditingOffer({ ...editingOffer, bonus: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  {lang === 'ar' ? 'تاريخ الصلاحية' : 'Expiry Date'}
                </label>
                <input
                  type="date"
                  value={editingOffer.expiryDate || ''}
                  onChange={(e) => setEditingOffer({ ...editingOffer, expiryDate: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingOffer.isClearance}
                    onChange={(e) => setEditingOffer({ ...editingOffer, isClearance: e.target.checked })}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-rose-700">
                    {lang === 'ar' ? 'عرض تصفية خاص' : 'Clearance Special'}
                  </span>
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditingModalOpen(false);
                  setEditingOffer(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>

              <button
                type="submit"
                className="px-5 py-2 text-xs font-bold text-white bg-brand-700 hover:bg-brand-800 rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
