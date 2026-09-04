# SESSION STATE â€” read this first if continuing in a new thread

## Backup
`C:\Users\Melhem\Desktop\redesign-lab-backup-2026-08-24` (full copy incl. .git, made before any edits)

## Deployed to production
- Firestore RULES: expanded b2b_notifications whitelist (+sellerName, expectedDeliveryAt, deliveryWindowEnd). Live ruleset f3ef2bd4. Deployed via `firebase deploy --only firestore:rules` (CLI logged in as fawbi1718@gmail.com).

## Round 1 fixes (workflow/data integrity)
1. S1: pharmacy Surplus Requests inbox was unreachable â€” RootNavigator desktop sidebar AND mobile dock both rendered `(isWarehouse ? mobileDockTabs : mainNavTabs)`; mainNavTabs lacked b2b_queue â†’ now both render `mobileDockTabs`; dead mainNavTabs removed.
2. G1: dispatch crashed on undefined manifest fields â†’ conditional-spread keys (B2BQueueTab sanitizedManifest).
3. G2/G3: confirmWarehouseOrderReceipt â€” receipt batches created per item (POS can sell received stock), aggregate uses increment(), history schema fixed.
4. Warehouse math race: WarehouseInventoryTab.handleSaveEdits no longer writes stale stock/history from modal snapshot.
5. StockIntakeModal manual intake: stable IDs (`custom_bc_<barcode>` / `custom_nm_<name>`) instead of Date.now() duplicates.
6. WarehouseIngestionTab: increment(totalQty) instead of stale RMW.

## Round 2 fixes (UX vents from device testing)
7. Loading gate: compact branded card replaces full-screen void (RootNavigator ~497).
8. Springs â†’ `{duration:0.18, ease:'easeOut'}` in UIContext, DispatchDrawer, ScannerModePickerModal, RequiredOrganizationProfileModal, B2BMarketplaceTab, CompaniesDirectoryTab Ã—3 (no springs remain).
9. Seller badges: marketplace warehouse cards + buyer ORDER cards show teal "PharmacyÂ·Surplus" vs slate "Warehouse"; sellerType defaults for legacy offers; persisted on new orders (B2BOrder.sellerType added).
10. Profile save crash ("ÙØ´Ù„ Ø§Ù„Ø­ÙØ¸: ...trim"): AuthContext.updateOrganizationProfile null-safe trims; modal passes city/zone through.
11. Â±1 quick modifiers (pharmacy Ledger): pendingStock lock + blur() + 900ms guard â€” no more multi-add/lag.
12. Dark theme: `.dark [class*='bg-[#F8FAFC]']` override added (Medicine section was white).

## Round 3 fixes (post-OLED polish)
13. Profile modal save crash root cause: updateOrganizationProfile trimmed undefined city/zone â†’ null-safe trims; modal now passes city/zone through.
14. Â±1 quick modifiers â†’ **StockEngine** (`src/domain/services/StockEngine.ts`): optimistic local bump per tap, deltas coalesced per medicine, ONE atomic batch ~1.1s after last click, FEFO resolved at flush against fresh batches, pending queue persists in localStorage per tenant and resumes on boot; failed items re-queue (never dropped). Wired via RootNavigator `quickAdjustStock` â†’ InventoryTab `onQuickAdjust`. Pure planners exported + unit-tested (stockEngine.test.ts).
15. Dark theme rebuilt as **OLED minimal** (`index.css`): pure black surfaces, neutral white ramp, brandâ†’graphite, chroma only in status chips; legacy explicit charcoal override layer (~150 rules) deleted; `.dark .bg-[#F8FAFC]` catch-all added; `.dark .bg-slate-900` pinned elevated-dark.
16. Catalog permanently empty after "Wipe Test Data": clearLocalDatabase left CATALOG_SYNC_STATE=COMPLETE over an empty store â†’ now clears the flag; App login self-heals (COMPLETE but count==0 â†’ force re-sync).
17. Order cards + marketplace seller badges: teal PharmacyÂ·Surplus vs slate Warehouse; sellerType persisted on new orders (B2BOrder.sellerType), legacy offers classified via offerKind/default.

## Verification status
tsc clean Â· vitest 30/30 Â· built âœ… Â· Round-1/2 items device-confirmed by user; Round-3 (StockEngine feel, profile-save fix, badge rendering on device) pending user test.

## Known leftovers / decisions
- REQUIRE_VERIFIED_EMAIL=false in AuthContext (flip true when team accounts verified; login then blocks unverified password accounts).
- Stuck order PO-1340-1156 (buyer Manal â†’ seller ssepee duper) needs dispatch via new inbox.
- `hibba pharmacy` tenant has wrong tenantType (WHOLESALE_WAREHOUSE) â€” data fix in Firestore.
- Test-junk tenants + dev_* tenants exist in prod DB.
- ItemViewTab legacy `orders` collection write still present (dead pipeline).
- Full UI-consistency sweep not done.
- normalizeMedicine drops catalogId (dead code trap).
- LedgerTab financial cards hardcode status 'Paid' (debt/refund always 0).

