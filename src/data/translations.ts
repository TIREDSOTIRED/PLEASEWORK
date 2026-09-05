/**
 * ============================================================================
 * ESHMUN LOCALIZATION SYSTEM — Arabic-first, Syrian pharmacy terminology
 * ============================================================================
 * CONVENTIONS (binding for all new UI work):
 *
 * 1. Arabic is the SOURCE language. `ar` keys are written first in natural
 *    Syrian business Arabic; `en` is the professional translation.
 * 2. Access strings via the shared dictionary:
 *        const t = translations[lang];
 *        <span>{t.someKey}</span>
 *    Do NOT add new inline `lang === 'ar' ? ... : ...` ternaries for static
 *    labels. (Legacy ternaries are migrated opportunistically per screen.)
 * 3. Key naming: camelCase, grouped by feature prefix where useful
 *    (pos.*, warehouse.*, b2b.*, surplus.*).
 * 4. Numbers, prices, barcodes and phone numbers are NEVER translated or
 *    re-formatted inside translations — format at render site with
 *    toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-GB') when needed.
 * 5. Direction: never hardcode left/right — use logical utilities
 *    (ps-/pe-/ms-/me-, text-start/end) so RTL/LTR both work.
 * 6. Pharmacy terminology glossary (keep consistent everywhere):
 *    Ledger=السجل · Batch=تشغيلة · Expiry=انتهاء الصلاحية · Surplus=فائض
 *    Dispatch=شحن / تجهيز الإرسال · Receipt=استلام · Offer=عرض توريد
 *    Wholesale price=سعر الجملة · MOQ=الحد الأدنى للطلب
 * ============================================================================
 */

export interface AppTranslations {
 // Navigation & Workspace
 rxLedger: string;
 clinicPortal: string;
 syncPipeline: string;
 online: string;
 offline: string;
 firestoreDirectTunnel: string;
 cachingLogsLocally: string;
 menuNavigation: string;
 analytics: string;
 inventoryList: string;
 scanIntake: string;
 itemDetails: string;
 currentOperator: string;
 workspaceSimulator: string;
 localDatabasePersistence: string;
 secureAuditLogging: string;
 importInventory: string;
 
 // Tabs
 analyticsDashboard: string;
 activeMetricsSummary: string;
 totalUniqueMedicines: string;
 activeValuationAsset: string;
 criticalLowStock: string;
 expiryAlertsCount: string;
 distributionByDrugCategory: string;
 valuationByDrugCategory: string;
 monthlyAuditDispensations: string;
 criticalLowStockItems: string;
 criticalShelfLifeAlerts: string;
 
 // Inventory Tab
 medicineInventoryLedger: string;
 secureLedgerDescription: string;
 generateRestockOrder: string;
 safetyThresholdViolated: string;
 allClinicalComponentsSecure: string;
 searchPlaceholder: string;
 catLabel: string;
 sortLabel: string;
 componentName: string;
 currentStock: string;
 expiryDate: string;
 lastDispensation: string;
 unitsListed: string;
  sellingPrice: string;
 minAlertLimit: string;
 lowStockStatus: string;
 secureStatus: string;
 quickReduction: string;
 quickInjection: string;
 suggestedQty: string;
 reorderAnalysisList: string;
 telemetryPayload: string;
 copyPayload: string;
 closeView: string;
 copyAndClose: string;

 // Scan & Intake Tab
 clinicalIntakeScanner: string;
 intakeScannerDescription: string;
 cameraFeedStatus: string;
 streamingLive: string;
 paused: string;
 viewfinderOnline: string;
 decodedSuccess: string;
 chooseSimulatedBarcode: string;
 scanBarcodeIngest: string;
 localKnownCache: string;
 localKnownDescription: string;
 pharmaceuticalIngestion: string;
 registerBatchMetadata: string;
 medicineName: string;
 genericFormulaName: string;
 category: string;
 dosageForm: string;
 strength: string;
 shelfLocation: string;
 pricePerPack: string;
 initialStock: string;
 safetyMinThreshold: string;
 batchEanCode: string;
 regenerate: string;
 wholesaleSupplier: string;
 securityTenantContext: string;
 cancel: string;
 ingestToRegistry: string;
 usbScannerInput: string;
 usbScannerDescription: string;
 focusAndScan: string;

