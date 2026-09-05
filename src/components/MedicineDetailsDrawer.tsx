import React, { useState, useEffect } from 'react';
import { Drawer } from './ui/Drawer';
import { Skeleton } from './ui/Skeleton';
import { Package, History, Layers, Coins, Info } from 'lucide-react';
import { Medicine } from '../types';
import { db } from '../infrastructure/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../application/auth/AuthContext';

type RowRole = 'pharmacy' | 'warehouse';

interface MedicineDetailsDrawerProps {
  /** Medicine to show; null closes the drawer. */
  medicine: Medicine | null;
  role: RowRole;
  lang?: 'en' | 'ar';
  onClose: () => void;
}

const COPY = {
  unit: { pharmacy: { en: 'units', ar: 'علبة' }, warehouse: { en: 'Cartons', ar: 'كرتونة' } },
  currency: { en: 'SYP', ar: 'ل.س' },
  inStock: { en: 'In Stock', ar: 'متوفر' },
  out: { en: 'Out of Stock', ar: 'نفذت الكمية' },
  low: { en: 'LOW STOCK', ar: 'مخزون منخفض جداً' },
  secure: { en: 'SECURE', ar: 'المخزون آمن' },
  stockSection: { en: 'Stock', ar: 'المخزون' },
  pricingSection: { en: 'Pricing', ar: 'الأسعار' },
  batchesSection: { en: 'Batches (FEFO)', ar: 'الوجبات' },
  referenceSection: { en: 'Reference', ar: 'بيانات مرجعية' },
  historySection: { en: 'Recent activity', ar: 'الحركات الأخيرة' },
  sellingPrice: { en: 'Selling price', ar: 'سعر البيع' },
  purchaseCost: { en: 'Purchase cost', ar: 'سعر الشراء' },
  minThreshold: { en: 'Min threshold', ar: 'الحد الأدنى' },
  barcode: { en: 'Barcode', ar: 'الباركود' },
  supplier: { en: 'Supplier', ar: 'المورد' },
  shelf: { en: 'Shelf', ar: 'الرف' },
  expiry: { en: 'Expiry', ar: 'الصلاحية' },
  refBatch: { en: 'Batch (reference)', ar: 'وجبة (مرجعية)' },
  refNote: { en: 'Reference only — sellable stock is allocated across batches below.', ar: 'للمرجعية فقط — المخزون القابل للبيع موزع على الوجبات أدناه.' },
  batchCol: { en: 'Batch', ar: 'وجبة' },
  stockCol: { en: 'Stock', ar: 'المخزون' },
  costCol: { en: 'Cost', ar: 'التكلفة' },
  unknown: { en: 'Unknown', ar: 'غير معروف' },
  noBatches: { en: 'No batch records found.', ar: 'لا توجد سجلات وجبات.' },
  batchesError: { en: 'Batches could not be loaded.', ar: 'تعذر تحميل الوجبات.' },
  noHistory: { en: 'No movements recorded yet.', ar: 'لا توجد حركات مسجلة بعد.' },
  close: { en: 'Close details', ar: 'إغلاق التفاصيل' }
} as const;

const HISTORY_TYPE: Record<string, { en: string; ar: string }> = {
  manual_add: { en: 'Manual add', ar: 'إضافة يدوية' },
  manual_subtract: { en: 'Manual subtract', ar: 'خصم يدوي' },
  scan_add: { en: 'Scan add', ar: 'إضافة بمسح' },
  reorder: { en: 'Reorder', ar: 'طلب توريد' },
  edit: { en: 'Edit', ar: 'تعديل' },
  stock_in: { en: 'Stock in', ar: 'توريد' }
};

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/**
 * Phase 2 — read-only details drawer for a single medicine.
 * One batch subcollection read per open; no writes, no identity/FEFO changes.
 */
