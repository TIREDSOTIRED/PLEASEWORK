import React, { useState, useEffect, useCallback } from 'react';
import { Drawer } from './ui/Drawer';
import { Skeleton } from './ui/Skeleton';
import { Package, History, Layers, Coins, Info, Pencil } from 'lucide-react';
import { Medicine } from '../types';
import { db } from '../infrastructure/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../application/auth/AuthContext';
import { planMedicineMetadataUpdate, planBatchMetadataUpdate, FieldError } from '../domain/inventory/metadataEdits';
import { updateBatchMetadata } from '../infrastructure/inventory/updateBatchMetadata';

type RowRole = 'pharmacy' | 'warehouse';

interface MedicineDetailsDrawerProps {
  /** Medicine to show; null closes the drawer. */
  medicine: Medicine | null;
  role: RowRole;
  lang?: 'en' | 'ar';
  onClose: () => void;
  /** Whitelisted medicine-level metadata persistence (existing optimistic path). */
  onUpdateMedicine?: (m: Partial<Medicine> & Pick<Medicine, 'id'>) => Promise<unknown> | void;
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
  close: { en: 'Close details', ar: 'إغلاق التفاصيل' },
  edit: { en: 'Edit', ar: 'تعديل' },
  save: { en: 'Save', ar: 'حفظ' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  saved: { en: 'Saved', ar: 'تم الحفظ' },
  saveFailed: { en: 'Save failed', ar: 'فشل الحفظ' },
  editingBatch: { en: 'Edit batch', ar: 'تعديل الوجبة' }
} as const;

const HISTORY_TYPE: Record<string, { en: string; ar: string }> = {
  manual_add: { en: 'Manual add', ar: 'إضافة يدوية' },
  manual_subtract: { en: 'Manual subtract', ar: 'خصم يدوي' },
  scan_add: { en: 'Scan add', ar: 'إضافة بمسح' },
  reorder: { en: 'Reorder', ar: 'طلب توريد' },
  edit: { en: 'Edit', ar: 'تعديل' },
  stock_in: { en: 'Stock in', ar: 'توريد' }
};

/** Planner field codes → localized messages. */
function errText(field: string, lang: 'en' | 'ar'): string {
  const M: Record<string, { en: string; ar: string }> = {
    price: { en: 'Enter a valid non-negative selling price', ar: 'أدخل سعراً صحيحاً غير سالب' },
    minThreshold: { en: 'Threshold must be a whole number ≥ 0', ar: 'يجب أن يكون العدد صحيحاً وأكبر من أو يساوي صفر' },
    batchNumber: { en: 'Batch number cannot be blank', ar: 'رقم الوجبة لا يمكن أن يكون فارغاً' },
    expiryDate: { en: 'Enter a valid expiry date', ar: 'أدخل تاريخ صلاحية صحيحاً' },
    cost: { en: 'Enter a valid non-negative purchase cost', ar: 'أدخل تكلفة شراء صحيحة غير سالبة' },
    form: { en: 'Save failed', ar: 'فشل الحفظ' }
  };
  return (M[field] && M[field][lang]) || field;
}

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
 * Inventory details drawer (Phase 2 read-only viewer + Phase 3 controlled editing).
 * Editable: batch metadata (batchNumber / expiryDate / cost) per batch, and a
 * whitelisted medicine-level set (price, minThreshold, supplier).
 * Stock quantities are NEVER editable here; Unknown stays Unknown until the
 * user explicitly saves a real value.
 */
export default function MedicineDetailsDrawer({ medicine, role, lang = 'en', onClose, onUpdateMedicine }: MedicineDetailsDrawerProps) {
  const t = (k: keyof typeof COPY) => COPY[k][lang];
  const isMobile = useIsMobile();
  const open = !!medicine;
  const { currentSession } = useAuth();

  const [batches, setBatches] = useState<any[] | null>(null);
  const [batchesError, setBatchesError] = useState(false);

  // --- Phase 3 edit state ---
  const [editSection, setEditSection] = useState<null | 'pricing' | 'reference'>(null);
  const [medForm, setMedForm] = useState({ price: '', minThreshold: '', supplier: '' });
  const [medErrors, setMedErrors] = useState<FieldError[]>([]);
  const [medSaving, setMedSaving] = useState(false);
  const [editBatchId, setEditBatchId] = useState<string | null>(null);
  const [batchForm, setBatchForm] = useState({ batchNumber: '', expiryDate: '', cost: '' });
  const [batchErrors, setBatchErrors] = useState<FieldError[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (label: string) => {
    setSavedFlash(label);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(null), 2200);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Reset edit state whenever the target medicine changes / drawer closes
  useEffect(() => {
    setEditSection(null); setMedErrors([]); setMedSaving(false);
    setEditBatchId(null); setBatchErrors([]); setBatchSaving(false); setSavedFlash(null);
  }, [medicine?.id, open]);

  const reloadBatches = useCallback(async () => {
    if (!medicine || !currentSession?.pharmacyId || !db) return;
    const safeMedId = String(medicine.id).replace(/\//g, '_');
    const snap = await getDocs(collection(db, 'tenants', currentSession.pharmacyId, 'storage_inventory', safeMedId, 'batches'));
    const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    loaded.sort((a, b) => String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')));
    setBatches(loaded);
  }, [medicine?.id, currentSession?.pharmacyId]);

  useEffect(() => {
    if (!open || !medicine) { setBatches(null); setBatchesError(false); return; }
    setBatches(null);
    setBatchesError(false);
    reloadBatches().catch(() => setBatchesError(true));
  }, [open, reloadBatches]);

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

  const canEdit = typeof onUpdateMedicine === 'function';
  const errFor = (errors: FieldError[], field: string) => errors.filter(e => e.field === field);

  const SectionTitle = ({ icon, label, action }: { icon: React.ReactNode; label: string; action?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {action}
      </div>
    </div>
  );

  const EditBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-brand-700 border border-brand-200 rounded-md hover:bg-brand-50 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <Pencil className="w-2.5 h-2.5" aria-hidden="true" />
      {label}
    </button>
  );

  const inputCls = 'w-full px-2 py-1.5 text-xs font-mono font-bold border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-brand-500 transition-colors';
  const errCls = 'text-[10px] text-rose-600 font-bold mt-0.5';

  const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 shrink-0">{k}</span>
      <span className="text-xs font-bold text-slate-700 text-end font-mono break-all">{v}</span>
    </div>
  );

  // --- save handlers (persist first, UI state only after success) ---
  const saveMedSection = async (patch: { price?: unknown; minThreshold?: unknown; supplier?: unknown }) => {
    if (!medicine || !onUpdateMedicine) return;
    const { errors, plan } = planMedicineMetadataUpdate(medicine, patch);
    if (errors.length) { setMedErrors(errors); return; }
    if (!plan.changes.length) { setEditSection(null); setMedErrors([]); return; }
    setMedSaving(true);
    setMedErrors([]);
    try {
      await onUpdateMedicine({ id: medicine.id, ...plan.writes, lastUpdated: new Date().toISOString() });
      setEditSection(null);
      flash(editSection === 'reference' ? 'reference' : 'pricing');
    } catch (e) {
      setMedErrors([{ field: 'form', message: 'save-failed' }]);
    } finally {
      setMedSaving(false);
    }
  };

  const saveBatchEdits = async () => {
    if (!medicine || !editBatchId || !currentSession?.pharmacyId) return;
    const batch = (batches as any[] | null)?.find(b => b.id === editBatchId);
    if (!batch) { setEditBatchId(null); return; }
    const { errors, plan } = planBatchMetadataUpdate(batch, {
      batchNumber: batchForm.batchNumber,
      expiryDate: batchForm.expiryDate,
      cost: batchForm.cost
    });
    if (errors.length) { setBatchErrors(errors); return; }
    if (!plan.changes.length) { setEditBatchId(null); setBatchErrors([]); return; }
    setBatchSaving(true);
    setBatchErrors([]);
    try {
      await updateBatchMetadata({
        tenantId: currentSession.pharmacyId,
        medId: medicine.id,
        batchId: editBatchId,
        writes: plan.writes,
        changes: plan.changes,
        userEmail: currentSession.email
      });
      await reloadBatches();
      setEditBatchId(null);
      flash('batch');
    } catch (e) {
      setBatchErrors([{ field: 'form', message: 'save-failed' }]);
    } finally {
      setBatchSaving(false);
    }
  };

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
        <SectionTitle
          icon={<Layers className="w-3.5 h-3.5" />}
          label={t('batchesSection')}
          action={savedFlash === 'batch' ? <span className="text-[10px] font-mono font-bold text-brand-600 normal-case">{t('saved')}</span> : undefined}
        />
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
                  {canEdit ? <th className="px-1.5 py-1.5" aria-hidden="true" /> : null}
                </tr>
              </thead>
              <tbody>
                {(batches as any[]).map(b => {
                  const depleted = (b.stock || 0) <= 0;
                  const editing = editBatchId === b.id;
                  return (
                    <React.Fragment key={b.id}>
                      <tr className={`border-t border-slate-100 ${depleted ? 'opacity-50' : ''}`}>
                        <td className="px-2.5 py-1.5 font-mono text-slate-600 break-all">{String(b.batchNumber || b.id).slice(0, 18)}</td>
                        <td className="px-2.5 py-1.5 text-end font-mono font-bold tabular-nums text-slate-800">{b.stock ?? 0}</td>
                        <td className="px-2.5 py-1.5 text-end font-mono text-slate-500">{fmtDate(b.expiryDate)}</td>
                        <td className="px-2.5 py-1.5 text-end font-mono text-slate-500">{fmtMoney(b.cost)}</td>
                        {canEdit ? (
                          <td className="px-1.5 py-1.5 text-center">
                            {!editing ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditBatchId(b.id);
                                  setBatchErrors([]);
                                  setBatchForm({
                                    batchNumber: String(b.batchNumber ?? ''),
                                    expiryDate: fmtDate(b.expiryDate) === '—' ? '' : fmtDate(b.expiryDate),
                                    cost: Number(b.cost) > 0 ? String(b.cost) : ''
                                  });
                                }}
                                title={t('edit')}
                                aria-label={`${t('edit')}: ${String(b.batchNumber || b.id)}`}
                                className="p-1 rounded-md text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      {editing ? (
                        <tr>
                          <td colSpan={canEdit ? 5 : 4} className="bg-[#F4F7F5] border-t border-slate-100 px-2.5 py-2">
                            <div className="text-[10px] font-mono font-bold uppercase text-slate-400 mb-1.5">{t('editingBatch')}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                              <div>
                                <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('batchCol')}</label>
                                <input
                                  type="text"
                                  value={batchForm.batchNumber}
                                  onChange={e => setBatchForm(f => ({ ...f, batchNumber: e.target.value }))}
                                  className={inputCls}
                                />
                                {errFor(batchErrors, 'batchNumber').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('expiry')}</label>
                                <input
                                  type="date"
                                  value={batchForm.expiryDate}
                                  onChange={e => setBatchForm(f => ({ ...f, expiryDate: e.target.value }))}
                                  className={inputCls}
                                />
                                {errFor(batchErrors, 'expiryDate').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('purchaseCost')} ({COPY.currency[lang]})</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder={t('unknown')}
                                  value={batchForm.cost}
                                  onChange={e => setBatchForm(f => ({ ...f, cost: e.target.value }))}
                                  className={inputCls}
                                />
                                {errFor(batchErrors, 'cost').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
                              </div>
                            </div>
                            {errFor(batchErrors, 'form').map((e, i) => <p key={i} className={errCls}>{errText('form', lang)}</p>)}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={saveBatchEdits}
                                disabled={batchSaving}
                                className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                              >
                                {t('save')}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditBatchId(null); setBatchErrors([]); }}
                                disabled={batchSaving}
                                className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                              >
                                {t('cancel')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pricing */}
        <SectionTitle
          icon={<Coins className="w-3.5 h-3.5" />}
          label={t('pricingSection')}
          action={
            canEdit ? (
              editSection === 'pricing' ? null : (
                <>
                  {savedFlash === 'pricing' ? <span className="text-[10px] font-mono font-bold text-brand-600 normal-case">{t('saved')}</span> : null}
                  <EditBtn label={t('edit')} onClick={() => {
                    setEditSection('pricing');
                    setMedErrors([]);
                    setMedForm({
                      price: String(medicine.price ?? ''),
                      minThreshold: String(medicine.minThreshold ?? ''),
                      supplier: medForm.supplier
                    });
                  }} />
                </>
              )
            ) : undefined
          }
        />
        {editSection === 'pricing' ? (
          <div className="p-2.5 rounded-xl border border-brand-100 bg-[#F4F7F5]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('sellingPrice')} ({COPY.currency[lang]})</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={medForm.price}
                  onChange={e => setMedForm(f => ({ ...f, price: e.target.value }))}
                  className={inputCls}
                />
                {errFor(medErrors, 'price').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('minThreshold')}</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={medForm.minThreshold}
                  onChange={e => setMedForm(f => ({ ...f, minThreshold: e.target.value }))}
                  className={inputCls}
                />
                {errFor(medErrors, 'minThreshold').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
              </div>
            </div>
            {errFor(medErrors, 'form').map((e, i) => <p key={i} className={errCls}>{errText('form', lang)}</p>)}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => saveMedSection({ price: medForm.price, minThreshold: medForm.minThreshold })}
                disabled={medSaving}
                className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {t('save')}
              </button>
              <button
                type="button"
                onClick={() => { setEditSection(null); setMedErrors([]); }}
                disabled={medSaving}
                className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <KV k={t('sellingPrice')} v={`${(Number(medicine.price) || 0).toLocaleString()} ${COPY.currency[lang]}`} />
          </div>
        )}

        {/* Reference */}
        <SectionTitle
          icon={<Info className="w-3.5 h-3.5" />}
          label={t('referenceSection')}
          action={
            canEdit ? (
              editSection === 'reference' ? null : (
                <>
                  {savedFlash === 'reference' ? <span className="text-[10px] font-mono font-bold text-brand-600 normal-case">{t('saved')}</span> : null}
                  <EditBtn label={t('edit')} onClick={() => {
                    setEditSection('reference');
                    setMedErrors([]);
                    setMedForm(f => ({ ...f, supplier: String(medicine.supplier ?? '') }));
                  }} />
                </>
              )
            ) : undefined
          }
        />
        <p className="text-[10px] text-slate-400 font-mono mb-1.5">{t('refNote')}</p>
        {editSection === 'reference' ? (
          <div className="p-2.5 mb-1.5 rounded-xl border border-brand-100 bg-[#F4F7F5]">
            <label className="block text-[10px] text-slate-400 font-mono mb-0.5">{t('supplier')}</label>
            <input
              type="text"
              value={medForm.supplier}
              onChange={e => setMedForm(f => ({ ...f, supplier: e.target.value }))}
              className={inputCls}
            />
            {errFor(medErrors, 'supplier').map((e, i) => <p key={i} className={errCls}>{errText(e.field, lang)}</p>)}
            {errFor(medErrors, 'form').map((e, i) => <p key={i} className={errCls}>{errText('form', lang)}</p>)}
            <div className="flex items-center gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => saveMedSection({ supplier: medForm.supplier })}
                disabled={medSaving}
                className="px-2.5 py-1 text-[10px] font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {t('save')}
              </button>
              <button
                type="button"
                onClick={() => { setEditSection(null); setMedErrors([]); }}
                disabled={medSaving}
                className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : null}
        <div>
          <KV k={t('expiry')} v={fmtDate(medicine.expiryDate)} />
          <KV k={t('refBatch')} v={medicine.batchNumber || '—'} />
          <KV k={t('barcode')} v={medicine.barcode || '—'} />
          {editSection !== 'reference' ? <KV k={t('supplier')} v={medicine.supplier || '—'} /> : null}
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
