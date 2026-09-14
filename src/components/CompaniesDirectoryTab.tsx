import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useCatalog, MappedMedicine, mapMedicine } from '../context/CatalogContext';
import { 
  getUniqueCompaniesLocal, 
  searchLocalMeds, 
  countLocalMeds 
} from '../services/syncEngine';
import {
  Building2, Camera, Search, Package, FlaskConical, Barcode,
  ArrowRightLeft, X, ChevronRight, Pill,
  ShoppingCart, Check, ArrowLeft, Info, Eye, Copy,
  CheckCircle2, ChevronLeft, ShieldCheck,
  Stethoscope, Hash, Tag, Layers, ArrowUpRight, PackagePlus
} from 'lucide-react';
import { Skeleton } from './ui/Skeleton';

interface CompaniesDirectoryTabProps {
  lang?: 'en' | 'ar';
  triggerToast?: (msg: string, type: 'error' | 'info' | 'success') => void;
  onOpenScanner?: () => void;
  onNavigateToPOS?: () => void;
  /** Warehouse-only: start private inventory intake from a catalog medicine. */
  onStartIntake?: (catalogItem: any) => void;
}

export interface CompanyInfo {
  id: string;
  name: string;
  count?: number;
}

// Clean manufacturer names for display
function normalizeManufacturer(raw: string) {
  const clean = (raw || '').trim();
  let normalizedKey = clean.toLowerCase();
  
  normalizedKey = normalizedKey.replace(/[.,\/#!$%\^&\*;:{}=\-_~()]/g, " ");
  normalizedKey = normalizedKey.replace(/\b(pharma|pharmaceuticals|laboratories|laboratory|labs|ltd|inc|co|company|s\.?a\.?r\.?l\.?|llc|s\.?a\.?)\b/gi, ' ');
  normalizedKey = normalizedKey.replace(/\s+/g, ' ').trim();

  if (!normalizedKey) {
    normalizedKey = clean.toLowerCase().replace(/\s+/g, ' ').trim() || 'unknown';
  }

  const displayParts = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1));
  const displayName = displayParts.join(' ') || 'Unknown Manufacturer';

  return { key: normalizedKey, displayName };
}

