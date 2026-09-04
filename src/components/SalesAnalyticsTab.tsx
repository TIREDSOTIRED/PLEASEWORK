import React from 'react';
import { motion } from 'motion/react';
import { Activity, Receipt, TrendingUp, DollarSign, AlertTriangle } from 'lucide-react';
import { useAuth } from '../application/auth/AuthContext';
import { localDateKey, todayLocalKey, isSameLocalDay } from '../utils/dayKey';

interface SalesAnalyticsTabProps {
 lang: 'en' | 'ar';
 salesLogs: any[];
}

export default function SalesAnalyticsTab({ lang, salesLogs = [] }: SalesAnalyticsTabProps) {
 const { currentSession } = useAuth();
 
  // Local-date boundary via the shared utility. Timestamps are UTC ISO —
  // slicing the UTC date misattributes local 00:00–02:59 sales (UTC+3).
  const todayStr = todayLocalKey();
  const todaysSales = (salesLogs || []).filter(log => isSameLocalDay(log.timestamp, todayStr));

 const totalRevenue = todaysSales.reduce((sum, s) => sum + s.totalRevenue, 0);
 const totalProfit = todaysSales.reduce((sum, s) => sum + s.totalProfit, 0);

 // Cost transparency: sales whose batch cost was never recorded make profit
 // an upper bound. Surface the count instead of hiding it.
 const unknownCostCount = todaysSales.reduce(
 (sum, s) => sum + ((s.items || []) as any[]).filter(it => it.costEstimated).length,
 0
 );
 const knownCostTotal = todaysSales.reduce(
 (sum, s) => sum + ((s.items || []) as any[]).reduce(
 (c: number, it: any) => c + (it.costEstimated ? 0 : (Number(it.quantitySold) || 0) * (Number(it.costAtSale) || 0)),
 0
 ),
 0
 );

  // ---- Last 14 days: revenue & profit per local day (for the trend chart) ----
  const last14 = Array.from({ length: 14 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (13 - i));
  return { key: localDateKey(d), label: String(d.getDate()), revenue: 0, profit: 0 };
  });
  const byDay = new Map(last14.map(d => [d.key, d]));
  for (const s of (salesLogs || [])) {
  const k = localDateKey(s.timestamp);
  const bucket = k ? byDay.get(k) : undefined;
 if (bucket) {
 bucket.revenue += Number(s.totalRevenue) || 0;
 bucket.profit += Number(s.totalProfit) || 0;
 }
 }
 const maxDay = Math.max(1, ...last14.map(d => d.revenue));

 // ---- Top-5 movers over the same 14 days ----
 const moverMap = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const s of (salesLogs || [])) {
  const saleDay = localDateKey(s.timestamp);
  if (!saleDay || saleDay < last14[0].key) continue;
 for (const it of (s.items || []) as any[]) {
 const cur = moverMap.get(it.medId) || { name: it.name, qty: 0, revenue: 0 };
 cur.qty += Number(it.quantitySold) || 0;
 cur.revenue += (Number(it.quantitySold) || 0) * (Number(it.priceAtSale) || 0);
 moverMap.set(it.medId, cur);
 }
 }
 const topMovers = [...moverMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
 const maxMoverRevenue = Math.max(1, ...topMovers.map(m => m.revenue));

 return (
 <div className="space-y-6 bg-[#F4F7F5] min-h-[calc(100vh-4rem)] pb-12 font-sans -m-6 p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
 {/* Header */}
 <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-brand-100 shadow-sm">
 <div>
 <h1 className="text-2xl font-bold text-brand-950 flex items-center gap-2">
 <Activity className="w-6 h-6 text-brand-700" />
 {lang === 'ar' ? 'المبيعات والتحليلات' : 'Sales & Analytics'}
 </h1>
 <p className="text-sm text-slate-500 mt-1">
 {lang === 'ar' ? 'مراجعة أداء المبيعات وسجل الفواتير اليومية' : 'Review sales performance and daily chronological receipts journal'}
 </p>
 </div>
 </div>

 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 className="space-y-6"
 >
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div className="p-4 bg-white border border-brand-100 rounded-xl shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <div className="p-1.5 bg-brand-100 text-brand-700 rounded-lg">
 <DollarSign className="w-4 h-4" />
 </div>
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'إجمالي المبيعات اليوم' : "TODAY'S TOTAL REVENUE"}
 </span>
 </div>
 <span className="text-3xl font-black text-brand-950 font-mono block">
 {(Number(totalRevenue) || 0).toLocaleString()} <span className="text-sm text-brand-600">SYP</span>
 </span>
 </div>
 <div className="p-4 bg-white border border-brand-100 rounded-xl shadow-sm">
 <div className="flex items-center gap-2 mb-2">
 <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
 <TrendingUp className="w-4 h-4" />
 </div>
 <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'إجمالي الأرباح الصافية اليوم' : "TODAY'S NET PROFIT"}
 </span>
 </div>
 <span className="text-3xl font-black text-indigo-950 font-mono block">
 {(Number(totalProfit) || 0).toLocaleString()} <span className="text-sm text-brand-600">SYP</span>
 </span>
 </div>

 {/* Cost transparency strip */}
 {unknownCostCount > 0 && (
 <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] font-semibold text-amber-800 flex items-start gap-2">
 <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
 <span>
 {lang === 'ar'
 ? `تنبيه: ${unknownCostCount} صنف بدون تكلفة مسجلة — الربح الظاهر حدّ أعلى تقديري.`
 : `${unknownCostCount} sold item(s) have no recorded cost — displayed profit is an upper bound.`}
 </span>
 </div>
 )}
 </div>

 {/* 14-Day Trend Chart */}
 <div className="bg-white border border-brand-100 rounded-xl shadow-sm p-4">
 <div className="flex items-center justify-between mb-3">
 <span className="text-xs font-bold text-slate-600 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'آخر ١٤ يوم — المبيعات والربح' : 'LAST 14 DAYS — REVENUE & PROFIT'}
 </span>
 <div className="flex items-center gap-3 text-[10px] font-bold">
 <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-brand-600 inline-block" />{lang === 'ar' ? 'مبيعات' : 'Revenue'}</span>
 <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />{lang === 'ar' ? 'ربح' : 'Profit'}</span>
 </div>
 </div>
 <svg viewBox="0 0 560 170" className="w-full" dir="ltr">
 {last14.map((d, i) => {
 const x = 14 + i * 39;
 const rh = Math.round((d.revenue / maxDay) * 120);
 const ph = Math.round((Math.max(0, d.profit) / maxDay) * 120);
 const isToday = d.key === todayStr;
 return (
 <g key={d.key}>
 {/* revenue bar (right of pair — RTL visual: latest on left is avoided; chronological left→right) */}
 <rect x={x} y={140 - rh} width={13} height={rh} rx={2.5}
 className={d.revenue > 0 ? 'fill-brand-600' : 'fill-slate-200'} />
 {/* profit bar */}
 <rect x={x + 15} y={140 - ph} width={13} height={ph} rx={2.5}
 className={d.profit > 0 ? 'fill-indigo-500' : 'fill-slate-200'} />
 <text x={x + 14} y={158} textAnchor="middle"
 className={isToday ? 'fill-brand-700 font-black' : 'fill-slate-400'}
 style={{ fontSize: 10 }}>{d.label}</text>
 </g>
 );
 })}
 <line x1="8" y1="140.5" x2="552" y2="140.5" className="stroke-slate-200" />
 </svg>
 </div>

 {/* Top Movers */}
 {topMovers.length > 0 && (
 <div className="bg-white border border-brand-100 rounded-xl shadow-sm overflow-hidden">
 <div className="p-4 border-b border-brand-100 bg-slate-50/50 flex items-center gap-2">
 <TrendingUp className="w-4 h-4 text-slate-500" />
 <span className="text-xs font-bold text-slate-600 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'الأكثر حركة — آخر ١٤ يوم' : 'TOP MOVERS — LAST 14 DAYS'}
 </span>
 </div>
 <div className="divide-y divide-brand-50">
 {topMovers.map((m, i) => (
 <div key={m.name} className="p-3.5 flex items-center gap-3">
 <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center font-black text-xs ${
 i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
 }`}>{i + 1}</span>
 <div className="min-w-0 flex-1">
 <div className="text-sm font-bold text-slate-800 truncate">{m.name}</div>
 <div className="h-1.5 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
 <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (m.revenue / maxMoverRevenue) * 100)}%` }} />
 </div>
 </div>
 <div className="text-left shrink-0">
 <span className="block text-sm font-black text-brand-900 font-mono">{m.revenue.toLocaleString()}</span>
 <span className="block text-[10px] text-slate-400 font-bold">{lang === 'ar' ? `${m.qty} علبة` : `${m.qty} units`}</span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 <div className="bg-white border border-brand-100 rounded-xl shadow-sm overflow-hidden">
 <div className="p-4 border-b border-brand-100 bg-slate-50/50 flex items-center gap-2">
 <Receipt className="w-4 h-4 text-slate-500" />
 <span className="text-xs font-bold text-slate-600 uppercase tracking-wider font-mono">
 {lang === 'ar' ? 'سجل الفواتير والمقبوضات الصادرة اليوم' : "TODAY'S CHRONOLOGICAL RECEIPTS JOURNAL"} ({todaysSales.length})
 </span>
 </div>
 
 {todaysSales.length === 0 ? (
 <div className="py-12 text-center">
 <Receipt className="w-12 h-12 text-slate-200 mx-auto mb-3" />
 <p className="text-sm font-bold text-slate-500">
 {lang === 'ar' ? 'لا توجد مبيعات مسجلة اليوم حتى الآن.' : 'No transactions recorded today.'}
 </p>
 </div>
 ) : (
 <div className="divide-y divide-brand-50">
 {todaysSales.map((sale: any) => (
 <div
 key={sale.saleId}
 className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
 >
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap mb-1">
 <span className="font-extrabold text-brand-900 font-mono text-sm bg-brand-50 px-2 py-0.5 rounded">
 #{sale.saleId.slice(-6).toUpperCase()}
 </span>
 <span className="text-xs font-bold text-slate-400 font-mono">
 {new Date(sale.timestamp).toLocaleTimeString(lang === 'ar' ? 'ar-SY' : 'en-US')}
 </span>
 </div>
 <div className="text-xs text-slate-600 font-medium">
 {sale.items.map((i: any) => `${i.name} (${i.quantitySold})`).join(', ')}
 </div>
 </div>
 
 <div className="flex items-center gap-4 shrink-0 bg-slate-50/80 p-2 rounded-lg border border-slate-100">
 <div className="text-right">
 <span className="text-[10px] text-slate-400 font-bold block leading-none mb-1">{lang === 'ar' ? 'المبيعات' : 'REVENUE'}</span>
 <span className="font-black text-brand-900 font-mono text-sm">{(Number(sale.totalRevenue) || 0).toLocaleString()} <span className="text-[10px] text-brand-600">SYP</span></span>
 </div>
 <div className="border-l border-slate-200 h-8 shrink-0" />
 <div className="text-right">
 <span className="text-[10px] text-slate-400 font-bold block leading-none mb-1">{lang === 'ar' ? 'الربح' : 'PROFIT'}</span>
 <span className="font-black text-indigo-700 font-mono text-sm">{(Number(sale.totalProfit) || 0).toLocaleString()} <span className="text-[10px] text-brand-600">SYP</span></span>
 </div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 </motion.div>
 </div>
 );
}
