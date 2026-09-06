import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { UserSession, UserRole } from "../../domain/auth";
import { PharmacyProfile, TenantType } from "../../domain/tenant";
import { auth, db, isFirebaseConfigured, firebaseConfig } from "../../infrastructure/firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { IndexedDBStore } from "../../infrastructure/storage/IndexedDBStore";
import { BackgroundSyncEngine } from "../../infrastructure/sync/BackgroundSyncEngine";

interface AuthContextType {
  currentSession: UserSession | null;
  activePharmacy: PharmacyProfile | null;
  isLoading: boolean;
  error: string | null;
  setError: (err: string | null) => void;
  clearError: () => void;
  loginWithGoogle: () => Promise<void>;
  signUpWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  resendVerificationEmail: (email: string, pass: string) => Promise<boolean>;
  loginWithEmail: (email: string, pass: string) => Promise<boolean>;
  signUpWithEmail: (
    email: string, 
    pass: string, 
    fullName?: string, 
    tenantType?: TenantType, 
    orgName?: string, 
    location?: string, 
    contactPhone?: string
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  completeOnboarding: (
    pharmacyName: string, 
    location: string, 
    contactPhone: string, 
    tenantType?: TenantType
  ) => Promise<void>;
  updateOrganizationProfile: (profileData: {
    name: string;
    address: string;
    city: string;
    zone: string;
    contactPhone: string;
    licenseNumber?: string;
    latitude?: number;
    longitude?: number;
  }) => Promise<boolean>;
  switchPharmacy: (pharmacyId: string) => Promise<void>;
  overrideDevState?: (tenantType: TenantType) => void;
  mockLogin?: (tenantType: TenantType) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Email-ownership enforcement. false = verification mail is sent at signup
 * but unverified accounts may still sign in (protects pre-existing team
 * accounts that never clicked a link). Flip to true when ready — login then
 * blocks unverified password accounts until they click the mail link.
 */
export const REQUIRE_VERIFIED_EMAIL = true;

/**
 * Canonical user-facing message shown when a fresh signup is bounced to the
 * verification wall. AuthScreen matches on this constant to offer the
 * "Resend verification email" recovery panel (never a bypass).
 */
export const VERIFICATION_REQUIRED_MSG =
  "Please verify your email address before signing in — check your inbox.";

/** LocalStorage key holding the org details captured during signup so the
 *  post-verification onboarding does not ask the identical questions twice. */
export const pendingOrgKey = (userId: string) => `eshmun_pending_org_${userId}`;

export function mapAuthErrorMessage(err: any): string {
  if (!err) return "An unexpected error occurred. Please try again.";
  const code = err.code || "";
  const msg = err.message || "";

  if (code === 'auth/email-already-in-use') {
    return "An account already exists with this email.";
  }
  if (
    code === 'auth/invalid-credential' || 
    code === 'auth/wrong-password' || 
    code === 'auth/user-not-found'
  ) {
    return "Incorrect email or password. Please verify your credentials.";
  }
  if (code === 'auth/weak-password') {
    return "Password must be at least 6 characters.";
  }
  if (code === 'auth/invalid-email') {
    return "Please enter a valid email address.";
  }
  if (code === 'auth/network-request-failed') {
    return "Network unavailable. Please check your internet connection and try again.";
  }
  if (code === 'auth/too-many-requests') {
    return "Too many failed attempts. Please wait a moment and try again.";
  }
  if (code === 'auth/popup-closed-by-user') {
    return "Sign-in popup was closed before completing. Please try again.";
  }
  if (code === 'auth/requires-recent-login') {
    return "Session expired. Please sign in again.";
  }
  if (code === 'auth/operation-not-allowed') {
    return "New account registration is temporarily unavailable. Please try again later or contact support.";
  }
  if (code === 'auth/unauthorized-domain') {
    return "Sign-in from this address is not allowed. Please open the app from its official web address.";
  }
  if (code === 'auth/user-disabled') {
    return "This account has been disabled. Please contact support.";
  }
  // Identity Toolkit REST codes (verification resend path)
  if (code === 'EMAIL_NOT_FOUND') {
    return "Incorrect email or password. Please verify your credentials.";
  }
  if (code === 'INVALID_PASSWORD' || code === 'INVALID_LOGIN_CREDENTIALS') {
    return "Incorrect email or password. Please verify your credentials.";
  }
  if (code === 'USER_DISABLED') {
    return "This account has been disabled. Please contact support.";
  }
  return msg || "Authentication failed. Please check your credentials.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentSession, setCurrentSession] = useState<UserSession | null>(null);
  const [activePharmacy, setActivePharmacy] = useState<PharmacyProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase is not configured. Please add your configuration.");
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Email-ownership gate (password accounts only; Google identities are
        // pre-verified). Active only when REQUIRE_VERIFIED_EMAIL is flipped on.
        if (REQUIRE_VERIFIED_EMAIL && !user.emailVerified && user.providerData.some(p => p.providerId === 'password')) {
          await signOut(auth);
          setError(VERIFICATION_REQUIRED_MSG);
          setIsLoading(false);
          return;
        }
        try {
          const safeDbCall = <T,>(promise: Promise<T>): Promise<T> => {
            return Promise.race([
              promise,
              new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000))
            ]);
          };

          const userDocRef = doc(db, "pharmacy_users", user.uid);
          let userDoc = await safeDbCall(getDoc(userDocRef));

          if (!userDoc.exists()) {
            const newUserProfile = {
              userId: user.uid,
              email: user.email || "",
              fullName: user.displayName || "User",
              role: "OWNER" as UserRole,
              pharmacyId: "",
              tenantId: "",
              ownedPharmacyIds: [],
              associatedTenantIds: []
            };
            await safeDbCall(setDoc(userDocRef, newUserProfile));
            userDoc = await safeDbCall(getDoc(userDocRef));
          }

          const data = userDoc.data();
          let ownedIds = (data?.ownedPharmacyIds || (data?.pharmacyId ? [data.pharmacyId] : [])).filter(
            (id: any) => id && typeof id === 'string' && id.trim() !== ''
          );
          let associatedTenantIds = (data?.associatedTenantIds || []).filter(
            (id: any) => id && typeof id === 'string' && id.trim() !== ''
          );
          let activeTenantId = (data?.tenantId || data?.pharmacyId || "").trim();

          if (!activeTenantId && associatedTenantIds.length > 0) {
            activeTenantId = associatedTenantIds[0];
          }
          if (!activeTenantId && ownedIds.length > 0) {
            activeTenantId = ownedIds[0];
          }

          // Check if there is a local cached profile for returning offline/fast recovery
          const getCachedPharmacy = (userId: string): PharmacyProfile | null => {
            try {
              const cached = localStorage.getItem(`syrian_pharmacy_profile_${userId}`);
              if (cached) return JSON.parse(cached);
            } catch (e) {}
            return null;
          };

          const cachedProfile = getCachedPharmacy(user.uid);
          if (!activeTenantId && cachedProfile?.tenantId) {
            activeTenantId = cachedProfile.tenantId;
          }

          // Zero-downtime migration for legacy structures
          if (ownedIds.length > 0 && associatedTenantIds.length === 0) {
            for (const pid of ownedIds) {
              if (!pid || typeof pid !== 'string' || !pid.trim()) continue;
              const oldRef = doc(db, "pharmacies", pid);
              const oldDoc = await safeDbCall(getDoc(oldRef));
              if (oldDoc.exists()) {
                const newRef = doc(db, "tenants", pid);
                const oldData = oldDoc.data();
                await safeDbCall(setDoc(newRef, {
                  ...oldData,
                  tenantType: oldData.tenantType || "RETAIL_PHARMACY",
                  tenantId: oldData.id || pid,
                  authorizedUsers: [user.uid, ...(oldData.authorizedUsers || [])]
                }));
              }
            }
            associatedTenantIds = [...ownedIds];
            await safeDbCall(updateDoc(userDocRef, {
              associatedTenantIds,
              tenantId: activeTenantId
            }));
          }

          let loadedProf: PharmacyProfile | null = null;

          if (activeTenantId) {
            try {
              const tenantDocRef = doc(db, "tenants", activeTenantId);
              const tenantDoc = await safeDbCall(getDoc(tenantDocRef));
              if (tenantDoc.exists()) {
                loadedProf = tenantDoc.data() as PharmacyProfile;
              } else {
                const pharmacyDocRef = doc(db, "pharmacies", activeTenantId);
                const pharmacyDoc = await safeDbCall(getDoc(pharmacyDocRef));
                if (pharmacyDoc.exists()) {
                  loadedProf = pharmacyDoc.data() as PharmacyProfile;
                }
              }
            } catch (e) {
              console.warn("Could not fetch remote tenant doc, checking local cache:", e);
            }

            if (!loadedProf && cachedProfile && cachedProfile.tenantId === activeTenantId) {
              loadedProf = cachedProfile;
            }
          }

          if (loadedProf) {
            setActivePharmacy(loadedProf);
            try {
              localStorage.setItem(`syrian_pharmacy_profile_${user.uid}`, JSON.stringify(loadedProf));
            } catch (e) {}
            IndexedDBStore.setTenant(loadedProf.tenantId);
          } else {
            setActivePharmacy(null);
            IndexedDBStore.setTenant("default");
          }

          const session: UserSession = {
            id: user.uid,
            userId: user.uid,
            email: user.email || "",
            name: user.displayName || data?.fullName || "User",
            fullName: data?.fullName || user.displayName || "User",
            role: (data?.role as UserRole) || "OWNER",
            googleToken: "",
            token: "",
            expiresAt: Date.now() + 86400000,
            pharmacyId: loadedProf?.tenantId || "",
            tenantId: loadedProf?.tenantId || "",
            ownedPharmacyIds: ownedIds,
            associatedTenantIds: associatedTenantIds
          };

          setCurrentSession(session);
        } catch (err: any) {
          console.warn("Firestore user load encountered an error:", err?.message);
          // Fallback to local cached session if available
          const cachedProfile = (() => {
            try {
              const cached = localStorage.getItem(`syrian_pharmacy_profile_${user.uid}`);
              if (cached) return JSON.parse(cached);
            } catch (e) {}
            return null;
          })();

          if (cachedProfile) {
            setActivePharmacy(cachedProfile);
            IndexedDBStore.setTenant(cachedProfile.tenantId);
            setCurrentSession({
              id: user.uid,
              userId: user.uid,
              email: user.email || "",
              name: user.displayName || "User",
              fullName: user.displayName || "User",
              role: "OWNER",
              googleToken: "",
              token: "",
              expiresAt: Date.now() + 86400000,
              pharmacyId: cachedProfile.tenantId,
              tenantId: cachedProfile.tenantId,
              ownedPharmacyIds: [cachedProfile.tenantId],
              associatedTenantIds: [cachedProfile.tenantId]
            });
          } else {
            setCurrentSession({
              id: user.uid,
              userId: user.uid,
              email: user.email || "",
              name: user.displayName || "User",
              fullName: user.displayName || "User",
              role: "OWNER",
              googleToken: "",
              token: "",
              expiresAt: Date.now() + 86400000,
              pharmacyId: "",
              tenantId: "",
              ownedPharmacyIds: [],
              associatedTenantIds: []
            });
            setActivePharmacy(null);
          }
        }
      } else {
        IndexedDBStore.setTenant("default");
        try { BackgroundSyncEngine.getInstance().stop(); } catch(e) {}
        setCurrentSession(null);
        setActivePharmacy(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const switchPharmacy = async (pharmacyId: string) => {
    const isOwned = currentSession?.ownedPharmacyIds.includes(pharmacyId);
    const isAssociated = currentSession?.associatedTenantIds?.includes(pharmacyId);
    if (!currentSession || (!isOwned && !isAssociated)) return;

    setIsLoading(true);
    setError(null);
    try {
      await updateDoc(doc(db, "pharmacy_users", currentSession.userId), {
        pharmacyId: pharmacyId,
        tenantId: pharmacyId
      });

      let tenantDoc = await getDoc(doc(db, "tenants", pharmacyId));
      if (!tenantDoc.exists()) {
        tenantDoc = await getDoc(doc(db, "pharmacies", pharmacyId));
      }

      if (tenantDoc.exists()) {
        const profile = tenantDoc.data() as PharmacyProfile;
        setActivePharmacy(profile);
        IndexedDBStore.setTenant(pharmacyId);
        try {
          localStorage.setItem(`syrian_pharmacy_profile_${currentSession.userId}`, JSON.stringify(profile));
        } catch (e) {}
        setCurrentSession(prev => prev ? { ...prev, pharmacyId, tenantId: pharmacyId } : null);
      }
    } catch (err: any) {
      console.warn("Failed to switch workspace:", err);
      setError(mapAuthErrorMessage(err) || "Failed to switch active workspace.");
    } finally {
      setIsLoading(false);
    }
  };

  const completeOnboarding = async (
    pharmacyName: string, 
    location: string, 
    contactPhone: string, 
    tenantType: TenantType = "RETAIL_PHARMACY",
    licenseNo?: string
  ) => {
    if (!currentSession) return;
    setIsLoading(true);
    setError(null);
    try {
      const tenantId = `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const cityName = location.trim() ? location.trim().split(',')[0].trim() : "Damascus";
      const isComplete = Boolean(pharmacyName.trim().length >= 2 && location.trim().length >= 2 && contactPhone.trim().length >= 4);

      const newTenant: PharmacyProfile = {
        id: tenantId,
        tenantId: tenantId,
        tenantType: tenantType,
        name: pharmacyName.trim(),
        displayName: pharmacyName.trim(),
        address: location.trim() || "Damascus, Syria",
        verifiedLocation: location.trim() || "Damascus, Syria",
        contactPhone: contactPhone.trim(),
        tier: "STANDARD",
        // P1 #8: the REAL license number when the pharmacist provided one;
        // otherwise an honest PENDING status — never a fabricated license.
        licenseNumber: licenseNo?.trim() || "PENDING",
        location: { city: cityName || "Damascus", zone: "" },
        createdAt: new Date().toISOString(),
        createdByUid: currentSession.userId,
        authorizedUsers: [currentSession.userId],
        profileCompleted: isComplete
      };

      await setDoc(doc(db, "tenants", tenantId), newTenant);

      const updatedOwnedIds = Array.from(new Set([...(currentSession.ownedPharmacyIds || []), tenantId]));
      const updatedAssociatedIds = Array.from(new Set([...(currentSession.associatedTenantIds || []), tenantId]));

      await setDoc(doc(db, "pharmacy_users", currentSession.userId), {
        pharmacyId: tenantId,
        tenantId: tenantId,
        ownedPharmacyIds: updatedOwnedIds,
        associatedTenantIds: updatedAssociatedIds,
        legalConsent: {
          termsVersion: "1.0",
          privacyVersion: "1.0",
          acceptedAt: new Date().toISOString()
        }
      }, { merge: true });

      IndexedDBStore.setTenant(tenantId);
      try {
        localStorage.setItem(`syrian_pharmacy_profile_${currentSession.userId}`, JSON.stringify(newTenant));
      } catch (e) {}

      setCurrentSession(prev => prev ? {
        ...prev,
        pharmacyId: tenantId,
        tenantId: tenantId,
        ownedPharmacyIds: updatedOwnedIds,
        associatedTenantIds: updatedAssociatedIds
      } : null);

      setActivePharmacy(newTenant);

      // P1 #8: the pending signup snapshot has served its purpose.
      try {
        if (currentSession.userId) localStorage.removeItem(pendingOrgKey(currentSession.userId));
      } catch (e) {}
    } catch (err: any) {
      console.warn("Onboarding failed:", err);
      setError(mapAuthErrorMessage(err) || "Failed to create organization profile. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    setError(null);
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase is not configured.");
      setIsLoading(false);
      return;
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.warn("Google Auth failed:", err);
      setError(mapAuthErrorMessage(err));
      setIsLoading(false);
    }
  };

  const signUpWithGoogle = loginWithGoogle;

  const resetPassword = async (email: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase is not configured.");
      setIsLoading(false);
      return false;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setIsLoading(false);
      return true;
    } catch (err: any) {
      console.warn("Login failed:", err);
      setError(mapAuthErrorMessage(err));
      setIsLoading(false);
      return false;
    }
  };

  /**
   * Resend the email-verification link for an account that is stuck at the
   * verification wall (P1 #2 recovery path). Uses the official Identity
   * Toolkit REST flow (signInWithPassword → sendOobCode VERIFY_EMAIL); it
   * authenticates the caller with real credentials and NEVER bypasses the
   * verification gate. Google-identity accounts are already verified and get
   * a clear message instead.
   */
  const resendVerificationEmail = async (email: string, pass: string): Promise<boolean> => {
    setError(null);
    if (!isFirebaseConfigured || !firebaseConfig?.apiKey) {
      setError("Firebase is not configured.");
      return false;
    }
    try {
      const key = firebaseConfig.apiKey;
      const signInRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password: pass, returnSecureToken: true })
        }
      );
      const signInData = await signInRes.json();
      if (!signInRes.ok || !signInData.idToken) {
        setError(mapAuthErrorMessage({ code: signInData.error?.message?.split(': ')[0] || 'auth/invalid-credential' }));
        return false;
      }
      if (signInData.emailVerified) {
        setError(null);
        return true; // already verified — caller can just sign in
      }
      const oobRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: signInData.idToken })
        }
      );
      if (!oobRes.ok) {
        const oobData = await oobRes.json();
        setError(mapAuthErrorMessage({ code: oobData.error?.message?.split(': ')[0] || 'auth/too-many-requests' }));
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn("Verification resend failed:", err);
      setError(mapAuthErrorMessage(err));
      return false;
    }
  };

  const loginWithEmail = async (email: string, pass: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase is not configured.");
      setIsLoading(false);
      return false;
    }
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
      setIsLoading(false);
      return true;
    } catch (err: any) {
      console.warn("Login failed:", err);
      setError(mapAuthErrorMessage(err));
      setIsLoading(false);
      return false;
    }
  };

  const signUpWithEmail = async (
    email: string, 
    pass: string, 
    fullName: string = "User",
    tenantType?: TenantType,
    orgName?: string,
    location?: string,
    contactPhone?: string
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase is not configured.");
      setIsLoading(false);
      return false;
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const userId = cred.user.uid;

      // Verify email ownership. Fire-and-forget: onboarding must not block on
      // the mail arriving. Enforcement is controlled by REQUIRE_VERIFIED_EMAIL
      // (module scope) — also checked in onAuthStateChanged at login time.
      try { await sendEmailVerification(cred.user); } catch (vErr) { console.warn("Verification email skipped:", vErr); }
      if (REQUIRE_VERIFIED_EMAIL && !cred.user.emailVerified) {
        // Preserve the org details captured at signup so the post-verification
        // onboarding can pre-fill them instead of asking the same questions
        // twice (P1 #8 — duplicate onboarding).
        if (tenantType && orgName && orgName.trim()) {
          try {
            localStorage.setItem(pendingOrgKey(userId), JSON.stringify({
              tenantType, orgName: orgName.trim(), location: location?.trim() || '', contactPhone: contactPhone?.trim() || ''
            }));
          } catch (e) {}
        }
        await signOut(auth);
        setError(VERIFICATION_REQUIRED_MSG);
        setIsLoading(false);
        return false;
      }

      let tenantId = "";
      let createdTenant: PharmacyProfile | null = null;

      if (tenantType && orgName && orgName.trim()) {
        tenantId = `tenant_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        createdTenant = {
          id: tenantId,
          tenantId: tenantId,
          tenantType: tenantType,
          name: orgName.trim(),
          displayName: orgName.trim(),
          verifiedLocation: location?.trim() || "Damascus, Syria",
          contactPhone: contactPhone?.trim() || "",
          tier: "STANDARD",
          licenseNumber: "PENDING",
          location: { city: location?.trim() || "Damascus", zone: "" },
          createdAt: new Date().toISOString(),
          createdByUid: userId,
          authorizedUsers: [userId]
        };

        await setDoc(doc(db, "tenants", tenantId), createdTenant);
      }

      const newUserProfile = {
        userId: userId,
        email: email.trim(),
        fullName: fullName || (tenantType === "WHOLESALE_WAREHOUSE" ? "Warehouse Manager" : "Pharmacist"),
        role: "OWNER" as UserRole,
        pharmacyId: tenantId,
        tenantId: tenantId,
        ownedPharmacyIds: tenantId ? [tenantId] : [],
        associatedTenantIds: tenantId ? [tenantId] : [],
        legalConsent: {
          termsVersion: "1.0",
          privacyVersion: "1.0",
          acceptedAt: new Date().toISOString()
        }
      };

      await setDoc(doc(db, "pharmacy_users", userId), newUserProfile);

      if (createdTenant) {
        IndexedDBStore.setTenant(tenantId);
        try {
          localStorage.setItem(`syrian_pharmacy_profile_${userId}`, JSON.stringify(createdTenant));
        } catch (e) {}
        setActivePharmacy(createdTenant);
        setCurrentSession({
          id: userId,
          userId: userId,
          email: email.trim(),
          name: newUserProfile.fullName,
          fullName: newUserProfile.fullName,
          role: "OWNER",
          googleToken: "",
          token: "",
          expiresAt: Date.now() + 86400000,
          pharmacyId: tenantId,
          tenantId: tenantId,
          ownedPharmacyIds: [tenantId],
          associatedTenantIds: [tenantId]
        });
      }

      setIsLoading(false);
      return true;
    } catch (err: any) {
      console.warn("Sign up failed:", err);
      setError(mapAuthErrorMessage(err));
      setIsLoading(false);
      return false;
    }
  };

  const logout = async () => {
    IndexedDBStore.setTenant("default");
    try { BackgroundSyncEngine.getInstance().stop(); } catch(e) {}

    if (!isFirebaseConfigured || !auth) {
      setCurrentSession(null);
      setActivePharmacy(null);
      return;
    }
    try {
      await signOut(auth);
    } catch (err: any) {
      console.warn("Logout failed:", err);
    } finally {
      IndexedDBStore.setTenant("default");
      try { BackgroundSyncEngine.getInstance().stop(); } catch(e) {}
      setCurrentSession(null);
      setActivePharmacy(null);
    }
  };


 /**
 * Recursively removes all undefined values from an object.
 * Firestore rejects documents containing undefined field values.
 */
 function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
 const result: Record<string, unknown> = {};
 for (const [key, value] of Object.entries(obj)) {
 if (value === undefined) continue;
 if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
 result[key] = stripUndefined(value as Record<string, unknown>);
 } else {
 result[key] = value;
 }
 }
 return result;
 }

 const updateOrganizationProfile = async (profileData: {
    name: string;
    nameAr?: string;
    address: string;
    city: string;
    zone: string;
    contactPhone: string;
    licenseNumber?: string;
    workingHours?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<boolean> => {
    if (!currentSession) {
      throw new Error("No active session found.");
    }
    const tenantId = activePharmacy?.tenantId || currentSession.pharmacyId || currentSession.tenantId;
    if (!tenantId) {
      throw new Error("No active organization found.");
    }

    setIsLoading(true);
    setError(null);
    try {
      // Null-safe trims: callers may omit optional location fields entirely.
      const city = (profileData.city || '').trim();
      const zone = (profileData.zone || '').trim();
      const address = (profileData.address || '').trim();
      const verifiedLoc = `${city}${zone ? ' - ' + zone : ''}${address ? ', ' + address : ''}`;

      const updatedTenant: PharmacyProfile = {
        ...(activePharmacy || {
          id: tenantId,
          tenantId: tenantId,
          tenantType: "RETAIL_PHARMACY",
          tier: "STANDARD",
          createdAt: new Date().toISOString(),
          createdByUid: currentSession.userId,
          authorizedUsers: [currentSession.userId]
        }),
        name: (profileData.name || '').trim(),
        ...(profileData.nameAr?.trim() ? { nameAr: profileData.nameAr.trim() } : {}),
        ...(profileData.workingHours?.trim() ? { workingHours: profileData.workingHours.trim() } : {}),
        displayName: (profileData.name || '').trim(),
        address,
        verifiedLocation: verifiedLoc,
        contactPhone: (profileData.contactPhone || '').trim(),
        licenseNumber: profileData.licenseNumber?.trim() || activePharmacy?.licenseNumber || "PENDING",
        location: {
          city: city,
          zone: zone,
          ...(profileData.latitude !== undefined ? { latitude: profileData.latitude } : {}),
          ...(profileData.longitude !== undefined ? { longitude: profileData.longitude } : {})
        },
        profileCompleted: true,
        updatedAt: new Date().toISOString()
      };

      if (db) {
        await setDoc(doc(db, "tenants", tenantId), stripUndefined(updatedTenant as unknown as Record<string, unknown>), { merge: true });
      }

      setActivePharmacy(updatedTenant);
      IndexedDBStore.setTenant(tenantId);
      try {
        localStorage.setItem(`syrian_pharmacy_profile_${currentSession.userId}`, JSON.stringify(updatedTenant));
      } catch (e) {}

      setIsLoading(false);
      return true;
    } catch (err: any) {
      console.warn("Failed to update organization profile:", err);
      const msg = mapAuthErrorMessage(err) || "Failed to save organization profile. Please try again.";
      setError(msg);
      setIsLoading(false);
      throw new Error(msg);
    }
  };

  const overrideDevState = (tenantType: TenantType) => {
    if (!currentSession) return;
    const newTenantId = tenantType === "WHOLESALE_WAREHOUSE" ? "dev_warehouse_id" : "dev_retail_id";
    IndexedDBStore.setTenant(newTenantId);
    setCurrentSession(prev => prev ? { ...prev, pharmacyId: newTenantId, tenantId: newTenantId } : null);
    const newProfile: PharmacyProfile = {
      id: newTenantId,
      tenantId: newTenantId,
      tenantType: tenantType,
      name: tenantType === "WHOLESALE_WAREHOUSE" ? "Fawbi Warehouse" : "Fawbi Pharmacy",
      nameAr: tenantType === "WHOLESALE_WAREHOUSE" ? "مستودع الفوعي المركزي" : "صيدلية الفوعي النموذجية",
      displayName: tenantType === "WHOLESALE_WAREHOUSE" ? "Fawbi Central Warehouse" : "Fawbi Pharmacy",
      address: tenantType === "WHOLESALE_WAREHOUSE" ? "Industrial District, Damascus" : "Mezzeh Highway, Damascus",
      addressAr: tenantType === "WHOLESALE_WAREHOUSE" ? "المنطقة الصناعية، دمشق" : "أوتوستراد المزة، دمشق",
      verifiedLocation: tenantType === "WHOLESALE_WAREHOUSE" ? "Damascus Industrial Zone" : "Damascus, Mezzeh",
      contactPhone: tenantType === "WHOLESALE_WAREHOUSE" ? "+963 11 662 8800" : "+963 944 112 233",
      tier: "STANDARD",
      licenseNumber: tenantType === "WHOLESALE_WAREHOUSE" ? "WH-LIC-9921-SY" : "PHAR-LIC-4421-SY",
      location: { city: "Damascus", zone: tenantType === "WHOLESALE_WAREHOUSE" ? "Industrial" : "Mezzeh" },
      createdAt: new Date().toISOString(),
      createdByUid: currentSession.userId,
      authorizedUsers: [currentSession.userId]
    };
    setActivePharmacy(newProfile);
    localStorage.setItem('fawbi_dev_mode', tenantType);

    // Asynchronously mirror tenant document to Firestore for cross-tenant discovery
    if (db) {
      setDoc(doc(db, "tenants", newTenantId), newProfile, { merge: true }).catch(err => {
        console.warn("Dev tenant Firestore mirror notice:", err);
      });
    }
  };

  /**
   * DEV-ONLY instant login without Google OAuth (localhost / vite dev server).
   * Hard-guarded by import.meta.env.DEV: a no-op in any production build.
   * Fabricates a local session + tenant profile — no Firebase Auth call,
   * no Firestore access, no writes ever leave the browser.
   */
  const mockLogin = (tenantType: TenantType) => {
    if (!import.meta.env.DEV) return;
    import("../../dev/mockAuth").then(({ createMockSession }) => {
      const { session, profile } = createMockSession(tenantType);
      setError(null);
      IndexedDBStore.setTenant(profile.tenantId);
      try {
        localStorage.setItem(`syrian_pharmacy_profile_${session.userId}`, JSON.stringify(profile));
      } catch (e) {}
      setCurrentSession(session);
      setActivePharmacy(profile);
      console.info(`[mockAuth] Signed in as ${session.fullName} (tenant: ${profile.tenantId}) — dev only, no Firebase involved.`);
    }).catch(err => console.warn("mockAuth load failed:", err));
  };

  return (
    <AuthContext.Provider value={{ 
      currentSession, 
      activePharmacy, 
      isLoading, 
      error, 
      setError,
      clearError,
      loginWithGoogle, 
      signUpWithGoogle,
      resetPassword,
      resendVerificationEmail,
      loginWithEmail, 
      signUpWithEmail, 
      logout, 
      completeOnboarding, 
      updateOrganizationProfile,
      switchPharmacy, 
      overrideDevState,
      mockLogin 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
