import React from 'react';
import { motion } from 'motion/react';
import { Plus, Minus, Calendar, AlertTriangle } from 'lucide-react';
import { Medicine } from '../types';
import { translations } from '../data/translations';

type RowRole = 'pharmacy' | 'warehouse';

interface MedicineRowProps {
  /** List reconciliation key. */
  key?: string;
  medicine: Medicine;
  role: RowRole;
  lang?: 'en' | 'ar';
  /** Opens the existing detail surface (ItemViewTab). Stretched across the row. */
  onSelect: (id: string) => void;
  /** Existing coalesced path: optimistic local bump -> StockEngine flush. */
  onQuickAdjust: (id: string, delta: number, note?: string) => void;
  /** Role-specific low-frequency actions (surplus publish, external sale, ...). */
  roleActions?: React.ReactNode;
}

/**
 * Shared compact inventory row for pharmacy + warehouse lists.
 * Presentation only: quantity taps are forwarded verbatim to the
 * StockEngine-backed onQuickAdjust handler owned by the parent tabs.
 */
export default function MedicineRow({
  medicine,
  role,
  lang = 'en',
  onSelect,
  onQuickAdjust,
  roleActions
}: MedicineRowProps) {
  const t = translations[lang];
  const copy = COPY[role];

  const stock = medicine.stock || 0;
  const isOut = stock <= 0;
  const isLow = !isOut && stock < medicine.minThreshold;

  const daysToExpiry = getDaysToExpiry(medicine.expiryDate);
  const isExpired = daysToExpiry <= 0;
  const isExpiringSoon = !isExpired && daysToExpiry < 90;

  const adjust = (delta: 1 | -1) => {
    if (delta === -1 && isOut) return;
    onQuickAdjust(
      medicine.id,
      delta,
      delta === -1 ? copy.noteMinus[lang] : copy.notePlus[lang]
    );
  };

  const stateBadge = (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-mono font-bold uppercase tracking-wide ${
        isOut
          ? 'text-rose-700 bg-rose-50 border-rose-200'
          : isLow
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : 'text-brand-700 bg-brand-50 border-brand-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full ${
          isOut ? 'bg-rose-500' : isLow ? 'bg-amber-500 animate-pulse' : 'bg-brand-500'
        }`}
      />
      {isOut ? copy.out[lang] : isLow ? t.lowStockStatus : role === 'warehouse' ? t.secureStatus : copy.inStock[lang]}
    </span>
  );

  const expiryChip = (
    <span
      title={
        isExpired
          ? lang === 'ar' ? 'منتهية الصلاحية' : 'Expired'
          : isExpiringSoon
            ? lang === 'ar' ? 'ينتهي قريباً' : 'Expiring soon'
            : undefined
      }
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-bold shrink-0 ${
        isExpired
          ? 'text-rose-600 bg-rose-50 border-rose-200'
          : isExpiringSoon
            ? 'text-amber-600 bg-amber-50 border-amber-200'
            : 'text-slate-500 bg-slate-50 border-slate-200'
      }`}
    >
      {isExpired ? (
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      ) : (
        <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
      )}
      {String(medicine.expiryDate).split('T')[0]}
    </span>
  );

  return (
    <motion.div
      layout
      id={`med-row-${medicine.id}`}
      className={`group relative bg-white border rounded-xl p-3 transition-colors cursor-pointer ${
        role === 'pharmacy'
          ? 'border-brand-100/80 hover:border-blue-300/80 hover:bg-brand-50/10'
          : 'border-slate-200/80 hover:border-blue-300/80 hover:bg-blue-50/10'
      }`}
    >
      {/* Stretched details target: row tap / keyboard opens the detail surface.
          Interactive controls sit above it via z-10 + pointer-events-auto. */}
      <button
        type="button"
        onClick={() => onSelect(medicine.id)}
        aria-label={lang === 'ar' ? `عرض تفاصيل ${medicine.name}` : `Open details: ${medicine.name}`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
      />

      <div className="relative z-10 pointer-events-none">
        {/* Line 1: identity + prominent stock */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <h3 className="text-sm font-bold text-brand-950 group-hover:text-brand-700 transition-colors tracking-tight truncate">
                {medicine.name}
              </h3>
              <span className="text-xs font-normal text-slate-400 font-mono shrink-0">
                ({medicine.strength})
              </span>
            </div>
            {medicine.genericName ? (
              <p className="text-xs text-slate-500 italic truncate mt-0.5">{medicine.genericName}</p>
            ) : null}
          </div>

          <div className="shrink-0 text-end">
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="text-xl leading-none font-black font-mono tabular-nums text-brand-950">
                {stock}
              </span>
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400">
                {copy.unit[lang]}
              </span>
            </div>
            <div className="mt-1 flex justify-end">{stateBadge}</div>
          </div>
        </div>

        {/* Line 2: meta + controls */}
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center gap-2 flex-wrap">
          {expiryChip}

          <div className="leading-tight min-w-0">
            <span className="hidden sm:block text-[9px] text-slate-400 font-mono font-bold uppercase tracking-wide">
              {t.sellingPrice}
            </span>
            <span className="text-[13px] font-bold text-brand-700 font-mono tabular-nums">
              {(Number(medicine.price) || 0).toLocaleString()} {copy.currency[lang]}
            </span>
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            {roleActions ? (
              <div className="pointer-events-auto flex items-center gap-1.5">{roleActions}</div>
            ) : null}

            <div
              role="group"
              aria-label={lang === 'ar' ? 'تعديل سريع للكمية' : 'Quick quantity adjustment'}
              className="pointer-events-auto flex items-center rounded-xl border border-brand-100/80 bg-[#F4F7F5] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => adjust(-1)}
                disabled={isOut}
                aria-label={copy.dispenseAria[lang]}
                title={copy.dispenseAria[lang]}
                className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
              >
                <Minus className="w-4 h-4" aria-hidden="true" />
              </button>

              <span className="w-px self-stretch bg-slate-200" aria-hidden="true" />

              <button
                type="button"
                onClick={() => adjust(1)}
                aria-label={copy.restockAria[lang]}
                title={copy.restockAria[lang]}
                className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-brand-600 hover:bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Same day-diff semantics the previous cards used. */
function getDaysToExpiry(expiryDateStr: string): number {
  const expiry = new Date(expiryDateStr);
  const today = new Date();
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/** Role copy — exact strings previously written by each tab's card. */
const COPY: Record<RowRole, {
  unit: Record<'en' | 'ar', string>;
  currency: Record<'en' | 'ar', string>;
  inStock: Record<'en' | 'ar', string>;
  out: Record<'en' | 'ar', string>;
  noteMinus: Record<'en' | 'ar', string>;
  notePlus: Record<'en' | 'ar', string>;
  dispenseAria: Record<'en' | 'ar', string>;
  restockAria: Record<'en' | 'ar', string>;
}> = {
  pharmacy: {
    unit: { en: 'units', ar: 'علبة' },
    currency: { en: 'SYP', ar: 'ل.س' },
    inStock: { en: 'In Stock', ar: 'متوفر' },
    out: { en: 'Out of Stock', ar: 'نفذت الكمية' },
    noteMinus: { en: 'Quick inventory reduction', ar: 'تخفيض سريع للمخزون' },
    notePlus: { en: 'Quick inventory injection', ar: 'توريد سريع للمخزون' },
    dispenseAria: { en: 'Dispense one unit', ar: 'صرف علبة واحدة' },
    restockAria: { en: 'Restock one unit', ar: 'توريد علبة واحدة' }
  },
  warehouse: {
    unit: { en: 'Cartons', ar: 'كرتونة' },
    currency: { en: 'S.P.', ar: 'ل.س' },
    inStock: { en: 'In Stock', ar: 'متوفر' },
    out: { en: 'Out of Stock', ar: 'نفذت الكمية' },
    noteMinus: { en: 'Quick deduction 1 carton', ar: 'صرف كرتونة واحدة' },
    notePlus: { en: 'Quick restock 1 carton', ar: 'توريد كرتونة واحدة' },
    dispenseAria: { en: 'Dispense one carton', ar: 'صرف كرتونة واحدة' },
    restockAria: { en: 'Restock one carton', ar: 'توريد كرتونة واحدة' }
  }
};
