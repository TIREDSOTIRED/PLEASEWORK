import React, { useState } from 'react';
import { useAuth, pendingOrgKey } from '../../application/auth/AuthContext';
import { 
  Building2, 
  MapPin, 
  Phone, 
  ArrowRight, 
  Loader2, 
  Store, 
  CheckCircle2, 
  AlertCircle,
  ShieldCheck,
  Globe,
  Info
} from 'lucide-react';
import PharmacySwitcher from '../PharmacySwitcher';
import LegalModal from '../auth/LegalModal';

interface OnboardingProps {
  lang?: 'en' | 'ar';
  setLang?: (lang: 'en' | 'ar') => void;
}

export default function PharmacyOnboarding({ lang = 'en', setLang }: OnboardingProps) {
  const { currentSession, completeOnboarding, logout, isLoading, error } = useAuth();
  
  // P1 #8 — de-duplicate onboarding: the signup flow already collected the
  // organization details (before the verification wall). Pre-fill everything
  // from that saved snapshot and skip the type-selection step when known, so
  // the pharmacist never answers the same questions twice.
  const pendingOrg = (() => {
    try {
      const uid = (currentSession as any)?.userId;
      if (!uid) return null;
      const raw = localStorage.getItem(pendingOrgKey(uid));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  })();

  const [step, setStep] = useState<1 | 2>(pendingOrg?.orgName ? 2 : 1);
  const [tenantType, setTenantType] = useState<'RETAIL_PHARMACY' | 'WHOLESALE_WAREHOUSE'>(
    pendingOrg?.tenantType === 'WHOLESALE_WAREHOUSE' ? 'WHOLESALE_WAREHOUSE' : 'RETAIL_PHARMACY'
  );
  const [name, setName] = useState(pendingOrg?.orgName || '');
  const [location, setLocation] = useState(pendingOrg?.location || 'Damascus, Syria');
  const [phone, setPhone] = useState(pendingOrg?.contactPhone || '');
  // P1 #8 — license number is captured when the pharmacist HAS one; the
  // status stays honestly "PENDING" until real verification exists.
  const [licenseNumber, setLicenseNumber] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Legal Consent
  const [legalConsent, setLegalConsent] = useState(false);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy' | null>(null);

  const isArabic = lang === 'ar';

  const hasExistingWorkspaces = 
    (currentSession?.ownedPharmacyIds && currentSession.ownedPharmacyIds.length > 0) || 
    (currentSession?.associatedTenantIds && currentSession.associatedTenantIds.length > 0);

  const handleStep1Next = () => {
    // P1 #8: no fabricated placeholder names. The step-2 form validates the
    // real name; leaving it empty surfaces a clear error instead of silently
    // creating "Damascus Central Pharmacy".
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!name.trim() || name.trim().length < 2) {
      setLocalError(
        tenantType === 'RETAIL_PHARMACY'
          ? (isArabic ? 'يرجى إدخال اسم الصيدلية.' : 'Please enter the pharmacy name.')
          : (isArabic ? 'يرجى إدخال اسم المستودع.' : 'Please enter the warehouse name.')
      );
      return;
    }

    await completeOnboarding(name.trim(), location.trim(), phone.trim(), tenantType, licenseNumber.trim() || undefined);
  };

  if (hasExistingWorkspaces) {
    return (
      <div 
        className="min-h-screen bg-slate-100/80 flex flex-col items-center justify-center p-4 relative font-sans"
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        <div className="w-full max-w-md bg-white rounded-lg p-6 sm:p-8 shadow-xl border border-slate-200/90">
          <div className="text-center mb-6">
            <div className="inline-flex w-12 h-12 rounded-xl bg-brand-100 text-brand-700 items-center justify-center mb-3">
              <Store className="w-6 h-6" />
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
              {isArabic ? 'اختر مساحة العمل' : 'Select Workspace'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              {isArabic ? 'اختر إحدى منشآتك المسجلة للمتابعة' : 'Choose a registered workspace to continue'}
            </p>
          </div>
          <PharmacySwitcher />
        </div>
      </div>
    );
  }

  const activeError = localError || error;

  return (
    <div 
      className="min-h-screen bg-slate-100/80 flex flex-col items-center justify-center p-3 sm:p-6 relative font-sans"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      {/* Top Controls */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 z-20">
        {setLang && (
          <button 
            type="button"
            onClick={() => setLang(isArabic ? 'en' : 'ar')} 
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold font-mono bg-white border border-slate-200 text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-brand-600" />
            <span>{isArabic ? 'English' : 'العربية'}</span>
          </button>
        )}
      </div>

      <div className="w-full max-w-md my-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-6 space-y-1">
          <div className="inline-flex w-14 h-14 rounded-lg bg-brand-600 items-center justify-center shadow-lg shadow-brand-600/20 ring-4 ring-brand-100 mb-2">
            {tenantType === 'WHOLESALE_WAREHOUSE' ? (
              <Building2 className="w-7 h-7 text-white" />
            ) : (
              <Store className="w-7 h-7 text-white" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {isArabic ? 'تهيئة منشأتك الطبية' : 'Setup Your Organization'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            {isArabic ? 'خطوة واحدة للبدء في استخدام المنظومة' : 'One quick step to initialize your workspace'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-lg border border-slate-200/90 shadow-xl p-6 sm:p-8 space-y-6">
          {/* User Account Info */}
          {currentSession?.email && (
            <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs">
              <div className="flex items-center gap-2 truncate text-slate-600">
                <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0"></span>
                <span className="truncate font-medium">{currentSession.email}</span>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="text-xs font-semibold text-slate-500 hover:text-red-600 ml-2 rtl:ml-0 rtl:mr-2 shrink-0 transition-colors cursor-pointer"
              >
                {isArabic ? 'تبديل الحساب' : 'Switch'}
              </button>
            </div>
          )}

          {activeError && (
            <div className="p-3.5 bg-red-50 text-red-700 border border-red-200/80 rounded-xl text-xs sm:text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="font-semibold">{activeError}</p>
            </div>
          )}

          {/* Step 1: Choose Organization Type */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center pb-1">
                <h3 className="text-sm font-bold text-slate-800">
                  {isArabic ? 'حدد نوع منشأتك' : 'Select Organization Type'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isArabic 
                    ? 'يحدد هذا الخيار واجهة وتجربة الاستخدام الأساسية الخاصة بك'
                    : 'This selection configures your primary application workspace'}
                </p>
              </div>

              <div className="space-y-3">
                {/* PHARMACY */}
                <button
                  type="button"
                  onClick={() => setTenantType('RETAIL_PHARMACY')}
                  className={`w-full p-4 rounded-lg border-2 text-left rtl:text-right transition-all flex items-start gap-3.5 cursor-pointer ${
                    tenantType === 'RETAIL_PHARMACY'
                      ? 'border-brand-600 bg-brand-50/70 shadow-sm ring-1 ring-brand-500'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl shrink-0 ${
                    tenantType === 'RETAIL_PHARMACY' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    <Store className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-900">
                        {isArabic ? 'صيدلية (نقطة بيع وتجزئة)' : 'PHARMACY'}
                      </h4>
                      {tenantType === 'RETAIL_PHARMACY' && (
                        <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {isArabic
                        ? 'إدارة الأدوية، المخزون، المبيعات السريعة، والطلبيات المباشرة من المستودعات.'
                        : 'Manage medicines, inventory, sales and wholesale orders.'}
                    </p>
                  </div>
                </button>

                {/* WAREHOUSE */}
                <button
                  type="button"
                  onClick={() => setTenantType('WHOLESALE_WAREHOUSE')}
                  className={`w-full p-4 rounded-lg border-2 text-left rtl:text-right transition-all flex items-start gap-3.5 cursor-pointer ${
                    tenantType === 'WHOLESALE_WAREHOUSE'
                      ? 'border-brand-600 bg-brand-50/70 shadow-sm ring-1 ring-brand-500'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className={`p-2.5 rounded-xl shrink-0 ${
                    tenantType === 'WHOLESALE_WAREHOUSE' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-900">
                        {isArabic ? 'مستودع أدوية (بيع جملة)' : 'WAREHOUSE'}
                      </h4>
                      {tenantType === 'WHOLESALE_WAREHOUSE' && (
                        <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {isArabic
                        ? 'إدارة المستودع والمخزون، نشر عروض الجملة، وتجهيز طلبيات الصيدليات (FEFO).'
                        : 'Manage inventory, wholesale offers and pharmacy orders.'}
                    </p>
                  </div>
                </button>
              </div>

              <button
                type="button"
                onClick={handleStep1Next}
                className="w-full mt-2 py-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>{isArabic ? 'التالي: تفاصيل المنشأة' : 'Next: Organization Info'}</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          )}

          {/* Step 2: Organization Info */}
          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="p-3 bg-brand-50 border border-brand-200/80 rounded-xl flex items-center gap-2.5 text-xs text-brand-800 font-medium">
                <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
                <span>
                  {tenantType === 'RETAIL_PHARMACY'
                    ? (isArabic ? 'تهيئة صيدلية معتمدة' : 'Setting up Retail Pharmacy')
                    : (isArabic ? 'تهيئة مستودع أدوية جملة' : 'Setting up Wholesale Warehouse')}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  {tenantType === 'RETAIL_PHARMACY'
                    ? (isArabic ? 'اسم الصيدلية *' : 'Pharmacy Name *')
                    : (isArabic ? 'اسم المستودع *' : 'Warehouse Name *')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    placeholder={tenantType === 'RETAIL_PHARMACY' ? 'e.g. Al-Amal Pharmacy' : 'e.g. Damascus Med Supply'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  {isArabic ? 'المدينة / العنوان' : 'Verified Location'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    placeholder="Damascus, Syria"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  {isArabic ? 'رقم الهاتف (اختياري)' : 'Contact Phone (Optional)'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    placeholder="+963 11 222 3344"
                  />
                </div>
              </div>

              {/* P1 #8 — capture the REAL license number when the pharmacist
                  has one. Status is never fabricated: without a number the
                  profile honestly stays "PENDING". */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  {isArabic ? 'رقم الإجازة الصحية (اختياري)' : 'Pharmacy License # (Optional)'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    placeholder={isArabic ? 'مثال: PHAR-LIC-0000-SY' : 'e.g. PHAR-LIC-0000-SY'}
                  />
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-4">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="legal-consent"
                    checked={legalConsent}
                    onChange={(e) => setLegalConsent(e.target.checked)}
                    className="mt-1 flex-shrink-0 w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                  />
                  <div className="flex-1">
                    <label htmlFor="legal-consent" className="text-xs text-slate-700 font-medium cursor-pointer">
                      {isArabic ? 'لقد قرأت وأوافق على ' : 'I have read and agree to the '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setLegalModalType('terms');
                          setLegalModalOpen(true);
                        }}
                        className="text-brand-700 hover:underline inline"
                      >
                        {isArabic ? 'شروط الخدمة' : 'Terms of Service'}
                      </button>
                      {isArabic ? ' و ' : ' and '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setLegalModalType('privacy');
                          setLegalModalOpen(true);
                        }}
                        className="text-brand-700 hover:underline inline"
                      >
                        {isArabic ? 'سياسة الخصوصية' : 'Privacy Policy'}
                      </button>
                      .
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 px-1 text-slate-500">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
                <p className="text-[10px] leading-relaxed">
                  {isArabic 
                    ? 'هذه الخدمة حالياً في المرحلة التجريبية (Beta). قد تتغير الميزات، وقد تحدث انقطاعات مؤقتة أثناء تحسين المنصة.' 
                    : 'This service is currently in beta. Features may change, and temporary interruptions may occur while we improve the platform.'}
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={isLoading}
                  className="w-1/3 py-3.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl font-bold text-xs sm:text-sm transition-all"
                >
                  {isArabic ? 'رجوع' : 'Back'}
                </button>
                <button
                  type="submit"
                  disabled={!legalConsent || isLoading}
                  className="w-2/3 py-3.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>{isArabic ? 'تهيئة والدخول' : 'Initialize & Enter'}</span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <LegalModal 
        isOpen={legalModalOpen}
        onClose={() => {
          setLegalModalOpen(false);
          setLegalModalType(null);
        }}
        type={legalModalType}
        lang={lang}
      />
    </div>
  );
}
