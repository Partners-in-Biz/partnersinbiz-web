import type {
  AccountingBasis,
  FinanceApprovalAction,
  FinanceScope,
  VersionedFinanceRecord,
} from '@/lib/finance/types'
import type { HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'

export interface LegalEntity extends Omit<VersionedFinanceRecord, 'bookId'> {
  code: string
  legalName: string
  tradingName?: string
  registrationNumber?: string
  taxNumber?: string
  vatNumber?: string
  jurisdictionCode: string
  functionalCurrency: string
  defaultAccountingBasis: AccountingBasis
  fiscalYearStartMonth: number
  timezone: string
  status: 'draft' | 'active' | 'inactive'
}

export interface FinanceBranch extends Omit<VersionedFinanceRecord, 'bookId'> {
  code: string
  name: string
  status: 'active' | 'inactive'
  reportingOnly: boolean
  promotedBookId?: string
}

export interface AccountingBook extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  branchId?: string
  bookType: 'primary' | 'branch' | 'management' | 'consolidation'
  functionalCurrency: string
  accountingBasis: AccountingBasis
  jurisdictionCode: string
  taxPointPolicyId: string
  defaultControlAccountIds: Partial<Record<'receivables' | 'payables' | 'cash' | 'tax' | 'retainedEarnings', string>>
  currentPeriodId?: string
  status: 'draft' | 'active' | 'locked' | 'archived'
  cutoverAt?: string
}

export interface BookPolicyVersion extends VersionedFinanceRecord {
  bookId: string
  versionNumber: number
  accountingBasis: AccountingBasis
  taxPointPolicyId: string
  currencyPrecision: number
  roundingMode: 'half_up' | 'half_even'
  effectiveFrom: string
  effectiveTo?: string
  status: 'approved'
  approvalId: string
  approvalActorId: string
  approvedAt: string
  immutable: true
}

export interface AccountingPeriod extends VersionedFinanceRecord {
  bookId: string
  fiscalYear: number
  periodNumber: number
  startsAt: string
  endsAt: string
  status: 'open' | 'soft_closed' | 'hard_closed'
  closeApprovalId?: string
  reopenedAt?: string
  reopenApprovalId?: string
}

export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface LedgerAccount extends VersionedFinanceRecord {
  bookId: string
  code: string
  name: string
  accountType: LedgerAccountType
  normalBalance: 'debit' | 'credit'
  parentAccountId?: string
  controlAccountRole?: 'receivables' | 'payables' | 'tax' | 'payroll' | 'bank' | 'retained_earnings'
  currency: string
  currencyPolicy: 'functional_only' | 'fixed_currency'
  reportMapping: string
  postingAllowed: boolean
  activeFrom: string
  activeTo?: string
}

export interface JournalLineInput {
  accountId: string
  debitMinor: number
  creditMinor: number
  description?: string
}

export interface JournalLine extends JournalLineInput, FinanceScope {
  id: string
  journalEntryId: string
  periodId: string
  sequence: number
}

export interface PostedJournalEntry extends VersionedFinanceRecord {
  bookId: string
  periodId: string
  sourceType: string
  sourceId: string
  sourceVersion: number
  postingPurpose: string
  entryNumber: number
  entryType: string
  postingDate: string
  documentDate: string
  status: 'posted'
  description: string
  currency: string
  policyVersionId: string
  accountingBasis: AccountingBasis
  totalDebitMinor: number
  totalCreditMinor: number
  lines: JournalLine[]
  lineDigest: string
  reversesJournalEntryId?: string
  reversalReason?: string
  approvalId: string
  approvalActorId: string
  approvedAt: string
  requestId: string
  idempotencyKey: string
  correlationId?: string
  delegationId?: string
  immutable: true
  contentHash: string
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
}

export interface FinanceAuditEvent extends FinanceScope {
  id: string
  schemaVersion: 1
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  aggregateDigest: string
  eventType: string
  actorId: string
  requestId?: string
  idempotencyKey?: string
  correlationId?: string
  delegationId?: string
  reason?: string
  approvalReference?: string
  approvalAction?: FinanceApprovalAction
  occurredAt: string
  sequence: number
  previousEventId?: string
  previousEventHash?: string
  canonicalPayloadVersion: 1
  hashAlgorithmVersion: typeof HASH_ALGORITHM_VERSION
  eventHash: string
}

export interface FinanceOutboxEvent extends FinanceScope {
  id: string
  schemaVersion: 1
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  deliveryStatus: 'internal_pending'
  externalEgressAllowed: false
  createdAt: string
}
