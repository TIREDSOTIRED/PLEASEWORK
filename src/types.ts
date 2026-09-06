export interface StockHistoryLog {
 id: string;
 catalogId?: string;
 timestamp: string; // ISO format
 type: 'manual_add' | 'manual_subtract' | 'scan_add' | 'reorder' | 'edit' | 'stock_in';
 delta: number;
 stockAfter: number;
 note?: string;
 userEmail?: string;
}

export interface Medicine {
 id: string;
 catalogId?: string;
 name: string;
 barcode?: string; // Strict schema - optional on TS interface for compatibility but verified by validator
 quantity?: number; // Strict schema - optional on TS interface for compatibility but verified by validator
 minThreshold: number; // Strict schema
 price: number; // Strict schema
 costPrice?: number; // Purchase cost (سعر الشراء). Defaults from catalog; profit = price - costPrice
 expiryDate: string; // Strict schema (ISO format)
 location?: string; // Strict schema - optional on TS interface for compatibility but verified by validator

 // For backwards compatibility with original layout / components
 stock: number;
 shelfLocation: string;
 batchNumber: string;

 genericName: string;
 category: string;
 dosageForm: string; // Tablet, Syrup, Injection, Capsule, etc.
 strength: string; // e.g., 500mg, 10mg
 supplier: string;
 ownerId: string; // Placeholder for Firestore multi-tenant security
 lastUpdated: string; // ISO format
 history: StockHistoryLog[];
}

export interface AppState {
 medicines: Medicine[];
 selectedMedicineId: string | null;
 activeTab: 'analytics' | 'inventory' | 'scan' | 'view' | 'settings' | 'checkout';
 searchQuery: string;
 categoryFilter: string;
 sortBy: 'name' | 'stock' | 'expiryDate' | 'lastUpdated';
 sortOrder: 'asc' | 'desc';
 isOnline: boolean; // Sync Status badge simulation state
}

export interface SaleItem {
 medId: string;
 name: string;
 quantitySold: number;
 priceAtSale: number;
 costAtSale: number;
}

export interface SaleRecord {
  saleId: string;
  timestamp: string; // ISO format
  items: SaleItem[];
  totalRevenue: number;
  totalProfit: number;
  status?: 'Paid' | 'Pending' | 'Refunded'; // Pending = دين (deferred payment, feeds ذمم مستحقة)
  // Ledger row type: POS sales are untyped; append-only rows declare
  // 'CREDIT_SETTLEMENT' (customer payment) or 'REFUND' (return reversal).
  type?: 'CREDIT_SETTLEMENT' | 'REFUND';
  customerName?: string;
  paymentMethod?: string;
  employeeId?: string;
  note?: string;
  amountPaid?: number; // settlements only
  reason?: string; // refunds only
  originalSaleId?: string; // refunds only
  refundTotal?: number; // refunds accumulated on the ORIGINAL sale (P2 #13)
  refundedQty?: Record<string, number>; // medId -> units returned (original sale only)
}

export function normalizeMedicine(med: any): Medicine {
 const stockVal = typeof med.stock === 'number' ? med.stock : (typeof med.quantity === 'number' ? med.quantity : 0);
 const qtyVal = typeof med.quantity === 'number' ? med.quantity : stockVal;
 
 const barcodeVal = med.barcode || med.batchNumber || '';
 const batchNumVal = med.batchNumber || barcodeVal || '';
 
 const locationVal = med.location || med.shelfLocation || '';
 const shelfLocVal = med.shelfLocation || locationVal || '';

 return {
 id: med.id || `med-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
 name: med.name || '',
 barcode: barcodeVal,
 quantity: qtyVal,
 minThreshold: typeof med.minThreshold === 'number' ? med.minThreshold : 10,
 price: typeof med.price === 'number' ? med.price : 0,
 expiryDate: med.expiryDate || new Date().toISOString().split('T')[0],
 location: locationVal,

 // Backward compatibility:
 stock: stockVal,
 shelfLocation: shelfLocVal,
 batchNumber: batchNumVal,

 genericName: med.genericName || med.name || '',
 category: med.category || 'General',
 dosageForm: med.dosageForm || 'Tablet',
 strength: med.strength || 'N/A',
 supplier: med.supplier || 'N/A',
 ownerId: med.ownerId || 'pharmacy-east-01',
 costPrice: typeof med.costPrice === 'number' ? med.costPrice : undefined,
 lastUpdated: med.lastUpdated || new Date().toISOString(),
 history: med.history || []
 };
}

export function validateMedicineSchema(item: any): { valid: boolean; errors: string[] } {
 const errors: string[] = [];
 if (!item.id || typeof item.id !== 'string' || item.id.trim() === '') {
 errors.push("Missing or invalid 'id' field.");
 }
 if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
 errors.push("Missing or invalid 'name' field.");
 }
 if (!item.barcode || typeof item.barcode !== 'string' || item.barcode.trim() === '') {
 errors.push("Missing or invalid 'barcode' field.");
 }
 if (item.quantity === undefined || typeof item.quantity !== 'number' || isNaN(item.quantity) || item.quantity < 0) {
 errors.push("Missing or invalid 'quantity' field.");
 }
 if (item.minThreshold === undefined || typeof item.minThreshold !== 'number' || isNaN(item.minThreshold) || item.minThreshold < 0) {
 errors.push("Missing or invalid 'minThreshold' field.");
 }
 if (item.price === undefined || typeof item.price !== 'number' || isNaN(item.price) || item.price < 0) {
 errors.push("Missing or invalid 'price' field.");
 }
 if (!item.expiryDate || typeof item.expiryDate !== 'string' || item.expiryDate.trim() === '') {
 errors.push("Missing or invalid 'expiryDate' field.");
 }
 if (!item.location || typeof item.location !== 'string' || item.location.trim() === '') {
 errors.push("Missing or invalid 'location' field.");
 }

 return {
 valid: errors.length === 0,
 errors
 };
}
