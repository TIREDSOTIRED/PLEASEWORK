import React, { useState } from 'react';
import { 
 TrendingUp, 
 CreditCard, 
 AlertCircle, 
 Receipt, 
 Search, 
 Filter, 
 ArrowUpRight, 
 ArrowDownRight, 
 CheckCircle2, 
 Clock, 
 RotateCcw,
 Banknote
} from 'lucide-react';
import { SaleRecord, Medicine } from '../types';
import { todayLocalKey, isSameLocalDay } from '../utils/dayKey';
import { computeCustomerBalances, UNNAMED_CUSTOMER } from '../domain/finance/customerCredit';

interface LedgerTabProps {
  salesLogs?: SaleRecord[];
  medicines?: Medicine[];
  lang?: 'en' | 'ar';
  triggerToast?: (msg: string, type: 'success' | 'info' | 'error') => void;
  /** P1 #4 — append-only customer settlement writer (RootNavigator). */
  onRecordPayment?: (customerName: string, amountPaid: number, note?: string) => Promise<boolean>;
  /** P2 #13 — refund/return writer (RootNavigator): validates via buildRefund,
   *  writes the REFUND ledger row + compensating stock in one atomic batch. */
  onProcessRefund?: (sale: SaleRecord, returnQtys: Record<string, number>, reason?: string) => Promise<boolean>;
}