 // Item details Tab
 reviewTelemetry: string;
 reviewTelemetryDescription: string;
 criticalReviewSuggestions: string;
 backToLedger: string;
 tenantIsolationKey: string;
 stockSaturation: string;
 assetValuation: string;
 pricePerUnit: string;
 shelfExpiry: string;
 countdown: string;
 adjustLedgerStock: string;
 editSpecsSheet: string;
 recordLedgerStockChange: string;
 logStockReplenish: string;
 actionType: string;
 dispenseAction: string;
 replenishAction: string;
 quantityUnits: string;
 auditLogReason: string;
 commit: string;
 auditHistoryTimeline: string;
 inboundOutboundLogs: string;
 saveDetails: string;

 // Light/Dark mode
 lightMode: string;
 darkMode: string;
 language: string;

 // POS Checkout keys
 checkout: string;
 cart: string;
 totalDue: string;
 completeSale: string;
 emptyCart: string;
 itemAdded: string;
 checkoutScanner: string;
 saleSuccess: string;
 insufficientStock: string;
 searchAddPlaceholder: string;
}

export const translations: Record<'en' | 'ar', AppTranslations> = {
 en: {
 rxLedger: "Rx Ledger",
 clinicPortal: "Clinic Portal",
 syncPipeline: "Sync Pipeline",
 online: "ONLINE (SYNCED)",
 offline: "OFFLINE (LOCAL)",
 firestoreDirectTunnel: "Firestore direct tunnel",
 cachingLogsLocally: "Caching logs locally",
 menuNavigation: "Menu Navigation",
 analytics: "ANALYTICS",
 inventoryList: "INVENTORY LIST",
 scanIntake: "SCAN / INTAKE",
 itemDetails: "ITEM DETAILS",
 currentOperator: "Current Operator",
 workspaceSimulator: "WORKSPACE PORTAL SIMULATOR",
 localDatabasePersistence: "Local database persistence active",
 secureAuditLogging: "Secure Clinical Audit logging enabled",
 importInventory: "Import Inventory",
 analyticsDashboard: "Analytical Insight Center",
 activeMetricsSummary: "Active metrics mapping clinical holdings, stock volume, and fiscal balances.",
 totalUniqueMedicines: "Total Unique Medicines",
 activeValuationAsset: "Total Assets Valuation",
 criticalLowStock: "Critical Low Stock",
 expiryAlertsCount: "Expiry Alerts (30 Days)",
 distributionByDrugCategory: "Stock Holdings by Drug Category",
 valuationByDrugCategory: "Valuation by Drug Category (ل.س)",
 monthlyAuditDispensations: "Monthly Audit Transactions Flow",
 criticalLowStockItems: "Critical Low Stock Items",
 criticalShelfLifeAlerts: "Critical Shelf-Life Alerts",
 medicineInventoryLedger: "Medicine Inventory Ledger",
 secureLedgerDescription: "Secure digital ledger mapping clinical stocks, batch locations, and automated reorder pipelines.",
 generateRestockOrder: "Generate Restock Order",
 safetyThresholdViolated: "Safety Threshold Violated",
 allClinicalComponentsSecure: "All clinical components are safely stored above critical thresholds. Stock levels are perfectly compliant.",
 searchPlaceholder: "Search medicine, formula name, batch number...",
 catLabel: "Cat:",
 sortLabel: "Sort:",
 componentName: "Component Name",
 currentStock: "Current Stock",
 expiryDate: "Expiry Date",
 lastDispensation: "Last Dispensation",
 unitsListed: "component(s) listed",
  sellingPrice: "Selling price",
 minAlertLimit: "Min Alert Limit",
 lowStockStatus: "LOW STOCK",
 secureStatus: "SECURE",
 quickReduction: "Quick inventory reduction",
 quickInjection: "Quick inventory injection",
 suggestedQty: "Suggested",
 reorderAnalysisList: "Reorder Analysis List",
 telemetryPayload: "Telemetry Data Payload",
 copyPayload: "Copy Payload",
 closeView: "Close View",
 copyAndClose: "Copy & Close",
 clinicalIntakeScanner: "Clinical Intake Scanner",
 intakeScannerDescription: "Point your device camera at a product barcode or select a simulated item from the dropdown below to instantly load pharmacological parameters.",
 cameraFeedStatus: "Camera Feed Status",
 streamingLive: "Streaming Live",
 paused: "Paused",
 viewfinderOnline: "Viewfinder Online",
 decodedSuccess: "DECODED SUCCESS",
 chooseSimulatedBarcode: "Choose Simulated Barcode Target:",
 scanBarcodeIngest: "Scan Barcode / Ingest Code",
 localKnownCache: "Local Known Items Cache",
 localKnownDescription: "The system automatically matches scanned barcodes with this localized cache, auto-populating fields instantly. Manual registrations are dynamic.",
 pharmaceuticalIngestion: "Pharmaceutical Ingestion",
 registerBatchMetadata: "Register batch metadata, units, cost profile, and expiration safety limits.",
 medicineName: "Medicine Name",
 genericFormulaName: "Generic Formula Name",
 category: "Category",
 dosageForm: "Dosage Form",
 strength: "Strength",
 shelfLocation: "Shelf Location",
 pricePerPack: "Price per Pack (ل.س)",
 initialStock: "Initial Ingest Stock Units",
 safetyMinThreshold: "Safety Minimum Threshold",
 batchEanCode: "Batch / EAN Code",
 regenerate: "regenerate",
 wholesaleSupplier: "Wholesale Distributor Supplier",
 securityTenantContext: "Security Tenant context",
 cancel: "Cancel",
 ingestToRegistry: "Ingest Medicine to Registry",
 usbScannerInput: "USB Barcode Reader / QR Input",
 usbScannerDescription: "Use an external USB reader. Click the field below, then scan the barcode on your device to auto-fill.",
 focusAndScan: "Focus here & Scan Barcode...",
 reviewTelemetry: "Review Component Telemetry",
 reviewTelemetryDescription: "Select a medicine card from the main ledger registry, or choose one of the critical low-stock recommendations below to analyze audit logs and restock projections.",
 criticalReviewSuggestions: "Critical Review Suggestions",
 backToLedger: "Back to Ledger",
 tenantIsolationKey: "Tenant Isolation Key",
 stockSaturation: "Stock Saturation",
 assetValuation: "Asset Valuation",
 pricePerUnit: "Price per Unit",
 shelfExpiry: "Shelf Expiry",
 countdown: "Countdown",
 adjustLedgerStock: "Adjust Ledger Stock",
 editSpecsSheet: "Edit Specs Sheet",
 recordLedgerStockChange: "Record Ledger Stock Change",
 logStockReplenish: "Log stock replenishment or dispensations. Every submission stamps a real-time trace in this medicine's permanent document history.",
 actionType: "Action Type",
 dispenseAction: "Dispense (-)",
 replenishAction: "Replenish (+)",
 quantityUnits: "Quantity (Units)",
 auditLogReason: "Audit Log Reason",
 commit: "Commit",
 auditHistoryTimeline: "Audit History Timeline",
 inboundOutboundLogs: "Inbound & Outbound Logs",
 saveDetails: "Save Details",
 lightMode: "Light Mode",
 darkMode: "Dark Mode",
 language: "Language",
 checkout: "CHECKOUT COUNTER",
 cart: "Active Cart",
 totalDue: "Total Due",
 completeSale: "Complete Sale",
 emptyCart: "Your cart is empty. Scan barcode or search above to add items.",
 itemAdded: "Item added to cart successfully",
 checkoutScanner: "Point-of-Sale Register",
 saleSuccess: "Transaction completed! Inventory updated atomically.",
 insufficientStock: "Insufficient stock available for this item",
 searchAddPlaceholder: "Search medicine name or scan barcode to add to cart..."
 },
 ar: {
 rxLedger: "سجل الأدوية",
 clinicPortal: "بوابة العيادة",
 syncPipeline: "مزامنة البيانات",
 online: "متصل (تمت المزامنة)",
 offline: "غير متصل (محلي)",
 firestoreDirectTunnel: "اتصال مباشر بقاعدة البيانات",
 cachingLogsLocally: "حفظ السجلات محلياً",
 menuNavigation: "قائمة التنقل",
 analytics: "الإحصاءات والتحليلات",
 inventoryList: "قائمة المخزون",
 scanIntake: "إضافة دواء / مسح",
 itemDetails: "تفاصيل المادة",
 currentOperator: "المستخدم الحالي",
 workspaceSimulator: "محاكي بيئة العمل",
 localDatabasePersistence: "مزامنة قاعدة البيانات المحلية نشطة",
 secureAuditLogging: "تتبع السجلات مفعل",
 importInventory: "استيراد مخزون (CSV)",
 analyticsDashboard: "لوحة التحليلات والإحصاءات",
 activeMetricsSummary: "مؤشرات حية للمخزون، وقيمة المستودع، والأدوية.",
 totalUniqueMedicines: "إجمالي الأدوية المختلفة",
 activeValuationAsset: "القيمة الإجمالية للمخزون",
 criticalLowStock: "أدوية تقارب النفاد",
 expiryAlertsCount: "أدوية قريبة الانتهاء (30 يوم)",
 distributionByDrugCategory: "توزيع الأدوية حسب الفئة",
 valuationByDrugCategory: "قيمة المخزون حسب الفئة (ل.س)",
 monthlyAuditDispensations: "حركات الإدخال والإخراج الشهرية",
 criticalLowStockItems: "أدوية المخزون المنخفض",
 criticalShelfLifeAlerts: "تنبيهات تاريخ الصلاحية",
 medicineInventoryLedger: "سجل الأدوية العام",
 secureLedgerDescription: "سجل آمن لتتبع الأدوية ومواقعها وكمياتها.",
 generateRestockOrder: "إنشاء طلب شراء جديد",
 safetyThresholdViolated: "مخزون أقل من الحد الآمن",
 allClinicalComponentsSecure: "جميع الأدوية ضمن مستويات المخزون الآمنة.",
 searchPlaceholder: "ابحث باسم الدواء، الاسم العلمي، الباركود...",
 catLabel: "الفئة:",
 sortLabel: "ترتيب حسب:",
 componentName: "اسم الدواء",
 currentStock: "المخزون الحالي",
 expiryDate: "تاريخ الصلاحية",
 lastDispensation: "آخر عملية صرف",
 unitsListed: "مادة مسجلة",
  sellingPrice: "سعر البيع",
 minAlertLimit: "تنبيه عند وصول المخزون إلى",
 lowStockStatus: "مخزون منخفض جداً",
 secureStatus: "المخزون آمن",
 quickReduction: "سحب سريع",
 quickInjection: "إضافة سريعة",
 suggestedQty: "الكمية المقترحة",
 reorderAnalysisList: "الأدوية المقترح طلبها",
 telemetryPayload: "بيانات الطلب الرقمية",
 copyPayload: "نسخ البيانات",
 closeView: "إغلاق",
 copyAndClose: "نسخ وإغلاق",
 clinicalIntakeScanner: "الماسح الضوئي (الكاميرا)",
 intakeScannerDescription: "وجه الكاميرا نحو باركود المنتج لملء البيانات تلقائياً، أو اختر باركوداً تجريبياً.",
 cameraFeedStatus: "حالة الكاميرا",
 streamingLive: "الكاميرا تعمل",
 paused: "متوقفة مؤقتاً",
 viewfinderOnline: "الكاميرا جاهزة",
 decodedSuccess: "تمت قراءة الباركود بنجاح",
 chooseSimulatedBarcode: "اختر باركوداً تجريبياً:",
 scanBarcodeIngest: "تشغيل الكاميرا",
 localKnownCache: "الأدوية المحفوظة مسبقاً",
 localKnownDescription: "يطابق النظام الباركود مع قاعدة البيانات لملء الحقول تلقائياً وتوفير الوقت.",
 pharmaceuticalIngestion: "إدخال دواء جديد",
 registerBatchMetadata: "سجل بيانات الدواء، كميته، سعره، والحد الأدنى للمخزون.",
 medicineName: "الاسم التجاري",
 genericFormulaName: "الاسم العلمي (التركيبة)",
 category: "الفئة",
 dosageForm: "الشكل الصيدلاني",
 strength: "العيار (التركيز)",
 shelfLocation: "موقع الحفظ (الرف)",
 pricePerPack: "السعر للعلبة (ل.س)",
 initialStock: "الكمية المضافة",
 safetyMinThreshold: "الحد الأدنى للتنبيه",
 batchEanCode: "رقم الباركود (EAN)",
 regenerate: "توليد جديد",
 wholesaleSupplier: "الشركة الموردة",
 securityTenantContext: "بيئة أمان المستودع",
 cancel: "إلغاء",
 ingestToRegistry: "إضافة إلى المستودع",
 usbScannerInput: "قارئ الباركود الخارجي (USB)",
 usbScannerDescription: "انقر على الحقل أدناه ثم امسح الباركود باستخدام القارئ الخارجي لإدخاله تلقائياً.",
 focusAndScan: "انقر هنا ثم امسح الباركود...",
 reviewTelemetry: "مراجعة وتعديل بيانات الدواء",
 reviewTelemetryDescription: "اختر دواء من القائمة لمراجعة حركته وتعديل بياناته.",
 criticalReviewSuggestions: "مقترحات المراجعة العاجلة",
 backToLedger: "العودة للسجل",
 tenantIsolationKey: "رمز المستودع",
 stockSaturation: "معدل تشبع المخزون",
 assetValuation: "قيمة المخزون",
 pricePerUnit: "سعر العلبة",
 shelfExpiry: "تاريخ الصلاحية",
 countdown: "الوقت المتبقي للصلاحية",
 adjustLedgerStock: "تعديل المخزون",
 editSpecsSheet: "تعديل البيانات",
 recordLedgerStockChange: "تسجيل حركة في المخزون",
 logStockReplenish: "سجل حركات إدخال أو إخراج الدواء.",
 actionType: "نوع الحركة",
 dispenseAction: "إخراج / صرف (-)",
 replenishAction: "إدخال / إضافة (+)",
 quantityUnits: "الكمية",
 auditLogReason: "السبب أو رقم الوصفة",
 commit: "اعتماد وتسجيل",
 auditHistoryTimeline: "السجل التاريخي للحركات",
 inboundOutboundLogs: "حركات التوريد والصرف",
 saveDetails: "حفظ التعديلات",
 lightMode: "الوضع الفاتح",
 darkMode: "الوضع الداكن",
 language: "اللغة",
 checkout: "نقطة البيع المباشر",
 cart: "السلة",
 totalDue: "المجموع الكلي",
 completeSale: "إتمام البيع",
 emptyCart: "السلة فارغة. امسح باركود أو ابحث لإضافة أدوية.",
 itemAdded: "تم إضافة الدواء إلى السلة",
 checkoutScanner: "نقطة البيع (POS)",
 saleSuccess: "تمت عملية البيع بنجاح!",
 insufficientStock: "المخزون لا يكفي",
 searchAddPlaceholder: "ابحث باسم الدواء أو امسح الباركود..."
 }
};
