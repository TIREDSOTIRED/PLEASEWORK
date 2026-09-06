import React, { useState, useEffect } from 'react';
import { useAuth, VERIFICATION_REQUIRED_MSG } from '../../application/auth/AuthContext';
import { useUI } from '../../context/UIContext';
import LegalModal from './LegalModal';
import { 
  HeartPulse, 
  Mail, 
  MailCheck, 
  Lock, 
  Eye, 
  EyeOff, 
  Building2, 
  Store, 
  ArrowRight, 
  ArrowLeft, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  ShieldCheck,
  Globe,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  Info,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AuthScreenProps {
  lang?: 'en' | 'ar';
  setLang?: (lang: 'en' | 'ar') => void;
}

type AuthMode = 'signin' | 'signup' | 'forgot_password';
type SignUpStep = 1 | 2 | 3;
type OrgType = 'RETAIL_PHARMACY' | 'WHOLESALE_WAREHOUSE';

export default function AuthScreen({ lang = 'en', setLang }: AuthScreenProps) {
  const { 
    loginWithEmail, 
    signUpWithEmail, 
    loginWithGoogle, 
    signUpWithGoogle, 
    resetPassword,
    resendVerificationEmail,
    isLoading, 
    error, 
    setError, 
    clearError,
    mockLogin
  } = useAuth();

  const { theme: uiTheme, setTheme: setUiTheme, triggerToast } = useUI();
  const dark = uiTheme === 'dark';

  const [mode, setMode] = useState<AuthMode>('signin');
  const [signUpStep, setSignUpStep] = useState<SignUpStep>(1);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Legal Consent
  const [legalConsent, setLegalConsent] = useState(false);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy' | null>(null);

  // Org Fields
  const [orgType, setOrgType] = useState<OrgType>('RETAIL_PHARMACY');
  const [orgName, setOrgName] = useState('');
  const [location, setLocation] = useState('Damascus, Syria');
  const [contactPhone, setContactPhone] = useState('');

  // Local state & feedback
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  // Email-verification recovery panel (P1 #2): offered whenever the auth
  // context bounces the user to the verification wall — after signup OR a
  // sign-in attempt with an unverified password account.
  const [showVerifyPanel, setShowVerifyPanel] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNote, setResendNote] = useState<{ ok: boolean; msg: string } | null>(null);

  const isArabic = lang === 'ar';

  const handleModeSwitch = (newMode: AuthMode) => {
    setMode(newMode);
    setSignUpStep(1);
    setLocalError(null);
    setResetSuccessMessage(null);
    if (clearError) clearError();
    else if (setError) setError(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError(isArabic ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' : 'Please enter both email and password.');
      return;
    }
    if (loginWithEmail) {
      await loginWithEmail(email.trim(), password);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setResetSuccessMessage(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setLocalError(isArabic ? 'يرجى إدخال بريد إلكتروني صحيح.' : 'Please enter a valid email address.');
      return;
    }

    if (resetPassword) {
      const ok = await resetPassword(email.trim());
      if (ok) {
        setResetSuccessMessage(
          isArabic 
            ? 'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني بنجاح.' 
            : 'Password reset link sent to your email successfully.'
        );
      }
    }
  };

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setLocalError(isArabic ? 'يرجى إدخال عنوان بريد إلكتروني صالح.' : 'Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setLocalError(isArabic ? 'يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.' : 'Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setLocalError(isArabic ? 'كلمات المرور غير متطابقة.' : 'Passwords do not match.');
      return;
    }

    setSignUpStep(2);
  };

  const handleStep2Next = () => {
    setLocalError(null);
    if (!orgName) {
      setOrgName(orgType === 'RETAIL_PHARMACY' ? 'Damascus Central Pharmacy' : 'Syrian Med Supply Hub');
    }
    setSignUpStep(3);
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!orgName.trim() || orgName.trim().length < 2) {
      setLocalError(
        orgType === 'RETAIL_PHARMACY'
          ? (isArabic ? 'يرجى إدخال اسم الصيدلية.' : 'Please enter the pharmacy name.')
          : (isArabic ? 'يرجى إدخال اسم المستودع.' : 'Please enter the warehouse name.')
      );
      return;
    }

    // Phone is mandatory at signup: warehouses cannot fulfill orders they
    // cannot call about, and the B2B pipeline blocks on buyerPhone anyway.
    const cleanPhone = contactPhone.trim();
    if (cleanPhone.replace(/\D/g, '').length < 7) {
      setLocalError(
        isArabic
          ? 'يرجى إدخال رقم هاتف صحيح — هو مطلوب لطلبات الجملة والفائض.'
          : 'Please enter a valid phone number — it is required for wholesale & surplus orders.'
      );
      return;
    }

    if (signUpWithEmail) {
      const defaultName = orgType === 'RETAIL_PHARMACY' ? 'Pharmacist' : 'Warehouse Manager';
      const ok = await signUpWithEmail(
        email.trim(),
        password,
        defaultName,
        orgType,
        orgName.trim(),
        location.trim(),
        contactPhone.trim()
      );
      // A verification link was mailed to this address — surface it so the
      // address is confirmed (and can later be enforced) instead of silently
      // accepting unowned inboxes.
      if (ok !== false && triggerToast) {
        triggerToast(
          isArabic
            ? 'أُرسل رابط تأكيد إلى بريدك الإلكتروني — افتحه لتأكيد ملكية الحساب.'
            : 'A confirmation link was sent to your email — open it to verify ownership.',
          'info'
        );
      }
    }
  };

  const activeError = localError || error;

  useEffect(() => {
    if (activeError === VERIFICATION_REQUIRED_MSG) setShowVerifyPanel(true);
  }, [activeError]);
  const isDuplicateAccountError = 
    activeError?.includes('already exists') || 
    activeError?.includes('موجود مسبقاً') || 
    activeError?.includes('email-already-in-use');

  return (
    <div 
      className="min-h-screen bg-slate-100/90 flex flex-col items-center justify-center p-3.5 sm:p-6 relative font-sans transition-colors"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      {/* Top Header Controls */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 z-20">
        {(() => {
          const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
          return (
            <button
              type="button"
              aria-label="Toggle dark mode"
              onClick={() => setUiTheme(dark ? 'light' : 'dark')}
              className="w-9 h-9 rounded-md bg-white/80 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-brand-300 flex items-center justify-center transition-colors cursor-pointer"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          );
        })()}
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

      <div className="w-full max-w-md my-auto relative z-10 py-4">
        {/* Brand Header */}
        <div className="text-center mb-5 space-y-2">
          <div className="inline-flex w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-brand-600 items-center justify-center shadow-lg shadow-brand-600/20 ring-4 ring-brand-100">
            <HeartPulse className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {isArabic ? 'منظومة إشمون الطبية' : 'Eshmun Medical Portal'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
              {isArabic ? 'بوابة إدارة الصيدليات والمستودعات الطبية' : 'Clinical Pharmacy & Wholesale Management'}
            </p>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-lg border border-slate-200/90 shadow-xl overflow-hidden">
          {/* Header Action Bar */}
          <div className="p-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between min-h-[48px]">
            {mode === 'signin' ? (
              <div className="flex-1 text-center">
                 <span className="text-xs font-bold text-slate-800">
                  {isArabic ? 'تسجيل الدخول إلى حسابك' : 'Sign In to Your Account'}
                </span>
              </div>
            ) : mode === 'forgot_password' ? (
              <>
                <button
                  type="button"
                  onClick={() => handleModeSwitch('signin')}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-brand-700 transition-colors cursor-pointer"
                >
                  {isArabic ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  <span>{isArabic ? 'رجوع لتسجيل الدخول' : 'Back to Login'}</span>
                </button>
                <span className="text-xs font-semibold text-slate-400">
                  {isArabic ? 'استعادة الحساب' : 'Account Recovery'}
                </span>
              </>
            ) : mode === 'signup' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (signUpStep > 1) {
                      setSignUpStep((prev) => (prev - 1) as SignUpStep);
                    } else {
                      handleModeSwitch('signin');
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-brand-700 transition-colors cursor-pointer"
                >
                  {isArabic ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  <span>{isArabic ? 'رجوع' : 'Back'}</span>
                </button>
                <span className="text-xs font-semibold text-slate-400">
                  {isArabic ? 'إنشاء حساب جديد' : 'Create Account'}
                </span>
              </>
            ) : null}
          </div>

          <div className="p-5 sm:p-7 space-y-5">
            {/* Error Banner */}
            {activeError && (
              <div className="p-3.5 bg-red-50 text-red-700 border border-red-200/80 rounded-xl text-xs sm:text-sm flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold leading-relaxed">{activeError}</p>
                  {isDuplicateAccountError && (
                    <button
                      type="button"
                      onClick={() => handleModeSwitch('signin')}
                      className="mt-2 text-xs font-bold text-brand-700 hover:text-brand-800 underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>{isArabic ? 'تسجيل الدخول الآن' : 'Sign in instead'}</span>
                      <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Success Banner */}
            {resetSuccessMessage && (
              <div className="p-3.5 bg-brand-50 text-brand-800 border border-brand-200/80 rounded-xl text-xs sm:text-sm flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <p className="font-medium leading-relaxed">{resetSuccessMessage}</p>
              </div>
            )}

            {/* ================================================= */}
            {/* 0. EMAIL VERIFICATION RECOVERY PANEL (P1 #2)      */}
            {/* Shown when a signup/login is bounced to the        */}
            {/* verification wall. Offers a real resend action —   */}
            {/* never a bypass.                                    */}
            {/* ================================================= */}
            {showVerifyPanel && (
              <div className="space-y-4">
                <div className="text-center pb-1">
                  <div className="inline-flex w-12 h-12 rounded-xl bg-brand-100 text-brand-700 items-center justify-center mb-2">
                    <MailCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isArabic ? 'أكّد بريدك الإلكتروني' : 'Confirm your email address'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {isArabic
                      ? 'أرسلنا رابط تأكيد إلى بريدك. افتح الرابط ثم سجّل الدخول. إن لم يصلك البريد، أعد إرساله من هنا.'
                      : 'We sent a confirmation link to your email. Open it, then sign in. If it never arrived, resend it from here.'}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium truncate text-center" dir="ltr">
                  {email || '—'}
                </div>

                {resendNote && (
                  <div className={`p-3 rounded-xl text-xs font-semibold flex items-start gap-2 border ${
                    resendNote.ok
                      ? 'bg-brand-50 text-brand-800 border-brand-200/80'
                      : 'bg-red-50 text-red-700 border-red-200/80'
                  }`}>
                    {resendNote.ok
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      : <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                    <p className="leading-relaxed">{resendNote.msg}</p>
                  </div>
                )}

                <button
                  type="button"
                  disabled={resendLoading || !email || !password}
                  onClick={async () => {
                    setResendLoading(true);
                    setResendNote(null);
                    try {
                      const okResend = await resendVerificationEmail(email, password);
                      setResendNote(okResend
                        ? { ok: true, msg: isArabic ? 'تم إرسال رابط التأكيد — تحقق من صندوق الوارد وبريد spam.' : 'Confirmation link sent — check your inbox and spam folder.' }
                        : { ok: false, msg: activeError || (isArabic ? 'فشل إعادة الإرسال. حاول لاحقاً.' : 'Resend failed. Try again shortly.') });
                    } finally {
                      setResendLoading(false);
                    }
                  }}
                  className="w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {resendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
                  <span>{isArabic ? 'إعادة إرسال رابط التأكيد' : 'Resend verification email'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowVerifyPanel(false);
                    setResendNote(null);
                    clearError();
                    handleModeSwitch('signin');
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                >
                  {isArabic ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
                </button>
              </div>
            )}

            {!showVerifyPanel && (<>

            {/* ================================================= */}
            {/* 1. SIGN IN VIEW */}
            {/* ================================================= */}
            {mode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    {isArabic ? 'البريد الإلكتروني' : 'Email Address'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="doctor@example.com"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {isArabic ? 'كلمة المرور' : 'Password'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleModeSwitch('forgot_password')}
                      className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 hover:underline cursor-pointer"
                    >
                      {isArabic ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 rtl:pl-10 rtl:pr-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 pr-3 rtl:pr-0 rtl:pl-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer mt-1"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>{isArabic ? 'تسجيل الدخول' : 'Sign In'}</span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                    </>
                  )}
                </button>

                {/* Google Sign In Alternative */}
                <div className="pt-2">
                  <div className="relative flex py-1.5 items-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-3 text-xs text-slate-400 font-medium">
                      {isArabic ? 'أو عبر' : 'Or continue with'}
                    </span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  <button
                    type="button"
                    onClick={loginWithGoogle}
                    disabled={isLoading}
                    className="w-full mt-1 py-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-bold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>{isArabic ? 'المتابعة بحساب Google' : 'Google Account'}</span>
                  </button>
                </div>

                {/* DEV-ONLY mock login — stripped from production builds */}
                {import.meta.env.DEV && (
                  <div className="pt-3">
                    <div className="relative flex py-1 items-center">
                      <div className="flex-grow border-t border-dashed border-amber-300"></div>
                      <span className="flex-shrink mx-3 text-[10px] text-amber-600 font-bold uppercase tracking-wider">
                        {isArabic ? 'تطوير فقط' : 'Dev only'}
                      </span>
                      <div className="flex-grow border-t border-dashed border-amber-300"></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => mockLogin?.('RETAIL_PHARMACY')}
                        disabled={isLoading}
                        className="py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Store className="w-3.5 h-3.5" />
                        <span>{isArabic ? 'دخول صيدلية' : 'Pharmacy'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => mockLogin?.('WHOLESALE_WAREHOUSE')}
                        disabled={isLoading}
                        className="py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{isArabic ? 'دخول مستودع' : 'Warehouse'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* ================================================= */}
            {/* 2. FORGOT PASSWORD VIEW */}
            {/* ================================================= */}
            {mode === 'forgot_password' && (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <div className="text-center pb-1">
                  <div className="inline-flex w-10 h-10 rounded-xl bg-brand-50 text-brand-600 items-center justify-center mb-2">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">
                    {isArabic ? 'استعادة كلمة المرور' : 'Reset Your Password'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {isArabic 
                      ? 'أدخل بريدك الإلكتروني المسجل وسنرسل لك رابطاً لإعادة تعيين كلمة المرور.'
                      : "Enter your registered email address and we'll send you a password reset link."}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    {isArabic ? 'البريد الإلكتروني المسجل' : 'Registered Email Address'}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="doctor@example.com"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('signin')}
                    className="w-1/3 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                    <span>{isArabic ? 'إلغاء' : 'Cancel'}</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-2/3 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>{isArabic ? 'إرسال الرابط' : 'Send Reset Link'}</span>
                        <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ================================================= */}
            {/* 3. CREATE ACCOUNT VIEW (PROGRESSIVE STEPS) */}
            {/* ================================================= */}
            {mode === 'signup' && (
              <div className="space-y-5">
                {/* Stepper Indicator */}
                <div className="flex items-center justify-between px-1 pb-1">
                  <button
                    type="button"
                    onClick={() => setSignUpStep(1)}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                      signUpStep === 1 ? 'bg-brand-600 text-white ring-2 ring-brand-200' : 'bg-brand-100 text-brand-800'
                    }`}>
                      1
                    </span>
                    <span className={`text-xs font-bold ${signUpStep === 1 ? 'text-slate-900' : 'text-slate-400'}`}>
                      {isArabic ? 'الحساب' : 'Account'}
                    </span>
                  </button>
                  <div className="w-6 sm:w-8 h-0.5 bg-slate-200"></div>
                  <button
                    type="button"
                    onClick={() => { if (email && password.length >= 6 && password === confirmPassword) setSignUpStep(2); }}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                      signUpStep === 2 ? 'bg-brand-600 text-white ring-2 ring-brand-200' : signUpStep > 2 ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-400'
                    }`}>
                      2
                    </span>
                    <span className={`text-xs font-bold ${signUpStep === 2 ? 'text-slate-900' : 'text-slate-400'}`}>
                      {isArabic ? 'النوع' : 'Role'}
                    </span>
                  </button>
                  <div className="w-6 sm:w-8 h-0.5 bg-slate-200"></div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                      signUpStep === 3 ? 'bg-brand-600 text-white ring-2 ring-brand-200' : 'bg-slate-100 text-slate-400'
                    }`}>
                      3
                    </span>
                    <span className={`text-xs font-bold ${signUpStep === 3 ? 'text-slate-900' : 'text-slate-400'}`}>
                      {isArabic ? 'المنشأة' : 'Setup'}
                    </span>
                  </div>
                </div>

                {/* STEP 1: CREDENTIALS */}
                {signUpStep === 1 && (
                  <form onSubmit={handleStep1Next} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {isArabic ? 'البريد الإلكتروني' : 'Email Address'}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                          <Mail className="w-4 h-4" />
                        </div>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full pl-10 rtl:pl-4 rtl:pr-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                          placeholder="doctor@example.com"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {isArabic ? 'كلمة المرور' : 'Password'}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-10 rtl:pl-10 rtl:pr-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 pr-3 rtl:pr-0 rtl:pl-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {isArabic ? '6 أحرف على الأقل' : 'At least 6 characters'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {isArabic ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 pl-3 rtl:pl-0 rtl:pr-3 flex items-center pointer-events-none text-slate-400">
                          <Lock className="w-4 h-4" />
                        </div>
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full pl-10 rtl:pl-10 rtl:pr-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 pr-3 rtl:pr-0 rtl:pl-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
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

                    <button
                      type="submit"
                      disabled={!legalConsent || isLoading}
                      className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer mt-1"
                    >
                      <span>{isArabic ? 'التالي: اختيار نوع المنشأة' : 'Next: Choose Role'}</span>
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                    </button>

                    {/* Google Sign Up Alternative */}
                    <div className="pt-2">
                      <div className="relative flex py-1.5 items-center">
                        <div className="flex-grow border-t border-slate-200"></div>
                        <span className="flex-shrink mx-3 text-xs text-slate-400 font-medium">
                          {isArabic ? 'أو التسجيل المباشر عبر' : 'Or sign up with'}
                        </span>
                        <div className="flex-grow border-t border-slate-200"></div>
                      </div>

                      <button
                        type="button"
                        onClick={signUpWithGoogle || loginWithGoogle}
                        disabled={!legalConsent || isLoading}
                        className="w-full mt-1 py-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed rounded-xl font-bold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                        </svg>
                        <span>{isArabic ? 'إنشاء حساب عبر Google' : 'Sign Up with Google'}</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* STEP 2: CHOOSE ORGANIZATION TYPE */}
                {signUpStep === 2 && (
                  <div className="space-y-4">
                    <div className="text-center pb-1">
                      <h3 className="text-sm font-bold text-slate-800">
                        {isArabic ? 'حدد نوع منشأتك الطبية' : 'Select Your Organization Type'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {isArabic 
                          ? 'يحدد هذا الخيار واجهة وتجربة الاستخدام الأساسية الخاصة بك'
                          : 'This selection configures your primary application workspace'}
                      </p>
                    </div>

                    <div className="space-y-3">
                      {/* PHARMACY CARD */}
                      <button
                        type="button"
                        onClick={() => setOrgType('RETAIL_PHARMACY')}
                        className={`w-full p-4 rounded-lg border-2 text-left rtl:text-right transition-all flex items-start gap-3.5 cursor-pointer ${
                          orgType === 'RETAIL_PHARMACY'
                            ? 'border-brand-600 bg-brand-50/70 shadow-sm ring-1 ring-brand-500'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className={`p-2.5 rounded-xl shrink-0 ${
                          orgType === 'RETAIL_PHARMACY' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          <Store className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-slate-900">
                              {isArabic ? 'صيدلية (نقطة بيع وتجزئة)' : 'PHARMACY'}
                            </h4>
                            {orgType === 'RETAIL_PHARMACY' && (
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

                      {/* WAREHOUSE CARD */}
                      <button
                        type="button"
                        onClick={() => setOrgType('WHOLESALE_WAREHOUSE')}
                        className={`w-full p-4 rounded-lg border-2 text-left rtl:text-right transition-all flex items-start gap-3.5 cursor-pointer ${
                          orgType === 'WHOLESALE_WAREHOUSE'
                            ? 'border-brand-600 bg-brand-50/70 shadow-sm ring-1 ring-brand-500'
                            : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className={`p-2.5 rounded-xl shrink-0 ${
                          orgType === 'WHOLESALE_WAREHOUSE' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-slate-900">
                              {isArabic ? 'مستودع أدوية (بيع جملة)' : 'WAREHOUSE'}
                            </h4>
                            {orgType === 'WHOLESALE_WAREHOUSE' && (
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

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setSignUpStep(1)}
                        className="w-1/3 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                        <span>{isArabic ? 'رجوع' : 'Back'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleStep2Next}
                        className="w-2/3 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <span>{isArabic ? 'التالي: تفاصيل المنشأة' : 'Next: Setup Info'}</span>
                        <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 3: ORGANIZATION SETUP */}
                {signUpStep === 3 && (
                  <form onSubmit={handleSignUpSubmit} className="space-y-4">
                    <div className="p-3 bg-brand-50 border border-brand-200/80 rounded-xl flex items-center gap-2.5 text-xs text-brand-800 font-medium">
                      <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
                      <span>
                        {orgType === 'RETAIL_PHARMACY'
                          ? (isArabic ? 'إنشاء حساب صيدلية معتمدة' : 'Setting up Retail Pharmacy Account')
                          : (isArabic ? 'إنشاء حساب مستودع أدوية جملة' : 'Setting up Wholesale Warehouse Account')}
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {orgType === 'RETAIL_PHARMACY'
                          ? (isArabic ? 'اسم الصيدلية *' : 'Pharmacy Name *')
                          : (isArabic ? 'اسم المستودع *' : 'Warehouse Name *')}
                      </label>
                      <input
                        type="text"
                        required
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                        placeholder={orgType === 'RETAIL_PHARMACY' ? 'e.g. Al-Amal Pharmacy' : 'e.g. Damascus Med Supply'}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {isArabic ? 'المدينة / العنوان' : 'Location / City'}
                      </label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                        placeholder="Damascus, Syria"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {isArabic ? 'رقم الهاتف (اختياري)' : 'Contact Phone (Optional)'}
                      </label>
                      <input
                        type="tel"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                        placeholder="+963 11 222 3344"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setSignUpStep(2)}
                        disabled={isLoading}
                        className="w-1/3 py-3.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                        <span>{isArabic ? 'رجوع' : 'Back'}</span>
                      </button>
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-2/3 py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-brand-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        {isLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <span>{isArabic ? 'إتمام الحساب والدخول' : 'Create & Enter'}</span>
                            <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
            </>)}
          </div>

          {/* Footer Helper (Only shown when not in Forgot Password) */}
          {mode !== 'forgot_password' && (
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 text-center">
              <p className="text-xs text-slate-500">
                {mode === 'signin' ? (
                  <>
                    <span>{isArabic ? 'ليس لديك حساب بعد؟ ' : "Don't have an account? "}</span>
                    <button
                      type="button"
                      onClick={() => handleModeSwitch('signup')}
                      className="font-bold text-brand-700 hover:text-brand-800 underline ml-1 rtl:ml-0 rtl:mr-1 cursor-pointer"
                    >
                      {isArabic ? 'إنشاء حساب جديد' : 'Create an Account'}
                    </button>
                  </>
                ) : (
                  <>
                    <span>{isArabic ? 'لديك حساب بالفعل؟ ' : 'Already have an account? '}</span>
                    <button
                      type="button"
                      onClick={() => handleModeSwitch('signin')}
                      className="font-bold text-brand-700 hover:text-brand-800 underline ml-1 rtl:ml-0 rtl:mr-1 cursor-pointer"
                    >
                      {isArabic ? 'تسجيل الدخول' : 'Sign In'}
                    </button>
                  </>
                )}
              </p>
            </div>
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
