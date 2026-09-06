import React, { useState } from 'react';
import { CheckCircle2, Circle, X, Store, PackagePlus, PackageCheck, Receipt, Building2 } from 'lucide-react';

/**
 * P1 #7 — first-run guidance: a small dismissible checklist that shows a
 * brand-new pharmacy what to do first. Never blocks interaction; state is
 * local (localStorage) so it survives reloads and stays out of Firestore.
 */

const STORAGE_KEY = 'eshmun_firstrun_v1';

interface FirstRunState {
  dismissed?: boolean;
  checkedReceive?: boolean;
  checkedMarketplace?: boolean;
}

const readState = (): FirstRunState => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
};

interface FirstRunChecklistProps {
  lang?: 'en' | 'ar';
  pharmacyName?: string;
  hasMedicines?: boolean;
  hasSales?: boolean;
}

export default function FirstRunChecklist({ lang = 'en', pharmacyName, hasMedicines, hasSales }: FirstRunChecklistProps) {
  const [st, setSt] = useState<FirstRunState>(readState);
  const isArabic = lang === 'ar';

  if (st.dismissed) return null;

  const persist = (patch: FirstRunState) => {
    const next = { ...st, ...patch };
    setSt(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  };

  const items: { icon: React.ReactNode; label: string; done: boolean; toggle?: () => void }[] = [
    {
      icon: <Store className="w-3.5 h-3.5" />,
      label: isArabic ? 'أكمل ملف الصيدلية' : 'Complete your pharmacy profile',
      done: Boolean(pharmacyName)
    },
    {
      icon: <PackagePlus className="w-3.5 h-3.5" />,
      label: isArabic ? 'أضف أول الأدوية (السجل ← إضافة دواء)' : 'Add your first medicines (Ledger → Add Medicine)',
      done: Boolean(hasMedicines)
    },
    {
      icon: <PackageCheck className="w-3.5 h-3.5" />,
      label: isArabic ? 'استلم دفعة جديدة من المخزون' : 'Receive a stock batch',
      done: Boolean(hasMedicines) || Boolean(st.checkedReceive),
      toggle: () => persist({ checkedReceive: !st.checkedReceive })
    },
    {
      icon: <Receipt className="w-3.5 h-3.5" />,
      label: isArabic ? 'قم بأول عملية بيع' : 'Make your first sale',
      done: Boolean(hasSales)
    },
    {
      icon: <Building2 className="w-3.5 h-3.5" />,
      label: isArabic ? 'استكشف سوق الجملة (طلباتي)' : 'Explore the wholesale marketplace (My Orders)',
      done: Boolean(st.checkedMarketplace),
      toggle: () => persist({ checkedMarketplace: !st.checkedMarketplace })
    }
  ];

  const doneCount = items.filter(i => i.done).length;

  return (
    <div
      id="first-run-checklist"
      className="mx-4 mt-3 mb-1 bg-white border border-brand-200 rounded-xl shadow-sm p-3.5 flex items-start gap-3 shrink-0"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-black text-slate-900 tracking-tight">
            {isArabic ? 'ابدأ بخمس خطوات' : 'Get started in 5 steps'}
            <span className="ml-2 rtl:ml-0 rtl:mr-2 text-[10px] font-bold text-brand-600 font-mono">
              {doneCount}/{items.length}
            </span>
          </h3>
          <button
            id="btn-dismiss-first-run"
            onClick={() => persist({ dismissed: true })}
            title={isArabic ? 'إخفاء' : 'Dismiss'}
            className="w-6 h-6 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li
              key={i}
              onClick={it.toggle}
              className={`flex items-center gap-2 text-xs ${it.toggle ? 'cursor-pointer select-none' : ''}`}
            >
              {it.done
                ? <CheckCircle2 className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
              <span className={it.done ? 'text-slate-400 line-through' : 'text-slate-700 font-medium'}>
                {it.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