## Firebase access
Service account key at `%TEMP%\opencode\sa-saidalete.json` â€” DELETE after session + revoke in Console. fb-inspect toolkit at `%TEMP%\opencode\fb-inspect\`.

## Round 5 - 2026-08-26 (production hygiene before first customer)
- PROD FIX: tenants/tenant_1784207792703_8wyr7i0rx (hibba pharmacy) tenantType WHOLESALE_WAREHOUSE -> RETAIL_PHARMACY (verified live).
- VERIFIED HEALTHY: PO-1340-1156 is DISPATCHED with manifest + ORDER_DISPATCHED notification present; reads come from ROOT b2b_orders (B2BMarketplaceTab.tsx:244,406). No repair needed - test Mark Received as Manal.
- SECURITY: SA key file deleted from %TEMP%. USER MUST STILL REVOKE in Google Cloud Console -> IAM -> Service Accounts -> Keys.
- CODE: REQUIRE_VERIFIED_EMAIL=true (AuthContext.tsx:68) - existing unverified test logins will be blocked until they verify.
- LedgerTab: removed dead Pending/Refunded filter chips (SaleRecord has no status field; all sales are Paid by construction).
- i18n: 9 English-only toasts converted to lang ternaries (RootNavigator x2, WarehouseIngestionTab x2, ItemViewTab x3, ScanAddTab, SettingsTab).
- vite.config.ts manualChunks: react/motion/backend splits; firebase pkg cannot be manually chunked (exports limitation), stays in index chunk.
- scripts/scrub-med-barcodes.sql: dry-run-first comma scrub for MEDS.barcode - USER runs in Supabase SQL Editor.
- Build OK: index-B0dSJhBU.js 2089kB + react 3.9k + motion 138k + backend 220k chunks. App relaunched on :4173 via vite preview of dist.
- LEFT FOR USER: run SQL scrub; revoke SA key; end-to-end phone test incl. receive flow on PO-1340-1156.

## Round 6 - 2026-08-26 (sales/profit truth pass)
- DISCOVERY: full POS exists (POSCashierView, default 'checkout' tab) + firestoreCompleteSale with FEFO batch costs, cost-provenance flags, Credit->Pending status, offline POS queue. Sales engine was NEVER missing - reports were the lie.
- costPrice (ÓÚÑ ÇáÔÑÇÁ) added: Medicine.costPrice?, SaleRecord.status?, intake modal cost field prefilled from catalog price (user's model: pharmacist sets buy+sell, catalog = default), firestoreAddMedicine now writes batch cost from costPrice (was wrongly selling price).
- LedgerTab truth pass: 'ãÈíÚÇÊ Çáíæã' now TODAY-filtered from raw salesLogs ISO stamps (was all-time relabeled); NEW 'ÑÈÍ Çáíæã ÇáÕÇÝí' card; Ðãã = status Pending only; refunds honest zero.
- SalesAnalyticsTab already had real today revenue/profit - untouched.
- Lint+build OK, app relaunched :4173.
- NEXT: test full loop POS sale -> ledger cards -> analytics; optional 14-day SVG chart + top movers.

## Round 7 - 2026-08-26 (Quantity buttons fix + Off-platform orders strategy)
- DIAGNOSIS:
  1. Pharmacy side (InventoryTab): RootNavigator was not passing onQuickAdjust={quickAdjustStock}; fallback onUpdateStock did heavy blocking Firestore getDocs+writeBatch per tap.
  2. Warehouse side (WarehouseInventoryTab): Missing onQuickAdjust, used confusing double-tap 'armedQuick' mechanism with hardcoded +-100 cartons that ignored first clicks.
- FIX:
  1. RootNavigator now passes onQuickAdjust={quickAdjustStock} to both InventoryTab and WarehouseInventoryTab.
  2. WarehouseInventoryTab rewritten: direct smooth responsive +-1 carton quick adjuster connected to StockEngine (instant optimistic UI + debounced atomic batch flush).
- STRATEGY FOR OFF-PLATFORM (OUT-OF-APP) WAREHOUSE ORDERS: Documented 3-tier approach (Manual Direct Dispatch log, rapid barcode scan-out, single-player inventory system).
- Build OK (1m 26s), live on :4173.

## Round 7b - 2026-08-26 (Tier 1 off-app orders SHIPPED)
- firestoreCompleteSale: added optional buyerNote param -> note field on ledger record (POS call unaffected).
- firestoreExternalSale wrapper: single-item cart -> same FEFO engine. Passed as onExternalSale to WarehouseInventoryTab.
- WarehouseInventoryTab: Truck button per row -> external sale modal (qty + äÞÏÇð/Ïíä) -> validates stock, dispatches via real sale engine (FEFO batch cost, ledger, offline queue). Bilingual.
- Result: WhatsApp/phone orders recorded without breaking inventory truth. Tier 2 (scan-out) + Tier 3 (bulk backfill) deferred until volume justifies.
- Lint+build OK, relaunched :4173.

## Round 8 - 2026-08-26 (dev-only mock auth)
- src/dev/mockAuth.ts: createMockSession(tenantType) -> fake UserSession + PharmacyProfile (mock_pharmacy_id / mock_warehouse_id, email fawbi-dev@mock.local so existing RoleSwitcher works post-login).
- AuthContext.mockLogin(tenantType): DEV-guarded, dynamic-imports mockAuth (prod bundle verified CLEAN - no fawbi-dev/mock-uid strings in dist). No Firebase Auth call, no OAuth, no verification gate, zero Firestore reads/writes; data stays in IndexedDB mock tenant buckets.
- AuthScreen: amber dev-only buttons (Pharmacy/Warehouse) under Google button, rendered only when import.meta.env.DEV.
- Usage: npm run dev -> localhost:3000 -> dev buttons on sign-in card. Logout via normal flow. tsc 0, build OK.
