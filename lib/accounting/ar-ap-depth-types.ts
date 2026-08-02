import type { AccountingBasis, FinanceScope, VersionedFinanceRecord } from '@/lib/finance/types'
import type { CounterpartySnapshot, CounterpartyRole, FinanceDocumentLine, FinanceDocumentPostingState } from './documents-types'

export type CreditNoteStatus = 'draft' | 'issued' | 'partially_applied' | 'applied' | 'voided'
export type NoteApplicationStatus = 'active' | 'reversed'
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export type RecurringScheduleStatus = 'active' | 'paused' | 'completed'
export type StatementDraftStatus = 'draft' | 'exported'
export type StatementExportFormat = 'json' | 'csv' | 'pdf_payload'

export interface CustomerCreditNote extends VersionedFinanceRecord {
  bookId: string
  documentNumber: string
  customerCompanyId: string
  customerSnapshot: CounterpartySnapshot
  relatedInvoiceId?: string
  issueDate: string
  currency: string
  accountingBasis: AccountingBasis
  status: CreditNoteStatus
  postingState: FinanceDocumentPostingState
  lines: FinanceDocumentLine[]
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  remainingMinor: number
  issueJournalEntryId?: string
  reason?: string
  voidReason?: string
  immutable: boolean
  contentHash?: string
  massEmailAllowed: false
}

export interface SupplierDebitNote extends VersionedFinanceRecord {
  bookId: string
  documentNumber: string
  supplierCompanyId: string
  supplierSnapshot: CounterpartySnapshot
  relatedBillId?: string
  supplierReference?: string
  issueDate: string
  currency: string
  accountingBasis: AccountingBasis
  status: CreditNoteStatus
  postingState: FinanceDocumentPostingState
  lines: FinanceDocumentLine[]
  subtotalMinor: number
  taxMinor: number
  totalMinor: number
  remainingMinor: number
  issueJournalEntryId?: string
  reason?: string
  voidReason?: string
  immutable: boolean
  contentHash?: string
  massEmailAllowed: false
}

export interface NoteApplication extends VersionedFinanceRecord {
  bookId: string
  noteType: 'customer_credit_note' | 'supplier_debit_note'
  noteId: string
  targetType: 'customer_invoice' | 'supplier_bill'
  targetId: string
  openItemId?: string
  appliedMinor: number
  status: NoteApplicationStatus
  settlementJournalEntryId?: string
}

export interface RecurringDocumentTemplate {
  counterpartyCompanyId: string
  counterpartySnapshot: CounterpartySnapshot
  currency: string
  accountingBasis: AccountingBasis
  numberPrefix?: string
  dueDays: number
  lines: Array<{
    id: string
    description: string
    quantityMilli: number
    unitPriceMinor: number
    taxCodeId: string
    taxIncluded: boolean
    revenueOrExpenseAccountId: string
  }>
  supplierReferencePrefix?: string
}

export interface RecurringDocumentSchedule extends VersionedFinanceRecord {
  bookId: string
  documentKind: 'customer_invoice' | 'supplier_bill'
  name: string
  frequency: RecurringFrequency
  startDate: string
  nextRunDate: string
  endDate?: string
  status: RecurringScheduleStatus
  template: RecurringDocumentTemplate
  lastGeneratedDocumentId?: string
  lastGeneratedAt?: string
  generatedCount: number
  autoSend: false
  massEmailAllowed: false
}

export interface CounterpartyStatementLine {
  date: string
  documentType: string
  documentId: string
  documentNumber?: string
  description: string
  debitMinor: number
  creditMinor: number
  balanceMinor: number
}

export interface CounterpartyStatementDraft extends VersionedFinanceRecord {
  bookId: string
  role: CounterpartyRole
  counterpartyCompanyId: string
  counterpartySnapshot: CounterpartySnapshot
  fromDate: string
  toDate: string
  currency: string
  openingBalanceMinor: number
  closingBalanceMinor: number
  lines: CounterpartyStatementLine[]
  status: StatementDraftStatus
  exportFormat: StatementExportFormat
  exportPayload?: string
  massEmailAllowed: false
  externalEgressAllowed: false
  autoSend: false
}

export interface FinanceDocumentAttachment extends VersionedFinanceRecord {
  bookId: string
  parentType: 'customer_invoice' | 'supplier_bill' | 'customer_credit_note' | 'supplier_debit_note' | 'payment' | 'statement_draft'
  parentId: string
  fileName: string
  contentType: string
  byteSize: number
  storageRef: string
  sha256?: string
}

export interface DocumentListFilters {
  status?: string
  counterpartyCompanyId?: string
  fromDate?: string
  toDate?: string
  documentNumberContains?: string
  minOutstandingMinor?: number
  maxOutstandingMinor?: number
}

export type DocumentsScope = Required<FinanceScope>