export default function MedicineDetailsDrawer({ medicine, role, lang = 'en', onClose }: MedicineDetailsDrawerProps) {
  const t = (k: keyof typeof COPY) => COPY[k][lang];
  const isMobile = useIsMobile();
  const open = !!medicine;
  const { currentSession } = useAuth();

  const [batches, setBatches] = useState<any[] | null>(null);
  const [batchesError, setBatchesError] = useState(false);

  useEffect(() => {
    if (!open || !medicine) { setBatches(null); setBatchesError(false); return; }
    let cancelled = false;
    setBatches(null);
    setBatchesError(false);
    (async () => {
      try {
        if (!currentSession?.pharmacyId || !db) throw new Error('no session');
        const safeMedId = String(medicine.id).replace(/\//g, '_');
        const snap = await getDocs(collection(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches'));
        if (cancelled) return;
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        loaded.sort((a, b) => String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')));
        setBatches(loaded);
      } catch (e) {
        if (!cancelled) setBatchesError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, medicine?.id, currentSession?.pharmacyId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!medicine) return null;

  const stock = medicine.stock || 0;
  const isOut = stock <= 0;
  const isLow = !isOut && stock < medicine.minThreshold;
  const stateLabel = isOut ? COPY.out[lang] : isLow ? COPY.low[lang] : role === 'warehouse' ? COPY.secure[lang] : COPY.inStock[lang];
  const stateCls = isOut
    ? 'text-rose-700 bg-rose-50 border-rose-200'
    : isLow
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-brand-700 bg-brand-50 border-brand-200';

  const fmtDate = (v: any) => (v ? String(v).split('T')[0] : '—');
  const fmtMoney = (v: any) => (Number(v) > 0 ? `${Number(v).toLocaleString()} ${COPY.currency[lang]}` : COPY.unknown[lang]);

  const SectionTitle = ({ icon, label }: { icon: React.ReactNode; label: string }) => (
    <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">
      {icon}
      <span>{label}</span>
    </div>
  );

  const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 shrink-0">{k}</span>
      <span className="text-xs font-bold text-slate-700 text-end font-mono break-all">{v}</span>
    </div>
  );

  return (
    <Drawer
      isOpen={open}
      onClose={onClose}
      title={medicine.name}
      position={isMobile ? 'bottom' : 'right'}
      maxWidth="md"
    >
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {/* Identity */}
        <div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-base font-bold text-brand-950">{medicine.name}</span>
            {medicine.strength ? <span className="text-xs font-mono text-slate-400">({medicine.strength})</span> : null}
          </div>
          {medicine.genericName ? <p className="text-xs text-slate-500 italic mt-0.5">{medicine.genericName}</p> : null}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] font-mono font-bold text-brand-700 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-md uppercase">{medicine.category}</span>
            {medicine.dosageForm ? <span className="text-[10px] font-mono text-slate-400 border border-slate-200 px-2 py-0.5 rounded-md">{medicine.dosageForm}</span> : null}
          </div>
        </div>

        {/* Stock */}
        <SectionTitle icon={<Package className="w-3.5 h-3.5" />} label={t('stockSection')} />
        <div className="p-3 rounded-xl border border-brand-100/80 bg-[#F4F7F5] flex items-center justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black font-mono tabular-nums text-brand-950">{stock}</span>
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400">{COPY.unit[role][lang]}</span>
            </div>
            <div className="mt-1">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-mono font-bold uppercase ${stateCls}`}>
                {stateLabel}
              </span>
            </div>
          </div>
          <div className="text-end">
            <span className="text-[10px] text-slate-400 font-mono">{t('minThreshold')}</span>
            <div className="text-sm font-bold font-mono text-slate-700">{medicine.minThreshold}</div>
          </div>
        </div>

        {/* Batches (FEFO) */}
        <SectionTitle icon={<Layers className="w-3.5 h-3.5" />} label={t('batchesSection')} />
        {batches === null && !batchesError ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        ) : batchesError ? (
          <p className="text-xs text-slate-500 py-2">{t('batchesError')}</p>
        ) : (batches as any[]).length === 0 ? (
          <p className="text-xs text-slate-500 py-2">{t('noBatches')}</p>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#F4F7F5] text-[9px] font-mono font-bold uppercase text-slate-400">
                  <th className="text-start px-2.5 py-1.5 font-bold">{t('batchCol')}</th>
                  <th className="text-end px-2.5 py-1.5 font-bold">{t('stockCol')}</th>
                  <th className="text-end px-2.5 py-1.5 font-bold">{t('expiry')}</th>
                  <th className="text-end px-2.5 py-1.5 font-bold">{t('costCol')}</th>
                </tr>
              </thead>
              <tbody>
                {(batches as any[]).map(b => {
                  const depleted = (b.stock || 0) <= 0;
                  return (
                    <tr key={b.id} className={`border-t border-slate-100 ${depleted ? 'opacity-50' : ''}`}>
                      <td className="px-2.5 py-1.5 font-mono text-slate-600 break-all">{String(b.batchNumber || b.id).slice(0, 18)}</td>
                      <td className="px-2.5 py-1.5 text-end font-mono font-bold tabular-nums text-slate-800">{b.stock ?? 0}</td>
                      <td className="px-2.5 py-1.5 text-end font-mono text-slate-500">{fmtDate(b.expiryDate)}</td>
                      <td className="px-2.5 py-1.5 text-end font-mono text-slate-500">{fmtMoney(b.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pricing */}
        <SectionTitle icon={<Coins className="w-3.5 h-3.5" />} label={t('pricingSection')} />
        <div>
          <KV k={t('sellingPrice')} v={`${(Number(medicine.price) || 0).toLocaleString()} ${COPY.currency[lang]}`} />
          <KV k={t('purchaseCost')} v={fmtMoney(medicine.costPrice)} />
        </div>

        {/* Reference */}
        <SectionTitle icon={<Info className="w-3.5 h-3.5" />} label={t('referenceSection')} />
        <p className="text-[10px] text-slate-400 font-mono mb-1.5">{t('refNote')}</p>
        <div>
          <KV k={t('expiry')} v={fmtDate(medicine.expiryDate)} />
          <KV k={t('refBatch')} v={medicine.batchNumber || '—'} />
          <KV k={t('barcode')} v={medicine.barcode || '—'} />
          <KV k={t('supplier')} v={medicine.supplier || '—'} />
          <KV k={t('shelf')} v={medicine.shelfLocation || '—'} />
        </div>

        {/* History */}
        <SectionTitle icon={<History className="w-3.5 h-3.5" />} label={t('historySection')} />
        {!medicine.history || medicine.history.length === 0 ? (
          <p className="text-xs text-slate-500 pb-4">{t('noHistory')}</p>
        ) : (
          <div className="space-y-1.5 pb-4">
            {[...medicine.history].slice(-5).reverse().map(h => {
              const typeLabel = HISTORY_TYPE[h.type] ? HISTORY_TYPE[h.type][lang] : h.type;
              const delta = h.delta || 0;
              return (
                <div key={h.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-slate-50 last:border-0">
                  <div className="min-w-0">
                    <span className="font-bold text-slate-700">{typeLabel}</span>
                    {h.note ? <span className="text-slate-400 truncate block text-[10px]">{h.note}</span> : null}
                  </div>
                  <div className="shrink-0 text-end font-mono">
                    <span className={`font-bold ${delta > 0 ? 'text-brand-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                    <span className="text-slate-400 text-[10px] block">{fmtDate(h.timestamp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Drawer>
  );
}