export default function CompaniesDirectoryTab({
  lang = 'ar',
  triggerToast,
  onOpenScanner,
  onNavigateToPOS,
  onStartIntake
}: CompaniesDirectoryTabProps) {
  const { isLoadingCatalog } = useCatalog();

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Company Directory States
  const [dynamicCompanies, setDynamicCompanies] = useState<CompanyInfo[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<CompanyInfo | null>(null);
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [debouncedCompanyQuery, setDebouncedCompanyQuery] = useState('');
  const [isAllCompaniesModalOpen, setIsAllCompaniesModalOpen] = useState(false);
  const [allCompaniesSearch, setAllCompaniesSearch] = useState('');

  // Medicines Directory States
  const [totalMedsCount, setTotalMedsCount] = useState<number>(0);
  const [initialCatalogMeds, setInitialCatalogMeds] = useState<MappedMedicine[]>([]);
  const [isLoadingInitialMeds, setIsLoadingInitialMeds] = useState(true);
  const [searchResults, setSearchResults] = useState<MappedMedicine[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Company Portfolio Medicines
  const [companyPortfolio, setCompanyPortfolio] = useState<MappedMedicine[]>([]);
  const [isLoadingPortfolio, setIsLoadingPortfolio] = useState(false);
  // Sequence token: only the most recently started portfolio fetch may commit
  // results (a slow older company lookup must never overwrite a newer one).
  const portfolioRequestId = useRef(0);

  // Modals: Medicine Detail & Scientific Alternatives
  const [inspectedMedicine, setInspectedMedicine] = useState<MappedMedicine | null>(null);
  const [activeAlternativesMedicine, setActiveAlternativesMedicine] = useState<MappedMedicine | null>(null);
  const [alternativesList, setAlternativesList] = useState<MappedMedicine[]>([]);
  const [isLoadingAlternatives, setIsLoadingAlternatives] = useState(false);

  // Local POS Draft items state
  const [orderedItems, setOrderedItems] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Escape key global listener to close open modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeAlternativesMedicine) {
          setActiveAlternativesMedicine(null);
        } else if (inspectedMedicine) {
          setInspectedMedicine(null);
        } else if (isAllCompaniesModalOpen) {
          setIsAllCompaniesModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectedMedicine, activeAlternativesMedicine, isAllCompaniesModalOpen]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Debounce company search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCompanyQuery(companySearchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [companySearchQuery]);

  // Fetch initial total count and unique companies
  useEffect(() => {
    let isMounted = true;
    const fetchMeta = async () => {
      setIsLoadingCompanies(true);
      try {
        const count = await countLocalMeds();
        if (isMounted) setTotalMedsCount(count);

        const uniqueCompanies = await getUniqueCompaniesLocal();
        const sorted = uniqueCompanies
          .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
          })
          .map(m => ({ id: m.name, name: m.name, count: m.count }));

        if (isMounted) {
          setDynamicCompanies(sorted);
        }
      } catch (err) {
        console.error("Failed to load companies meta:", err);
      } finally {
        if (isMounted) setIsLoadingCompanies(false);
      }
    };

    fetchMeta();
    return () => { isMounted = false; };
  }, []);

  // Fetch initial default catalog medicines (first ~24 items)
  useEffect(() => {
    let isMounted = true;
    const fetchInitial = async () => {
      setIsLoadingInitialMeds(true);
      try {
        const raw = await searchLocalMeds('', 24);
        const mapped = raw.map((item, idx) => mapMedicine(item, idx));
        if (isMounted) {
          setInitialCatalogMeds(mapped);
        }
      } catch (e) {
        console.error("Failed to fetch initial catalog meds:", e);
      } finally {
        if (isMounted) setIsLoadingInitialMeds(false);
      }
    };
    fetchInitial();
    return () => { isMounted = false; };
  }, []);

  // Execute Search for Medicines
  useEffect(() => {
    let isMounted = true;
    const executeSearch = async () => {
      const q = debouncedSearchQuery.trim();
      if (!q) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const rawResults = await searchLocalMeds(q, 48);
        const results = rawResults.map((item, idx) => mapMedicine(item, idx));
        if (isMounted) {
          setSearchResults(results);
        }
      } catch (e) {
        console.error("Search failed:", e);
        if (isMounted) setSearchResults([]);
      } finally {
        if (isMounted) setIsSearching(false);
      }
    };

    executeSearch();
    return () => { isMounted = false; };
  }, [debouncedSearchQuery]);

  // Fetch Company Portfolio when a company is selected
  useEffect(() => {
    let isMounted = true;
    const fetchPortfolio = async () => {
      if (!selectedCompany) {
        setCompanyPortfolio([]);
        setIsLoadingPortfolio(false);
        return;
      }

      setIsLoadingPortfolio(true);
      const requestId = ++portfolioRequestId.current;
      try {
        const q = debouncedCompanyQuery.trim();
        const rawResults = await searchLocalMeds(q, 60, selectedCompany.id);
        if (!isMounted || requestId !== portfolioRequestId.current) return;
        const results = rawResults.map((item, idx) => mapMedicine(item, idx));
        if (isMounted) {
          setCompanyPortfolio(results);
        }
      } catch (e) {
        console.error("Failed to fetch company portfolio:", e);
      } finally {
        if (isMounted && requestId === portfolioRequestId.current) setIsLoadingPortfolio(false);
      }
    };

    fetchPortfolio();
    return () => { isMounted = false; };
  }, [selectedCompany, debouncedCompanyQuery]);

  // Fetch Alternatives when requested
  useEffect(() => {
    let isMounted = true;
    const fetchAlts = async () => {
      if (!activeAlternativesMedicine) {
        setAlternativesList([]);
        setIsLoadingAlternatives(false);
        return;
      }

      const compKey = activeAlternativesMedicine.composition?.trim();
      if (!compKey || compKey === 'GENERAL' || compKey.length < 2) {
        setAlternativesList([]);
        setIsLoadingAlternatives(false);
        return;
      }

      setIsLoadingAlternatives(true);
      try {
        const rawResults = await searchLocalMeds(compKey, 30);
        const results = rawResults.map((item, idx) => mapMedicine(item, idx));
        if (isMounted) {
          // Filter out the active medicine itself
          const filtered = results.filter(item => 
            item.id !== activeAlternativesMedicine.id && 
            item.name.toLowerCase().trim() !== activeAlternativesMedicine.name.toLowerCase().trim()
          );
          setAlternativesList(filtered);
        }
      } catch (e) {
        console.error("Failed to fetch alternatives:", e);
      } finally {
        if (isMounted) setIsLoadingAlternatives(false);
      }
    };

    fetchAlts();
    return () => { isMounted = false; };
  }, [activeAlternativesMedicine]);

  // Add Item to POS Cart (SessionStorage)
  const handleAddToPOS = useCallback((item: MappedMedicine) => {
    try {
      const savedCart = sessionStorage.getItem('eshmun_pos_active_cart');
      const cart = savedCart ? JSON.parse(savedCart) : [];

 const posMedItem = {
 id: item.id || `med_${Date.now()}`,
 name: item.name,
 nameEn: item.name_en,
 barcode: item.barcode,
 batchNumber: item.barcode || item.id,
 price: Number(item.price) || 0,
 // No fabricated cost: real acquisition cost is resolved from batch
 // records at checkout time (utils/cost.ts).
 stock: 50,
 dosageForm: item.form || 'Tablets',
 strength: '',
 manufacturer: item.company || 'Unknown',
 composition_key: item.composition
 };

      const existingIndex = cart.findIndex((c: any) => c.med?.id === item.id || (c.med?.barcode && c.med?.barcode === item.barcode));
      if (existingIndex >= 0) {
        cart[existingIndex].quantity = (cart[existingIndex].quantity || 1) + 1;
      } else {
        cart.push({
          id: `cart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          med: posMedItem,
          quantity: 1,
          isRecentlyAdded: true
        });
      }

      sessionStorage.setItem('eshmun_pos_active_cart', JSON.stringify(cart));
      setOrderedItems(prev => ({ ...prev, [item.id]: true }));

      if (triggerToast) {
        triggerToast(
          lang === 'ar' ? `✓ تمت إضافة (${item.name}) إلى سلة نقطة البيع` : `✓ Added (${item.name}) to POS cart`,
          'success'
        );
      }
    } catch (e) {
      console.error("Error adding to POS:", e);
    }
  }, [lang, triggerToast]);

  // Copy text to clipboard helper
  const handleCopyText = (text: string, keyName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
    if (triggerToast) {
      triggerToast(lang === 'ar' ? 'تم النسخ إلى الحافظة' : 'Copied to clipboard', 'info');
    }
  };

  // Top 8 companies initially displayed
  const topCompanies = useMemo(() => {
    return dynamicCompanies.slice(0, 8);
  }, [dynamicCompanies]);

  // Filtered companies for "All Companies" modal
  const filteredModalCompanies = useMemo(() => {
    const q = allCompaniesSearch.toLowerCase().trim();
    if (!q) return dynamicCompanies;
    return dynamicCompanies.filter(comp => comp.name.toLowerCase().includes(q));
  }, [dynamicCompanies, allCompaniesSearch]);

  // Category filter for medicines
  const categoryFilters = [
    { id: 'ALL', labelAr: 'كافة الأدوية', labelEn: 'All Medicines' },
    { id: 'TABLET', labelAr: 'أقراص وكبسولات', labelEn: 'Tablets & Caps' },
    { id: 'SYRUP', labelAr: 'أشربة وسوائل', labelEn: 'Syrups & Liquids' },
    { id: 'INJ', labelAr: 'حقن وأمبولات', labelEn: 'Injections' },
    { id: 'TOPICAL', labelAr: 'مراهم وجل', labelEn: 'Topicals & Creams' },
    { id: 'DROPS', labelAr: 'قطرات وبخاخات', labelEn: 'Drops & Sprays' },
  ];

  const filterMedByCategory = (med: MappedMedicine) => {
    if (selectedCategory === 'ALL') return true;
    const form = (med.form || '').toLowerCase();
    if (selectedCategory === 'TABLET') return form.includes('tab') || form.includes('cap') || form.includes('قرص') || form.includes('كبسول');
    if (selectedCategory === 'SYRUP') return form.includes('syr') || form.includes('liq') || form.includes('شراب') || form.includes('معلق');
    if (selectedCategory === 'INJ') return form.includes('inj') || form.includes('amp') || form.includes('حقن') || form.includes('امبول');
    if (selectedCategory === 'TOPICAL') return form.includes('cream') || form.includes('oint') || form.includes('gel') || form.includes('مرهم') || form.includes('كريم');
    if (selectedCategory === 'DROPS') return form.includes('drop') || form.includes('spray') || form.includes('قطر') || form.includes('بخاخ');
    return true;
  };

  // Active medicine list based on current state (search vs default browsing)
  const currentMedicinesToDisplay = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      return searchResults.filter(filterMedByCategory);
    }
    return initialCatalogMeds.filter(filterMedByCategory);
  }, [debouncedSearchQuery, searchResults, initialCatalogMeds, selectedCategory]);

  return (
    <div className="space-y-6 bg-[#F8FAFC] min-h-[calc(100vh-4rem)] pb-16 font-sans -m-6 p-4 sm:p-6 lg:p-8" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      
      {/* VIEW 1: HOME CATALOG VIEW (When no specific company portfolio is selected) */}
      {selectedCompany === null && (
        <div className="space-y-8 animate-in fade-in duration-200">
          
          {/* Top Banner & Clinical Search Area */}
          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-sm border border-slate-200/80 relative overflow-hidden">
            {/* Background Medical Watermark */}
            <div className="absolute right-0 top-0 bottom-0 opacity-[0.03] pointer-events-none flex items-center pr-6 overflow-hidden">
              <Pill className="w-80 h-80 text-brand-900 stroke-[1]" />
            </div>

            <div className="relative z-10 max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-800 border border-brand-200/70 text-xs font-bold uppercase tracking-wider">
                <Stethoscope className="w-3.5 h-3.5 text-brand-700" />
                <span>{lang === 'ar' ? 'الدليل الدوائي والكتالوج الطبي' : 'Clinical Medicine Directory'}</span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-slate-900">
                {lang === 'ar' ? 'دليل الأدوية والبدائل العلمية' : 'Pharmaceutical & Bio-Equivalents Index'}
              </h1>
              
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed max-w-2xl">
                {lang === 'ar'
                  ? 'مرجع طبي شامل للبحث الفوري بالاسم التجاري، العلمي، الشركة المصنعة، أو الباركود، مع استعراض البدائل المتكافئة دوائياً.'
                  : 'Search trade names, active pharmaceutical ingredients, manufacturers, or scan barcodes to inspect complete clinical profiles and bio-equivalents.'}
              </p>
            </div>

            {/* Prominent Search Bar & Scanner Button */}
            <div className="mt-6 pt-6 border-t border-slate-100 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className={`w-5 h-5 absolute ${lang === 'ar' ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-slate-400`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'ar'
                      ? 'ابحث بالاسم التجاري، المادة الفعالة، اسم الشركة، أو امسح الباركود...'
                      : 'Search by medicine name, active ingredient, manufacturer, or barcode...'
                  }
                  className={`w-full ${lang === 'ar' ? 'pr-12 pl-10' : 'pl-12 pr-10'} py-3.5 rounded-xl bg-slate-50 text-slate-900 text-sm font-semibold border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all shadow-inner`}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={`absolute ${lang === 'ar' ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer`}
                    title={lang === 'ar' ? 'مسح البحث' : 'Clear search'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {onOpenScanner && (
                <button
                  type="button"
                  onClick={onOpenScanner}
                  className="px-4 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white transition-all shadow-sm flex items-center gap-2 font-bold text-xs sm:text-sm shrink-0 cursor-pointer min-h-[48px]"
                  title={lang === 'ar' ? 'ماسح الباركود والكاميرا' : 'Camera Barcode Scanner'}
                >
                  <Camera className="w-4 h-4" />
                  <span className="hidden sm:inline">{lang === 'ar' ? 'مسح باركود' : 'Scan'}</span>
                </button>
              )}
            </div>
          </div>

          {/* SECTION: COMPANIES (Top Manufacturers Directory) */}
          {!searchQuery && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand-100/80 text-brand-800 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900">
                      {lang === 'ar' ? 'أبرز المصانع والشركات الدوائية' : 'Major Pharmaceutical Laboratories'}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {lang === 'ar' ? 'تصفح منتجات ومجموعات المصانع المرخصة' : 'Explore authorized manufacturers and brand portfolios'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsAllCompaniesModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-brand-700 text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  <span>{lang === 'ar' ? 'كافة الشركات' : 'View All'}</span>
                  {lang === 'ar' ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Companies Grid */}
              {isLoadingCompanies ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-200/80 space-y-2">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-xl" />
                        <div className="space-y-1 flex-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-14" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {topCompanies.map((company) => {
                    const initials = company.name.substring(0, 2).toUpperCase();
                    return (
                      <motion.div
                        key={company.id}
                        whileHover={{ y: -2 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => {
                          setSelectedCompany(company);
                          setCompanySearchQuery('');
                        }}
                        className="bg-white border border-slate-200 hover:border-brand-400 hover:shadow-md rounded-xl p-3.5 sm:p-4 transition-all duration-200 flex items-center justify-between group cursor-pointer relative overflow-hidden"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 text-brand-800 font-black text-sm flex items-center justify-center shrink-0 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-xs sm:text-sm font-bold text-slate-800 group-hover:text-brand-700 transition-colors truncate">
                              {company.name}
                            </h3>
                            {company.count !== undefined && (
                              <span className="text-[10px] text-slate-400 font-semibold font-mono">
                                {company.count} {lang === 'ar' ? 'مستحضر' : 'items'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-slate-300 group-hover:text-brand-600 transition-colors shrink-0">
                          {lang === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SECTION: MEDICINES DIRECTORY & SEARCH RESULTS */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-brand-100/80 text-brand-800 flex items-center justify-center">
                  <Pill className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900">
                    {searchQuery 
                      ? (lang === 'ar' ? `نتائج البحث (${currentMedicinesToDisplay.length})` : `Search Results (${currentMedicinesToDisplay.length})`)
                      : (lang === 'ar' ? 'قائمة الأدوية المرجعية' : 'Medicine Master Reference')
                    }
                  </h2>
                  <p className="text-xs text-slate-500">
                    {searchQuery 
                      ? (lang === 'ar' ? `مطابقات البحث عن: "${searchQuery}"` : `Matches for query: "${searchQuery}"`)
                      : (lang === 'ar' ? 'انقر على أي دواء لعرض الملف الطبي والبدائل المتوفرة' : 'Click on any medicine to view complete profile and bio-equivalents')
                    }
                  </p>
                </div>
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
                {categoryFilters.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                      selectedCategory === cat.id
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    {lang === 'ar' ? cat.labelAr : cat.labelEn}
                  </button>
                ))}
              </div>
            </div>

            {/* SKELETON LOADING STATE FOR MEDICINE SEARCH / DIRECTORY */}
            {(isSearching || (isLoadingInitialMeds && !searchQuery)) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white p-5 rounded-lg border border-slate-200 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-lg" />
                    </div>
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Skeleton className="h-8 flex-1 rounded-xl" />
                      <Skeleton className="h-8 w-10 rounded-xl" />
                    </div>
                  </div>
                ))}
              </div>
            ) : currentMedicinesToDisplay.length > 0 ? (
              /* CLEAN, COMPACT MEDICINE CARDS GRID */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {currentMedicinesToDisplay.map((item) => {
                  const rawManufacturer = (item as any).MANUFACTURER || (item as any).manufacturer || (item as any).company_name || item.company || 'Unknown';
                  const { displayName } = normalizeManufacturer(rawManufacturer);
                  const isOrdered = orderedItems[item.id];

                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => setInspectedMedicine(item)}
                      className="bg-white border border-slate-200 hover:border-brand-400 hover:shadow-md rounded-lg p-4 sm:p-5 transition-all duration-200 flex flex-col justify-between group cursor-pointer relative"
                    >
                      {/* Top Row: Name & Price */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-700 transition-colors leading-snug line-clamp-2">
                              {item.name}
                            </h3>
                            {item.name_en && item.name_en !== item.name && (
                              <p className="text-xs font-semibold text-slate-400 mt-0.5 truncate">
                                {item.name_en}
                              </p>
                            )}
                          </div>
                          
                          <div className="shrink-0 bg-brand-50 text-brand-800 border border-brand-200/80 px-2.5 py-1 rounded-xl font-black text-xs sm:text-sm whitespace-nowrap shadow-xs">
                            {Number(item.price || 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
                          </div>
                        </div>

                        {/* Medicine Summary Tags */}
                        <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                          {/* Active Ingredient */}
                          {item.composition && item.composition !== 'GENERAL' && (
                            <div className="flex items-center gap-1.5 text-slate-600">
                              <FlaskConical className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                              <span className="font-semibold text-[11px] truncate" title={item.composition}>
                                {item.composition}
                              </span>
                            </div>
                          )}

                          {/* Company / Manufacturer */}
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-medium text-[11px] truncate">
                              {displayName}
                            </span>
                          </div>

                          {/* Form & Barcode */}
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            {item.form && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-bold">
                                <Pill className="w-3 h-3 text-slate-500" />
                                <span>{item.form}</span>
                              </span>
                            )}
                            {item.barcode && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 text-slate-500 border border-slate-200 rounded-md text-[10px] font-mono">
                                <Barcode className="w-3 h-3" />
                                <span>{item.barcode}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {item.composition && item.composition !== 'GENERAL' ? (
                          <button
                            type="button"
                            onClick={() => setActiveAlternativesMedicine(item)}
                            className="flex-1 py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-brand-50 text-brand-700 border border-slate-200 hover:border-brand-300 transition-all font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                            title={lang === 'ar' ? 'البحث عن البدائل الدوائية' : 'Find Bio-Equivalents'}
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>{lang === 'ar' ? 'البدائل' : 'Equivalents'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setInspectedMedicine(item)}
                            className="flex-1 py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>{lang === 'ar' ? 'التفاصيل' : 'Details'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleAddToPOS(item)}
                          disabled={isOrdered}
                          className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer shadow-xs ${
                            isOrdered
                              ? 'bg-brand-50 text-brand-700 border border-brand-200 cursor-default'
                              : 'bg-brand-600 hover:bg-brand-700 text-white active:scale-95'
                          }`}
                          title={lang === 'ar' ? 'إضافة لسلة البيع' : 'Add to POS Cart'}
                        >
                          {isOrdered ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{lang === 'ar' ? 'أضيف' : 'Added'}</span>
                            </>
                          ) : (
                            <>
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{lang === 'ar' ? 'نقطة البيع' : 'POS'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              /* EMPTY STATE */
              <div className="bg-white rounded-lg border border-slate-200 p-12 text-center space-y-3 shadow-sm">
                <div className="w-14 h-14 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center mx-auto border border-brand-100">
                  <Package className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {lang === 'ar' ? 'لم يتم العثور على أدوية مطابقة' : 'No Matching Medicines Found'}
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {lang === 'ar'
                    ? 'يرجى التحقق من صحة الكلمة المفتاحية، أو محاولة البحث بالاسم العلمي أو مسح الباركود.'
                    : 'Please verify the search query, or try searching by generic ingredient or scanning the barcode.'}
                </p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
                  >
                    {lang === 'ar' ? 'إلغاء تصفية البحث' : 'Clear Search Filter'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: COMPANY PORTFOLIO VIEW (When a specific manufacturer is clicked) */}
      {selectedCompany !== null && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Company Portfolio Header Card */}
          <div className="bg-white border border-slate-200 shadow-sm rounded-lg p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <button
                onClick={() => setSelectedCompany(null)}
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-700 text-slate-700 flex items-center justify-center transition-all cursor-pointer border border-slate-200"
                title={lang === 'ar' ? 'العودة للدليل الرئيسي' : 'Back to Directory'}
              >
                {lang === 'ar' ? <ArrowRightLeft className="w-4 h-4 rotate-180" /> : <ArrowLeft className="w-4 h-4" />}
              </button>

              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-brand-50 text-brand-800 text-[10px] font-bold uppercase">
                  <Building2 className="w-3 h-3 text-brand-600" />
                  <span>{lang === 'ar' ? 'ملف الشركة المصنعة' : 'Manufacturer Portfolio'}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                  {selectedCompany.name}
                </h2>
                <p className="text-xs text-slate-500">
                  {isLoadingPortfolio
                    ? (lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…')
                    : <>{companyPortfolio.length} {lang === 'ar' ? 'مستحضر دوائي مسجل' : 'registered pharmaceutical products'}</>}
                </p>
              </div>
            </div>

            {/* Inner Company Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className={`w-4 h-4 absolute ${lang === 'ar' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-slate-400`} />
              <input
                type="text"
                value={companySearchQuery}
                onChange={(e) => setCompanySearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث في منتجات الشركة...' : 'Search within company...'}
                className={`w-full ${lang === 'ar' ? 'pr-9 pl-8' : 'pl-9 pr-8'} py-2.5 rounded-xl bg-slate-50 text-slate-900 text-xs font-semibold border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500`}
              />
              {companySearchQuery && (
                <button
                  onClick={() => setCompanySearchQuery('')}
                  className={`absolute ${lang === 'ar' ? 'left-2.5' : 'right-2.5'} top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Company Portfolio Grid */}
          {isLoadingPortfolio ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-white p-5 rounded-lg border border-slate-200 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-4 w-full pt-2" />
                </div>
              ))}
            </div>
          ) : companyPortfolio.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {companyPortfolio.map((item) => {
                const isOrdered = orderedItems[item.id];
                return (
                  <motion.div
                    key={item.id}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => setInspectedMedicine(item)}
                    className="bg-white border border-slate-200 hover:border-brand-400 hover:shadow-md rounded-lg p-4 sm:p-5 transition-all duration-200 flex flex-col justify-between group cursor-pointer"
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-700 transition-colors leading-snug">
                            {item.name}
                          </h3>
                          {item.name_en && item.name_en !== item.name && (
                            <p className="text-xs font-semibold text-slate-400 mt-0.5 truncate">
                              {item.name_en}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 bg-brand-50 text-brand-800 border border-brand-200/80 px-2.5 py-1 rounded-xl font-black text-xs sm:text-sm whitespace-nowrap">
                          {Number(item.price || 0).toLocaleString()} {lang === 'ar' ? 'ل.س' : 'SYP'}
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                        {item.composition && (
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <FlaskConical className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                            <span className="font-semibold text-[11px] truncate" title={item.composition}>
                              {item.composition}
                            </span>
                          </div>
                        )}
                        {item.form && (
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Pill className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-medium text-[11px]">{item.form}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {item.composition && (
                        <button
                          type="button"
                          onClick={() => setActiveAlternativesMedicine(item)}
                          className="flex-1 py-2 px-2.5 rounded-xl bg-slate-50 hover:bg-brand-50 text-brand-700 border border-slate-200 hover:border-brand-300 transition-all font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          <span>{lang === 'ar' ? 'البدائل' : 'Equivalents'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAddToPOS(item)}
                        disabled={isOrdered}
                        className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer ${
                          isOrdered
                            ? 'bg-brand-50 text-brand-700 border border-brand-200 cursor-default'
                            : 'bg-brand-600 hover:bg-brand-700 text-white'
                        }`}
                      >
                        {isOrdered ? <Check className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{lang === 'ar' ? 'بيع' : 'POS'}</span>
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center space-y-3 shadow-sm">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'لم يتم العثور على أدوية للشركة' : 'No Products Found For Company'}
              </h3>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: LARGE CENTERED MEDICINE DETAIL PROFILE VIEW (POLISHED UX) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {inspectedMedicine && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            onClick={() => setInspectedMedicine(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white border border-slate-200/90 rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden my-auto relative"
            >
              {/* Sticky Top Header with Clear Exit Controls */}
              <div className="sticky top-0 z-20 px-5 sm:px-6 py-4 border-b border-slate-100 bg-white/95 backdrop-blur-md flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-brand-100 text-brand-800 flex items-center justify-center shrink-0">
                    <Stethoscope className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[11px] font-black uppercase tracking-wider text-brand-800 block">
                      {lang === 'ar' ? 'الملف الطبي للمستحضر' : 'Clinical Product Profile'}
                    </span>
                    <span className="text-xs text-slate-500 font-semibold">
                      {normalizeManufacturer(inspectedMedicine.company).displayName}
                    </span>
                  </div>
                </div>

                {/* Obvious Accessible Close / Back Button */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectedMedicine(null)}
                    className="sm:hidden px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    {lang === 'ar' ? <ArrowRightLeft className="w-3.5 h-3.5 rotate-180" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                    <span>{lang === 'ar' ? 'عودة' : 'Back'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInspectedMedicine(null)}
                    className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-2xs"
                    title={lang === 'ar' ? 'إغلاق النافذة (Esc)' : 'Close Modal (Esc)'}
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Content Body with Clear Visual Hierarchy */}
              <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-6 bg-[#FAFBFC]">
                
                {/* 1. PRIMARY MEDICINE HEADER */}
                <div className="bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                  
                  {/* Title & English Formulation */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-snug break-words">
                        {inspectedMedicine.name}
                      </h2>
                      {inspectedMedicine.name_en && (
                        <p className="text-sm font-semibold text-slate-500 font-sans break-words">
                          {inspectedMedicine.name_en}
                        </p>
                      )}
                    </div>

                    {/* Prominent Price & Active Status */}
                    <div className="shrink-0 flex flex-row sm:flex-col items-baseline sm:items-end justify-between gap-1 bg-brand-50/70 border border-brand-100 px-3.5 py-2 rounded-xl">
                      <span className="text-[10px] font-bold text-brand-800 uppercase">
                        {lang === 'ar' ? 'السعر الرسمي' : 'Catalog Price'}
                      </span>
                      <span className="text-lg sm:text-xl font-black text-brand-900 font-mono">
                        {Number(inspectedMedicine.price || 0).toLocaleString()} <span className="text-xs font-bold font-sans">{lang === 'ar' ? 'ل.س' : 'SYP'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Primary Attributes: Active Ingredient, Form & Company */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
                    
                    {/* Active Ingredient / Composition */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-0.5 sm:col-span-2">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <FlaskConical className="w-3.5 h-3.5 text-brand-600" />
                        <span>{lang === 'ar' ? 'المادة الفعالة / Active Ingredient' : 'Active Ingredient Formulation'}</span>
                      </span>
                      <p className="text-sm font-mono font-bold text-slate-900 break-words leading-relaxed pt-0.5">
                        {inspectedMedicine.composition || (lang === 'ar' ? 'تركيبة عامة غير مقيدة' : 'General formulation')}
                      </p>
                    </div>

                    {/* Pharmaceutical Form */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-0.5">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Pill className="w-3.5 h-3.5 text-slate-500" />
                        <span>{lang === 'ar' ? 'الشكل الصيدلاني' : 'Dosage Form'}</span>
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-slate-800">
                        {inspectedMedicine.form || (lang === 'ar' ? 'غير محدد' : 'Not specified')}
                      </p>
                    </div>

                    {/* Manufacturer */}
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-0.5">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-500" />
                        <span>{lang === 'ar' ? 'الشركة المصنعة' : 'Manufacturer'}</span>
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                        {normalizeManufacturer(inspectedMedicine.company).displayName}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. SECONDARY: CATALOG & TECHNICAL INFORMATION (Tidy compact key/values) */}
                <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                      <Barcode className="w-4 h-4 text-slate-500" />
                      <span>{lang === 'ar' ? 'المواصفات التقنية وبيانات الكتالوج' : 'Technical & Catalog Identifiers'}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {lang === 'ar' ? 'بيانات معتمدة' : 'Verified Local Record'}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 pt-1 text-xs">
                    
                    {/* Barcode / GTIN Row */}
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-500 font-semibold shrink-0">
                          {lang === 'ar' ? 'الرمز الشريطي (Barcode):' : 'Barcode / GTIN:'}
                        </span>
                        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] truncate">
                          {inspectedMedicine.barcode || (lang === 'ar' ? 'غير متوفر' : 'N/A')}
                        </span>
                      </div>
                      {inspectedMedicine.barcode && (
                        <button
                          type="button"
                          onClick={() => handleCopyText(inspectedMedicine.barcode, 'barcode')}
                          className="text-brand-700 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'barcode' ? <Check className="w-3 h-3 text-brand-700" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === 'barcode' ? (lang === 'ar' ? 'تم النسخ' : 'Copied') : (lang === 'ar' ? 'نسخ' : 'Copy')}</span>
                        </button>
                      )}
                    </div>

                    {/* Sako / Master Catalog ID Row */}
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-500 font-semibold shrink-0">
                          {lang === 'ar' ? 'معرف الصنف (Sako ID):' : 'Canonical Sako ID:'}
                        </span>
                        <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          #{inspectedMedicine.id}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyText(inspectedMedicine.id, 'sako')}
                        className="text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      >
                        {copiedKey === 'sako' ? <Check className="w-3 h-3 text-brand-700" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === 'sako' ? (lang === 'ar' ? 'تم النسخ' : 'Copied') : (lang === 'ar' ? 'نسخ ID' : 'Copy ID')}</span>
                      </button>
                    </div>

                    {/* Storage / System Status Row */}
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <span className="text-slate-500 font-semibold">
                        {lang === 'ar' ? 'حالة التخزين والمزامنة:' : 'Local Storage Status:'}
                      </span>
                      <div className="flex items-center gap-1 text-brand-700 font-bold text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{lang === 'ar' ? 'متزامن محلياً (IndexedDB)' : 'Synced in Local DB'}</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* 3. STICKY MODAL ACTIONS (Clean Grouped Action Area) */}
              <div className="sticky bottom-0 z-20 p-4 sm:p-5 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
                
                {/* Secondary Action: Bio-Equivalents */}
                <button
                  type="button"
                  onClick={() => {
                    const target = inspectedMedicine;
                    setInspectedMedicine(null);
                    setActiveAlternativesMedicine(target);
                  }}
                  disabled={!inspectedMedicine.composition || inspectedMedicine.composition === 'GENERAL'}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-brand-50 text-brand-800 border border-slate-200 hover:border-brand-300 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                >
                  <ArrowRightLeft className="w-4 h-4 text-brand-600" />
                  <span>{lang === 'ar' ? 'البحث عن البدائل المتكافئة' : 'View Bio-Equivalents'}</span>
                </button>

                {/* Primary Action Group: Add to POS Cart / Warehouse Intake & Close */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {onStartIntake ? (
                    <button
                      type="button"
                      onClick={() => {
                        const target = inspectedMedicine;
                        setInspectedMedicine(null);
                        onStartIntake(target);
                      }}
                      className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer min-h-[42px]"
                    >
                      <PackagePlus className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'إضافة إلى مخزون المستودع' : 'Add to Warehouse Inventory'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddToPOS(inspectedMedicine)}
                      className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer min-h-[42px]"
                    >
                      <ShoppingCart className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'إضافة إلى نقطة البيع' : 'Add to POS Cart'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setInspectedMedicine(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-xs sm:text-sm transition-all cursor-pointer min-h-[42px]"
                  >
                    {lang === 'ar' ? 'إغلاق' : 'Close'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: SCIENTIFIC ALTERNATIVES / BIO-EQUIVALENTS VIEW (POLISHED UX) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {activeAlternativesMedicine && (
          <div 
            className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            onClick={() => setActiveAlternativesMedicine(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden my-auto"
            >
              {/* Sticky Header with Obvious Close Button */}
              <div className="sticky top-0 z-20 p-5 border-b border-slate-100 bg-white/95 backdrop-blur-md flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-800 border border-brand-200/80">
                    <ArrowRightLeft className="w-3 h-3 text-brand-600" />
                    <span>{lang === 'ar' ? 'البدائل والمكافئات العلمية' : 'Bio-Equivalent Formulations'}</span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 truncate">
                    {activeAlternativesMedicine.name}
                  </h3>
                  <div className="text-xs font-mono text-slate-500 flex items-center gap-1.5 truncate">
                    <FlaskConical className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span className="truncate max-w-md">{activeAlternativesMedicine.composition || 'Active Ingredient'}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveAlternativesMedicine(null)}
                  className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer shrink-0"
                  title={lang === 'ar' ? 'إغلاق (Esc)' : 'Close (Esc)'}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Alternatives List */}
              <div className="p-5 flex-1 overflow-y-auto space-y-3 bg-[#FAFBFC]">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                  {lang === 'ar' ? 'المستحضرات المتوفرة بذات المادة الفعالة:' : 'Available Medicines with Same Active Ingredient:'}
                </div>

                {isLoadingAlternatives ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    ))}
                  </div>
                ) : alternativesList.length > 0 ? (
                  alternativesList.map((alt) => {
                    const isOrdered = orderedItems[alt.id];
                    const rawManufacturer = (alt as any).MANUFACTURER || (alt as any).manufacturer || (alt as any).company_name || alt.company || 'Unknown';
                    const { displayName } = normalizeManufacturer(rawManufacturer);
                    
                    // Price comparison difference
                    const basePrice = Number(activeAlternativesMedicine.price || 0);
                    const altPrice = Number(alt.price || 0);
                    const priceDiff = altPrice - basePrice;

                    return (
                      <div
                        key={alt.id}
                        className="bg-white rounded-xl p-4 border border-slate-200 hover:border-brand-300 shadow-2xs hover:shadow-xs transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 text-sm">
                              {alt.name}
                            </span>
                            {alt.name_en && (
                              <span className="text-[11px] font-semibold text-slate-400">
                                ({alt.name_en})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span className="font-bold text-brand-700">
                              {displayName}
                            </span>
                            {alt.form && (
                              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-semibold">
                                {alt.form}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-0 border-slate-100 pt-2 sm:pt-0">
                          <div className="text-right">
                            <div className="text-sm font-black font-mono text-slate-900">
                              {altPrice ? `${altPrice.toLocaleString()} SYP` : 'Quote'}
                            </div>
                            {basePrice > 0 && altPrice > 0 && priceDiff !== 0 && (
                              <div className={`text-[10px] font-bold ${priceDiff < 0 ? 'text-brand-600' : 'text-slate-400'}`}>
                                {priceDiff < 0 ? `▼ -${Math.abs(priceDiff).toLocaleString()} SYP` : `▲ +${priceDiff.toLocaleString()} SYP`}
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => handleAddToPOS(alt)}
                            disabled={isOrdered}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
                              isOrdered
                                ? 'bg-brand-50 border border-brand-200 text-brand-700 cursor-default'
                                : 'bg-brand-600 hover:bg-brand-700 text-white active:scale-95'
                            }`}
                          >
                            {isOrdered ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>{lang === 'ar' ? 'تمت الإضافة' : 'Ordered'}</span>
                              </>
                            ) : (
                              <>
                                <ShoppingCart className="w-3.5 h-3.5" />
                                <span>{lang === 'ar' ? 'إضافة للبيع' : '+ POS'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-white rounded-xl p-8 text-center space-y-2 border border-slate-200 shadow-2xs">
                    <Info className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs font-bold text-slate-600">
                      {lang === 'ar'
                        ? 'لم يتم العثور على أدوية مكافئة بذات المادة الفعالة في الكتالوج الحالي.'
                        : 'No direct active-ingredient equivalents found in the local catalog.'}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 3: ALL COMPANIES DIRECTORY VIEW */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isAllCompaniesModalOpen && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            onClick={() => setIsAllCompaniesModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden my-auto"
            >
              {/* Header */}
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-800 flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">
                      {lang === 'ar' ? 'دليل الشركات الدوائية والمصانع' : 'Complete Pharmaceutical Directory'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {dynamicCompanies.length} {lang === 'ar' ? 'شركة ومخبر مرخص' : 'licensed manufacturers'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAllCompaniesModalOpen(false)}
                  className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
                  title={lang === 'ar' ? 'إغلاق (Esc)' : 'Close (Esc)'}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Company Search Input */}
              <div className="p-4 bg-slate-50 border-b border-slate-100">
                <div className="relative">
                  <Search className={`w-4 h-4 absolute ${lang === 'ar' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-slate-400`} />
                  <input
                    type="text"
                    value={allCompaniesSearch}
                    onChange={(e) => setAllCompaniesSearch(e.target.value)}
                    placeholder={lang === 'ar' ? 'ابحث عن اسم الشركة المصنعة...' : 'Filter companies...'}
                    className={`w-full ${lang === 'ar' ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2.5 rounded-xl bg-white text-slate-900 text-xs font-semibold border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500`}
                  />
                </div>
              </div>

              {/* Scrollable Company List Grid */}
              <div className="p-5 flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-slate-50/50">
                {filteredModalCompanies.map((company) => {
                  const initials = company.name.substring(0, 2).toUpperCase();
                  return (
                    <div
                      key={company.id}
                      onClick={() => {
                        setSelectedCompany(company);
                        setIsAllCompaniesModalOpen(false);
                        setCompanySearchQuery('');
                      }}
                      className="bg-white border border-slate-200 hover:border-brand-400 hover:shadow-xs rounded-xl p-3.5 transition-all flex items-center justify-between group cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-800 font-bold text-xs flex items-center justify-center shrink-0 border border-brand-100">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-800 group-hover:text-brand-700 transition-colors truncate">
                            {company.name}
                          </h4>
                          {company.count !== undefined && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              {company.count} {lang === 'ar' ? 'مستحضر' : 'items'}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-600 shrink-0" />
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
