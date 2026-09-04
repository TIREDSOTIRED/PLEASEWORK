import { PharmacyProfile, TenantType } from "../domain/tenant";
import { UserSession } from "../domain/auth";

/**
 * DEV-ONLY mock authentication.
 *
 * This module is dynamically imported inside import.meta.env.DEV guards only,
 * so it never ships in production bundles (vite build drops the chunk).
 *
 * Mock sessions are pure client-side state: no Firebase Auth call, no OAuth
 * popup, no email-verification gate, no Firestore reads/writes. Data written
 * while mock-logged-in lives in IndexedDB under the mock tenantId bucket and
 * never reaches production Firestore (rules would reject it anyway since
 * there is no real request.auth).
 *
 * The shared email contains "fawbi" so the existing in-app RoleSwitcher
 * (Pharmacy <-> Warehouse toggle) stays available after mock login.
 */

export const MOCK_AUTH_ENABLED = import.meta.env.DEV;

export function createMockSession(tenantType: TenantType): { session: UserSession; profile: PharmacyProfile } {
  const isWarehouse = tenantType === "WHOLESALE_WAREHOUSE";
  const tenantId = isWarehouse ? "mock_warehouse_id" : "mock_pharmacy_id";
  const uid = isWarehouse ? "mock-uid-warehouse" : "mock-uid-pharmacy";
  const email = "fawbi-dev@mock.local";
  const fullName = isWarehouse ? "Mock Warehouse Manager" : "Mock Pharmacist";

  const profile: PharmacyProfile = {
    id: tenantId,
    tenantId: tenantId,
    tenantType: tenantType,
    name: isWarehouse ? "Mock Warehouse" : "Mock Pharmacy",
    nameAr: isWarehouse ? "مستودع تجريبي (تطوير)" : "صيدلية تجريبية (تطوير)",
    displayName: isWarehouse ? "Mock Central Warehouse" : "Mock Pharmacy",
    address: isWarehouse ? "Industrial District, Damascus" : "Mezzeh Highway, Damascus",
    addressAr: isWarehouse ? "المنطقة الصناعية، دمشق" : "أوتوستراد المزة، دمشق",
    verifiedLocation: isWarehouse ? "Damascus Industrial Zone" : "Damascus, Mezzeh",
    contactPhone: "+963 000 000 000",
    tier: "STANDARD",
    licenseNumber: "DEV-MOCK-0000",
    location: { city: "Damascus", zone: isWarehouse ? "Industrial" : "Mezzeh" },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUid: uid,
    authorizedUsers: [uid],
    profileCompleted: true
  };

  const session: UserSession = {
    id: uid,
    userId: uid,
    email: email,
    name: fullName,
    fullName: fullName,
    role: "OWNER",
    googleToken: "",
    token: "",
    expiresAt: Date.now() + 86400000,
    pharmacyId: tenantId,
    tenantId: tenantId,
    ownedPharmacyIds: [tenantId],
    associatedTenantIds: [tenantId]
  };

  return { session, profile };
}
