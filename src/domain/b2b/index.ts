export type B2BOrderStatus = "DRAFT" | "PENDING_APPROVAL" | "DISPATCHED" | "RECEIVED";

export interface B2BOrderItemSnapshot {
  id: string; // The snapshot ID
  originalCatalogId: string; // The ID of the medicine at time of order
  name: string; // Immutable copy of the name
  nameEn?: string;
  nameAr?: string;
  requestedQuantity: number;
  approvedQuantity?: number;
  costAtOrder: number; // Immutable price snapshot
}

export interface B2BOrder {
  orderId: string;
  buyerTenantId: string;
  buyerName?: string;
  buyerNameAr?: string;
  buyerCity?: string;
  buyerCityAr?: string;
  buyerAddress?: string;
  buyerAddressAr?: string;
  buyerPhone?: string;
  buyerLicense?: string;
  sellerTenantId: string;
  sellerName?: string;
  /** 'RETAIL_PHARMACY' | 'WHOLESALE_WAREHOUSE' — snapshot for buyer-side badges. */
  sellerType?: string;
  sellerNameAr?: string;
  sellerCity?: string;
  sellerCityAr?: string;
  sellerAddress?: string;
  sellerPhone?: string;
  sellerLicense?: string;
  status: B2BOrderStatus;
  items: B2BOrderItemSnapshot[];
  totalValue?: number;
  totalQuantity?: number;
  /** 'Cash' | 'Credit' — canonical vocabulary shared with POS ledger records.
   *  Absent on historical orders: treated as Cash (no receivable contribution). */
  paymentMethod?: 'Cash' | 'Credit';
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface WholesaleOffer {
  id: string; // offer document ID
  offerId?: string;
  sellerTenantId: string;
  sellerName: string;
  sellerCity?: string;
  catalogId: string; // canonical drug ID / sako
  tradeNameEn: string;
  tradeNameAr?: string;
  composition?: string;
  company?: string;
  manufacturer?: string;
  priceSyp: number; // Wholesale unit price
  price?: number;
  availableQuantity: number; // Marketplace available stock
  stock?: number;
  minimumOrderQuantity: number; // MOQ
  moq?: number;
  bonus?: string; // e.g. "10 + 1", "50 + 5"
  isClearance?: boolean;
  expiryDate: string; // YYYY-MM-DD
  active: boolean;
  reliability?: number;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}
