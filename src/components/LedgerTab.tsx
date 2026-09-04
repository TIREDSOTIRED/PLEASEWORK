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
 RotateCcw 
} from 'lucide-react';
import { SaleRecord, Medicine } from '../types';
import { todayLocalKey, isSameLocalDay } from '../utils/dayKey';

interface LedgerTabProps {
 salesLogs?: SaleRecord[];
 medicines?: Medicine[];
 lang?: 'en' | 'ar';
 triggerToast?: (msg: string, type: 'success' | 'info' | 'error') => void;
}

export default function LedgerTab({ salesLogs = [], medicines = [], lang = 'en', triggerToast }: LedgerTabProps) {
 const [filter, setFilter] = useState<'all' | 'Paid' | 'Pending' | 'Refunded'>('all');
 const [searchQuery, setSearchQuery] = useState('');

 // Sample or real transactions derived from salesLogs / mock transactions
 

 // Combine real salesLogs if available
 const realTransactions = (salesLogs || []).map((sale, idx) => ({
 id: sale.saleId || `TX-${1000 + idx}`,
 customer: (sale as any).buyerPharmacyId || (lang === 'ar' ? 'عميل مباشر' : 'Direct Customer'),
 date: sale.timestamp ? new Date(sale.timestamp).toLocaleString() : '2026-07-30',
 amount: sale.totalRevenue || 0,
 status: (sale as any).status || 'Paid',
 type: 'POS Sale',
 itemsCount: sale.items?.length || 1
 }));

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

 const totalOutstandingDebt = (salesLogs || [])
 .filter(s => s.status === 'Pending')
 .reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);

 const totalRefunds = 0; // No refund flow records status 'Refunded' yet — honest zero.

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
  {/* Pending/Refunded hidden: SaleRecord has no status field yet — only completed POS sales exist */}
  {(['all', 'Paid'] as const).map((status) => (
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
 </tr>
 ))}
 {filteredTransactions.length === 0 && (
 <tr>
 <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
 {lang === 'ar' ? 'لا توجد حركات تسوية مطابقة للبحث' : 'No transaction records found.'}
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
}