export default function LedgerTab({ salesLogs = [], medicines = [], lang = 'en', triggerToast, onRecordPayment, onProcessRefund }: LedgerTabProps) {
  const [filter, setFilter] = useState<'all' | 'Paid' | 'Pending' | 'Refunded'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentCustomer, setPaymentCustomer] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  // P2 #13 — refund modal state: the sale being returned, per-medId return
  // quantities, and an optional reason for the audit trail.
  const [refundSale, setRefundSale] = useState<SaleRecord | null>(null);
  const [refundQtys, setRefundQtys] = useState<Record<string, number>>({});
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  // Combine real salesLogs if available. Settlements (append-only
  // CREDIT_SETTLEMENT rows) render as their own payment transactions;
  // refunds (append-only REFUND rows) render as negative reversals.
  const realTransactions = (salesLogs || []).map((sale, idx) => {
  const isSettlement = sale.type === 'CREDIT_SETTLEMENT';
  const isRefund = sale.type === 'REFUND';
  return {
  id: sale.saleId || `TX-${1000 + idx}`,
  customer: sale.customerName || (isSettlement ? UNNAMED_CUSTOMER : (lang === 'ar' ? 'عميل مباشر' : 'Direct Customer')),
  date: sale.timestamp ? new Date(sale.timestamp).toLocaleString() : '2026-07-30',
  amount: isSettlement ? (sale.amountPaid || 0) : (sale.totalRevenue || 0),
  status: sale.status || 'Paid',
  type: isRefund
  ? (lang === 'ar' ? 'مرتجع عميل' : 'Customer Return')
  : isSettlement
  ? (lang === 'ar' ? 'دفعة عميل' : 'Customer Payment')
  : (lang === 'ar' ? 'بيع نقاط بيع' : 'POS Sale'),
  itemsCount: sale.items?.length || 1,
  sale
  };
  });

 const transactions = realTransactions;

 const filteredTransactions = transactions.filter(tx => {
 const matchesFilter = filter === 'all' || tx.status === filter;
 const matchesSearch = tx.customer.toLowerCase().includes(searchQuery.toLowerCase()) || 
 tx.id.toLowerCase().includes(searchQuery.toLowerCase());
 return matchesFilter && matchesSearch;
 });

  // Financial Summary Totals — aggregated from raw salesLogs (ISO timestamps).
  // Daily boundaries go through the shared LOCAL-date utility: timestamps are
  // stored as UTC ISO strings, so slicing the UTC date would misattribute
  // sales made between local 00:00–02:59 (UTC+3) to the previous day.
  const todayKey = todayLocalKey();
  // ONE transaction population for مبيعات اليوم and ربح اليوم: ALL of
  // today's sales, cash and credit alike. Credit exposure is tracked
  // separately by the all-time receivables card below.
  const todaysSales = (salesLogs || []).filter(s => isSameLocalDay(s.timestamp, todayKey));

  const totalDailySales = todaysSales
  .reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);

 // Net profit today: revenue − known batch acquisition cost (snapshotted at sale time).
 const todayProfit = todaysSales
 .reduce((sum, s) => sum + (Number(s.totalProfit) || 0), 0);

  // P2 #13 — refunds now flow as append-only REFUND ledger rows (negative
  // amounts). Sum their magnitude for the Refunds & Adjustments card.
  const totalRefunds = (salesLogs || [])
  .filter(s => s.type === 'REFUND')
  .reduce((sum, s) => sum + Math.abs(Number(s.totalRevenue) || 0), 0);

 // P1 #4 — receivables with settlements applied. The Outstanding Debt card
 // shows what is STILL owed (billed credit sales minus recorded payments);
 // append-only settlement rows never rewrite the original sales.
 const customerBalances = React.useMemo(
 () => computeCustomerBalances(salesLogs as any[]),
 [salesLogs]
 );
 const totalOutstandingDebt = customerBalances.reduce((s, b) => s + b.outstanding, 0);

 return (
 <div className="flex-1 bg-[#F4F7F5] min-h-screen p-4 lg:p-8 space-y-6 font-sans">
 {/* Header */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-brand-100 shadow-sm rounded-xl p-6">
 <div>
 <h1 className="text-2xl font-black text-brand-950 tracking-tight flex items-center gap-2">
 <Receipt className="w-6 h-6 text-[#047857]" />
 {lang === 'ar' ? 'السجل المالي والحركات' : 'Financial Ledger & Transactions'}
 </h1>
 <p className="text-xs text-slate-500 mt-1">
 {lang === 'ar' ? 'تتبع المبيعات اليومية، الديون المستحقة، وحركات التدوين المالي' : 'Track daily sales, pending accounts, and transaction audit trails'}
 </p>
 </div>
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 {/* Daily Sales */}
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-5 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'مبيعات اليوم' : "Today's Sales"}
 </span>
 <div className="p-2 rounded-lg bg-brand-50 text-[#047857]">
 <TrendingUp className="w-5 h-5" />
 </div>
 </div>
 <div className="text-2xl font-black text-slate-900 font-mono">
 {totalDailySales.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
 </div>
  <div className="flex items-center gap-1.5 text-xs text-[#047857] font-semibold">
  <ArrowUpRight className="w-4 h-4" />
  <span>{lang === 'ar' ? 'مبيعات نقدية وآجلة' : 'Cash + credit sales'}</span>
  </div>
 </div>

 {/* Net Profit Today */}
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-5 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'ربح اليوم الصافي' : "Today's Net Profit"}
 </span>
 <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
 <TrendingUp className="w-5 h-5" />
 </div>
 </div>
 <div className="text-2xl font-black text-emerald-700 font-mono">
 {todayProfit.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
 </div>
 <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
 <span>{lang === 'ar' ? 'الإيراد ناقص كلفة الشراء' : 'Revenue minus acquisition cost'}</span>
 </div>
 </div>

 {/* Outstanding Debt */}
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-5 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'الديون والذمم المستحقة' : 'Outstanding Debt'}
 </span>
 <div className="p-2 rounded-lg bg-amber-50 text-amber-700">
 <CreditCard className="w-5 h-5" />
 </div>
 </div>
 <div className="text-2xl font-black text-slate-900 font-mono">
 {totalOutstandingDebt.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
 </div>
 <div className="flex items-center gap-1.5 text-xs text-amber-700 font-semibold">
 <Clock className="w-4 h-4" />
 <span>{lang === 'ar' ? 'بانتظار التحصيل' : 'Pending Settlement'}</span>
 </div>
 </div>

 {/* Outstanding Payments / Refunds */}
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-5 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'المرتجعات والتسويات' : 'Refunds & Adjustments'}
 </span>
 <div className="p-2 rounded-lg bg-rose-50 text-rose-700">
 <AlertCircle className="w-5 h-5" />
 </div>
 </div>
 <div className="text-2xl font-black text-slate-900 font-mono">
 {totalRefunds.toLocaleString()} <span className="text-xs text-slate-500 font-normal">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
 </div>
 <div className="flex items-center gap-1.5 text-xs text-rose-700 font-semibold">
 <RotateCcw className="w-4 h-4" />
 <span>{lang === 'ar' ? 'تسويات ومسترجعات' : 'Processed Adjustments'}</span>
 </div>
 </div>
 </div>

 {/* Customer Accounts (P1 #3/#4): who owes what, record payments */}
 {customerBalances.length > 0 && (
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-6 space-y-4">
 <div className="flex items-center gap-2 pb-2 border-b border-brand-50">
 <Banknote className="w-4 h-4 text-amber-600" />
 <h3 className="text-sm font-black text-slate-900">
 {lang === 'ar' ? 'حسابات العملاء (آجل)' : 'Customer Accounts (Credit)'}
 </h3>
 </div>
 <div className="space-y-3">
 {customerBalances.map(b => (
 <div key={b.customerName} className="border border-brand-100 rounded-xl p-4 space-y-2">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
 <div>
 <span className="font-bold text-slate-900 text-sm">{b.customerName}</span>
 <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
 {lang === 'ar'
 ? `فواتير ${b.billedTotal.toLocaleString()} ل.س — مسدد ${b.settledTotal.toLocaleString()} ل.س`
 : `Billed ${b.billedTotal.toLocaleString()} SYP — settled ${b.settledTotal.toLocaleString()} SYP`}
 </span>
 </div>
 <div className="flex items-center gap-3">
 <span className={`font-black font-mono text-lg ${b.outstanding > 0 ? 'text-amber-700' : 'text-[#047857]'}`}>
 {b.outstanding.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">SYP</span>
 </span>
 {onRecordPayment && b.outstanding > 0 && (
 <button
 id={`btn-record-payment-${b.customerName.replace(/\s+/g, '-')}`}
 onClick={() => {
 setPaymentCustomer(paymentCustomer === b.customerName ? null : b.customerName);
 setPaymentAmount(String(b.outstanding));
 }}
 className="px-3 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
 >
 {lang === 'ar' ? 'تسجيل دفعة' : 'Record Payment'}
 </button>
 )}
 </div>
 </div>

 {paymentCustomer === b.customerName && onRecordPayment && (
 <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-brand-50">
 <input
 id="input-payment-amount"
 type="number"
 min="1"
 value={paymentAmount}
 onChange={(e) => setPaymentAmount(e.target.value)}
 placeholder={lang === 'ar' ? 'المبلغ (ل.س)' : 'Amount (SYP)'}
 className="flex-1 px-3 py-2 bg-[#F4F7F5] border border-brand-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#047857]"
 />
 <input
 id="input-payment-note"
 type="text"
 placeholder={lang === 'ar' ? 'ملاحظة (اختياري)' : 'Note (optional)'}
 className="flex-1 px-3 py-2 bg-[#F4F7F5] border border-brand-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#047857]"
 />
 <button
 id="btn-confirm-payment"
 disabled={paymentBusy || !(Number(paymentAmount) > 0)}
 onClick={async () => {
 setPaymentBusy(true);
 try {
 const ok = await onRecordPayment(b.customerName, Number(paymentAmount));
 if (ok) {
 setPaymentCustomer(null);
 setPaymentAmount('');
 }
 } finally {
 setPaymentBusy(false);
 }
 }}
 className="px-4 py-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
 >
 {paymentBusy ? '...' : (lang === 'ar' ? 'تأكيد الدفعة' : 'Confirm Payment')}
 </button>
 </div>
 )}
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Transaction Table Section */}
 <div className="bg-white border border-brand-100 shadow-sm rounded-xl p-6 space-y-4">
 {/* Table Filters & Search */}
 <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-2 border-b border-brand-50">
 <div className="relative w-full sm:w-72">
 <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
 <input
 type="text"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder={lang === 'ar' ? 'البحث بالعميل أو رقم الحركة...' : 'Search client or invoice #...'}
 className="w-full pl-9 pr-4 py-2 bg-[#F4F7F5] border border-brand-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#047857]"
 dir={lang === 'ar' ? 'rtl' : 'ltr'}
 />
 </div>

 <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
 <Filter className="w-4 h-4 text-slate-400 shrink-0" />
  {/* P2 #13: Refunded filter is live — full/partial refunds flip or flag sale rows */}
  {(['all', 'Paid', 'Refunded'] as const).map((status) => (
  <button
  key={status}
  onClick={() => setFilter(status)}
  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
  filter === status
  ? 'bg-brand-700 text-white shadow-xs'
  : 'bg-brand-50 text-slate-700 hover:bg-brand-100 border border-brand-100'
  }`}
  >
  {status === 'all' && (lang === 'ar' ? 'الكل' : 'All')}
  {status === 'Paid' && (lang === 'ar' ? 'مدفوع' : 'Paid')}
  {status === 'Refunded' && (lang === 'ar' ? 'مرتجع' : 'Refunded')}
  </button>
  ))}
 </div>
 </div>

 {/* Transactions List */}
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
 <thead>
 <tr className="border-b border-brand-100 text-slate-500 font-mono uppercase text-[10px]">
 <th className="py-3 px-3">{lang === 'ar' ? 'رقم الحركة' : 'Invoice #'}</th>
 <th className="py-3 px-3">{lang === 'ar' ? 'العميل / الجهة' : 'Client / Entity'}</th>
 <th className="py-3 px-3">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
 <th className="py-3 px-3">{lang === 'ar' ? 'نوع العملية' : 'Type'}</th>
 <th className="py-3 px-3 text-right">{lang === 'ar' ? 'المبلغ' : 'Amount'}</th>
  <th className="py-3 px-3 text-center">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
  <th className="py-3 px-3 text-center">{lang === 'ar' ? 'إجراء' : 'Action'}</th>
  </tr>
 </thead>
 <tbody className="divide-y divide-brand-50 text-slate-800 font-medium">
 {filteredTransactions.map((tx) => (
 <tr key={tx.id} className="hover:bg-brand-50/30 transition-colors">
 <td className="py-3.5 px-3 font-mono font-bold text-[#047857]">{tx.id}</td>
 <td className="py-3.5 px-3 font-semibold text-slate-900">{tx.customer}</td>
 <td className="py-3.5 px-3 text-slate-500 font-mono text-[11px]">{tx.date}</td>
 <td className="py-3.5 px-3 text-slate-600">{tx.type}</td>
 <td className="py-3.5 px-3 text-right font-mono font-black text-slate-900">
 {tx.amount.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
 </td>
 <td className="py-3.5 px-3 text-center">
 {tx.status === 'Paid' && (
 <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-brand-50 text-[#047857] border border-brand-200 rounded-full font-bold text-[10px]">
 <CheckCircle2 className="w-3 h-3 text-[#047857]" />
 {lang === 'ar' ? 'مدفوع' : 'Paid'}
 </span>
 )}
 {tx.status === 'Pending' && (
 <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-bold text-[10px]">
 <Clock className="w-3 h-3 text-amber-600" />
 {lang === 'ar' ? 'معلق' : 'Pending'}
 </span>
 )}
  {tx.status === 'Refunded' && (
  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full font-bold text-[10px]">
  <RotateCcw className="w-3 h-3 text-rose-600" />
  {lang === 'ar' ? 'مرتجع' : 'Refunded'}
  </span>
  )}
  </td>
  <td className="py-3.5 px-3 text-center">
  {/* P2 #13 — Return action on real POS sales (rows with no ledger type) that still have returnable units */}
  {!tx.sale.type && onProcessRefund && (() => {
  const sale = tx.sale as SaleRecord;
  const returnable = (sale.items || []).reduce(
  (s, i) => s + Math.max(0, (Number(i.quantitySold) || 0) - (Number(sale.refundedQty?.[i.medId]) || 0)),
  0
  );
  if (returnable <= 0) return null;
  return (
  <button
  onClick={() => {
  setRefundSale(sale);
  setRefundQtys({});
  setRefundReason('');
  }}
  className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg font-bold text-[10px] hover:bg-rose-100 transition-colors cursor-pointer"
  >
  <RotateCcw className="w-3 h-3" />
  {lang === 'ar' ? 'إرجاع' : 'Return'}
  </button>
  );
  })()}
  </td>
  </tr>
  ))}
  {filteredTransactions.length === 0 && (
  <tr>
  <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">
  {lang === 'ar' ? 'لا توجد حركات تسوية مطابقة للبحث' : 'No transaction records found.'}
  </td>
  </tr>
  )}
  </tbody>
  </table>
  </div>
  </div>

  {/* P2 #13 — Refund modal: per-item return quantities + reason */}
  {refundSale && onProcessRefund && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" onClick={() => !refundBusy && setRefundSale(null)}>
  <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md" onClick={e => e.stopPropagation()}>
  <div className="p-5 border-b border-slate-100">
  <h3 className="font-black text-slate-900 flex items-center gap-2">
  <RotateCcw className="w-4 h-4 text-rose-600" />
  {lang === 'ar' ? 'تسجيل مرتجع' : 'Record Return'} — <span className="font-mono text-xs text-slate-500">{refundSale.saleId}</span>
  </h3>
  <p className="text-xs text-slate-500 mt-1">
  {lang === 'ar' ? 'تُحدَّد قيمة الاسترداد من سعر البيع الأصلي.' : 'Refund amounts use the original sale prices.'}
  </p>
  </div>
  <div className="p-5 space-y-3 max-h-72 overflow-y-auto">
  {(refundSale.items || []).map(item => {
  const sold = Number(item.quantitySold) || 0;
  const already = Number(refundSale.refundedQty?.[item.medId]) || 0;
  const remaining = Math.max(0, sold - already);
  const qty = refundQtys[item.medId] || 0;
  return (
  <div key={item.medId} className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border ${remaining === 0 ? 'bg-slate-50 border-slate-100 opacity-60' : 'border-slate-200'}`}>
  <div className="min-w-0">
  <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
  <p className="text-[10px] text-slate-500 font-mono">
  {sold} {lang === 'ar' ? 'مبيع' : 'sold'} × {(Number(item.priceAtSale) || 0).toLocaleString()}
  {already > 0 && ` · ${already} ${lang === 'ar' ? 'مرتجع سابقاً' : 'already returned'}`}
  </p>
  </div>
  {remaining > 0 ? (
  <input
  type="number"
  min={0}
  max={remaining}
  value={qty === 0 ? '' : qty}
  onChange={e => {
  const v = Math.max(0, Math.min(remaining, Math.floor(Number(e.target.value) || 0)));
  setRefundQtys(prev => ({ ...prev, [item.medId]: v }));
  }}
  className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-300"
  dir="ltr"
  />
  ) : (
  <span className="text-[10px] font-bold text-slate-400">{lang === 'ar' ? 'مكتمل' : 'Done'}</span>
  )}
  </div>
  );
  })}
  <input
  type="text"
  value={refundReason}
  onChange={e => setRefundReason(e.target.value)}
  placeholder={lang === 'ar' ? 'السبب (اختياري) — تلف، خطأ صرف…' : 'Reason (optional) — damaged, wrong item…'}
  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-rose-300"
  />
  <div className="flex justify-between text-xs font-black text-slate-900 border-t border-slate-100 pt-3">
  <span>{lang === 'ar' ? 'إجمالي الاسترداد' : 'Refund total'}</span>
  <span className="font-mono text-rose-700">
  {(refundSale.items || []).reduce((s, i) => s + (Number(refundQtys[i.medId]) || 0) * (Number(i.priceAtSale) || 0), 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
  </span>
  </div>
  </div>
  <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
  <button onClick={() => setRefundSale(null)} disabled={refundBusy} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-lg border border-slate-200 cursor-pointer disabled:opacity-50">
  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
  </button>
  <button
  onClick={async () => {
  setRefundBusy(true);
  const ok = await onProcessRefund(refundSale, refundQtys, refundReason);
  setRefundBusy(false);
  if (ok) setRefundSale(null);
  }}
  disabled={refundBusy || Object.values(refundQtys).every(v => !v)}
  className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {refundBusy ? (lang === 'ar' ? 'جارٍ التسجيل…' : 'Recording…') : (lang === 'ar' ? 'تأكيد الإرجاع' : 'Confirm Return')}
  </button>
  </div>
  </div>
  </div>
  )}
  </div>
  );
}
