import type { AccountingBasis, FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'
import type { TaxCalculationTrace } from './tax-types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

export type CounterpartyRole = 'customer' | 'supplier'

export interface CounterpartySnapshot {
  companyId: string
  legalName: string
  tradingName?: string
  taxNumber?: string
  vatNumber?: string
  email?: string
}

export type FinanceDocumentStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'voided'
  | 'written_off'

export type FinanceDocumentPostingState = 'unposted' | 'posted' | 'reversed'

export interface FinanceDocumentLine {
  id: string
  sequence: number
  description: string
  quantityMilli: number
  unitPriceMinor: number
  taxCodeId: string
  taxIncluded: boolean
  taxableMinor: number
  taxMinor: number
  grossMinor: number
  revenueOrExpenseAccountId: string
  taxTrace: TaxCalculationTrace
  projectId?: string
  taskId?: string
  costCentreCode?: string
  branchId?: string
  companyId?: string
  contactId?: string
  employeeId?: string
}

export interface FinanceCustomerInvoice extends VersionedFinanceRecord {
  bookId: string
  documentNumber: string
  customerCompanyId: string
  customerSnapshot: CounterpartySnapshot
  issueDate: string
  dueDate: string
  currency: string
  accountingBasis: AccountingBasis
  status: FinanceDocumentStatus
  postingState: FinanceDocumentPostingState
  lines: FinanceDocumentLine[]
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  outstandingMinor: number
  openItemId?: string
  issueJournalEntryId?: string
  settlementJournalEntryIds: string[]
  voidReason?: string
  immutable: boolean
  contentHash?: string
}

export interface SupplierBill extends VersionedFinanceRecord {
  bookId: string
  documentNumber: string
  supplierCompanyId: string
  supplierSnapshot: CounterpartySnapshot
  supplierReference?: string
  issueDate: string
  receivedDate: string
  dueDate: string
  currency: string
  accountingBasis: AccountingBasis
  status: FinanceDocumentStatus
  postingState: FinanceDocumentPostingState
  lines: FinanceDocumentLine[]
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  outstandingMinor: number
  openItemId?: string
  issueJournalEntryId?: string
  settlementJournalEntryIds: string[]
  voidReason?: string
  immutable: boolean
  contentHash?: string
}

export type OpenItemSourceType = 'customer_invoice' | 'supplier_bill' | 'opening'
export type OpenItemStatus = 'open' | 'partially_paid' | 'closed' | 'voided'

export interface OpenItem extends VersionedFinanceRecord {
  bookId: string
  sourceType: OpenItemSourceType
  sourceId: string
  sourceVersion: number
  counterpartyCompanyId: string
  counterpartyRole: CounterpartyRole
  currency: string
  originalMinor: number
  outstandingMinor: number
  dueDate: string
  taxDate: string
  controlAccountId: string
  status: OpenItemStatus
}

export type PaymentDirection = 'receipt' | 'disbursement'
export type PaymentStatus = 'observed' | 'pending_verification' | 'verified' | 'reversed'
export type PaymentMethod = 'eft' | 'cash' | 'card' | 'other'

export interface FinancePayment extends VersionedFinanceRecord {
  bookId: string
  direction: PaymentDirection
  status: PaymentStatus
  amountMinor: number
  unallocatedMinor: number
  currency: string
  observedDate: string
  effectiveDate: string
  method: PaymentMethod
  provider?: string
  externalReference?: string
  counterpartyCompanyId?: string
  bankAccountId?: string
  sourceEventKey: string
  proofReference?: string
  postingJournalEntryId?: string
  reversedPaymentId?: string
  immutable: boolean
  contentHash?: string
  /** Explicitly false — domain records money movement only. */
  externalPaymentInitiated: false
}

export type AllocationTargetType =
  | 'customer_invoice'
  | 'supplier_bill'
  | 'open_item'
  | 'on_account'

export type AllocationStatus = 'active' | 'reversed'

export interface PaymentAllocation extends VersionedFinanceRecord {
  bookId: string
  paymentId: string
  targetType: AllocationTargetType
  targetId: string
  openItemId?: string
  allocatedMinor: number
  discountMinor: number
  writeOffMinor: number
  status: AllocationStatus
  reversedAllocationId?: string
  settlementJournalEntryId?: string
}

export interface BankAccount extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  currency: string
  ledgerAccountId: string
  maskedAccountNumber?: string
  active: boolean
}

export type BankTransactionReconState = 'unmatched' | 'matched' | 'excluded'

export interface BankTransaction extends VersionedFinanceRecord {
  bookId: string
  bankAccountId: string
  statementDate: string
  effectiveDate: string
  amountMinor: number
  description: string
  reference?: string
  counterpartyName?: string
  sourceFingerprint: string
  reconciliationState: BankTransactionReconState
  immutable: true
  contentHash: string
}

export type ReconciliationStatus = 'draft' | 'in_review' | 'approved' | 'reversed'

export interface Reconciliation extends VersionedFinanceRecord {
  bookId: string
  bankAccountId: string
  statementStartsAt: string
  statementEndsAt: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  statementMovementMinor: number
  matchedMovementMinor: number
  differenceMinor: number
  status: ReconciliationStatus
  approvalId?: string
  approvedAt?: string
  approvedBy?: string
  lockMetadata?: string
}

export interface ReconciliationMatch extends VersionedFinanceRecord {
  bookId: string
  reconciliationId: string
  bankTransactionId: string
  paymentId?: string
  journalEntryId?: string
  matchedMinor: number
  status: 'active' | 'reversed'
}

export interface DocumentSequenceHead {
  scopeIdentity: string
  documentKind: 'customer_invoice' | 'supplier_bill' | 'payment'
  prefix: string
  nextNumber: number
}

export type DocumentAuditEventType =
  | 'customer_invoice.created'
  | 'customer_invoice.issued'
  | 'customer_invoice.voided'
  | 'supplier_bill.created'
  | 'supplier_bill.issued'
  | 'supplier_bill.voided'
  | 'payment.observed'
  | 'payment.verified'
  | 'payment.reversed'
  | 'payment_allocation.created'
  | 'payment_allocation.reversed'
  | 'bank_account.created'
  | 'bank_transaction.imported'
  | 'reconciliation.created'
  | 'reconciliation.match_added'
  | 'reconciliation.submitted'
  | 'reconciliation.approved'
  | 'reconciliation.reversed'

export interface DocumentAuditEvent extends FinanceScope {
  id: string
  schemaVersion: 1
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  eventType: DocumentAuditEventType
  actorId: string
  requestId?: string
  idempotencyKey?: string
  reason?: string
  occurredAt: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  eventHash: string
  payload: Record<string, unknown>
  externalEgressAllowed: false
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
}

export type DocumentsScope = Required<FinanceScope>
