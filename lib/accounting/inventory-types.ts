import type { FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'

export type InventoryItemStatus = 'active' | 'archived'

export type StockMovementDirection = 'in' | 'out'

export type StockMovementReason =
  | 'opening'
  | 'bill_receipt'
  | 'invoice_issue'
  | 'adjustment'

export type StockMovementSourceType =
  | 'opening'
  | 'supplier_bill'
  | 'customer_invoice'
  | 'adjustment'

export type InventoryScope = Required<FinanceScope>

/** Org/book-scoped SKU master for light inventory (not WMS). */
export interface InventoryItem extends VersionedFinanceRecord {
  bookId: string
  sku: string
  name: string
  description?: string
  /** Income/revenue account used when selling. */
  incomeAccountId: string
  /** COGS expense account posted on invoice issue when trackQuantity. */
  cogsAccountId: string
  /** Inventory asset account for on-hand value. */
  inventoryAssetAccountId: string
  /** When false, item is non-stock (service); no qty/COGS movements. */
  trackQuantity: boolean
  status: InventoryItemStatus
  /** Quantity on hand in milli-units (1000 = 1). */
  quantityOnHandMilli: number
  /** Total inventory value in minor currency units. */
  inventoryValueMinor: number
  /** Optional CRM inventory-items linkage (informational). */
  crmInventoryItemId?: string
  currency: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface StockMovement extends VersionedFinanceRecord {
  bookId: string
  itemId: string
  sku: string
  direction: StockMovementDirection
  reason: StockMovementReason
  quantityMilli: number
  /** Unit cost used for the movement (average at out; purchase/adj at in). */
  unitCostMinor: number
  /** Total cost impact of the movement (positive). */
  totalCostMinor: number
  quantityAfterMilli: number
  valueAfterMinor: number
  sourceType: StockMovementSourceType
  sourceId: string
  sourceLineId?: string
  sourceDocumentNumber?: string
  movementAt: string
  /** Set when outbound invoice_issue produced COGS. */
  cogsPostingId?: string
  journalEntryId?: string
  actorId: string
  note?: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface StockAdjustment extends VersionedFinanceRecord {
  bookId: string
  itemId: string
  sku: string
  /** Signed delta in milli-units. */
  quantityDeltaMilli: number
  /** Required when delta > 0 (inbound unit cost). Outbound uses average. */
  unitCostMinor?: number
  totalCostMinor: number
  reason: string
  movementId: string
  adjustedAt: string
  actorId: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface CogsPostingLine {
  accountId: string
  debitMinor: number
  creditMinor: number
  description: string
}

/** Balanced COGS journal proposal/result linked to invoice issue. */
export interface CogsPosting extends VersionedFinanceRecord {
  bookId: string
  itemId: string
  sku: string
  invoiceId: string
  invoiceLineId?: string
  invoiceNumber?: string
  quantityMilli: number
  unitCostMinor: number
  cogsMinor: number
  cogsAccountId: string
  inventoryAssetAccountId: string
  lines: CogsPostingLine[]
  balanced: true
  movementId: string
  journalEntryId?: string
  postedAt: string
  actorId: string
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface InventoryAuditEvent {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  eventType: string
  entityType: string
  entityId: string
  entityVersion: number
  actorId: string
  at: string
  requestId: string
  summary: string
  externalEgressAllowed: false
  previousEventId?: string
  chainHash: string
}

export interface StockOnHandLine {
  itemId: string
  sku: string
  name: string
  trackQuantity: boolean
  status: InventoryItemStatus
  quantityOnHandMilli: number
  inventoryValueMinor: number
  averageUnitCostMinor: number
  incomeAccountId: string
  cogsAccountId: string
  inventoryAssetAccountId: string
}

export interface StockOnHandReport {
  orgId: string
  legalEntityId: string
  bookId: string
  asOf: string
  currency: string
  generatedAt: string
  itemCount: number
  trackedItemCount: number
  totalQuantityMilli: number
  totalInventoryValueMinor: number
  lines: StockOnHandLine[]
  externalEgressAllowed: false
}

export interface InventoryBundle {
  items: InventoryItem[]
  movements: StockMovement[]
  adjustments: StockAdjustment[]
  cogsPostings: CogsPosting[]
  recentAudit: InventoryAuditEvent[]
  stockOnHand: StockOnHandReport
}
