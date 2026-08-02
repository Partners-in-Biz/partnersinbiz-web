/** Phase-4 multi-currency books: FX policy, immutable rate sets, positions, revaluation. */

export type AccountingRateSetStatus = 'draft' | 'approved_locked'

export type FxRateSource = 'manual' | 'import'

export type FxDocumentType = 'customer_invoice' | 'supplier_bill'

export type FxPositionRole = 'receivable' | 'payable'

export type FxPositionStatus = 'open' | 'partially_settled' | 'settled'

export type FxRevaluationStatus = 'draft' | 'approved'

export type FxMonetaryPositionStatus = FxPositionStatus

export interface FxBookPolicy {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  functionalCurrency: string
  realizedFxGainAccountId: string
  realizedFxLossAccountId: string
  unrealizedFxGainAccountId: string
  unrealizedFxLossAccountId: string
  fxRevaluationClearingAccountId: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface AccountingRate {
  id: string
  orgId: string
  rateSetId: string
  fromCurrency: string
  toCurrency: string
  rateDate: string
  /** Integer scaled rate; effective rate = rateScaled / 10^rateScale. */
  rateScaled: number
  /** Decimal scale for rateScaled (default 8). */
  rateScale: number
  source: FxRateSource
  sourceRef?: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export interface AccountingRateSet {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  functionalCurrency: string
  name: string
  status: AccountingRateSetStatus
  rateIds: string[]
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  approvalReason?: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  /** Hard gate — rate tables never leave the tenant. */
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxForeignDocument {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  documentType: FxDocumentType
  currency: string
  txnTotalMinor: number
  functionalTotalMinor: number
  rateSetId: string
  rateId: string
  rateDate: string
  rateScaled: number
  rateScale: number
  documentDate: string
  positionId: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxMonetaryPosition {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  documentId: string
  role: FxPositionRole
  currency: string
  openTxnMinor: number
  originalTxnMinor: number
  settledTxnMinor: number
  /** Functional amount still open at original pin rate. */
  openFunctionalAtOriginalMinor: number
  originalRateSetId: string
  originalRateId: string
  originalRateDate: string
  originalRateScaled: number
  originalRateScale: number
  realizedFxMinor: number
  unrealizedFxMinor: number
  status: FxPositionStatus
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxJournalLine {
  accountId: string
  debitMinor: number
  creditMinor: number
  description?: string
  currency?: string
  txnAmountMinor?: number
  functionalAmountMinor?: number
}

export interface FxJournalProposal {
  purpose: string
  currency: string
  lines: FxJournalLine[]
  totalDebitMinor: number
  totalCreditMinor: number
  balanced: boolean
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
}

export interface FxSettlement {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  positionId: string
  documentId: string
  settlementDate: string
  periodId: string
  settledTxnMinor: number
  originalFunctionalPortionMinor: number
  settlementFunctionalMinor: number
  realizedFxMinor: number
  rateSetId: string
  rateId: string
  rateScaled: number
  rateScale: number
  journalProposal: FxJournalProposal
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxRevaluationLine {
  positionId: string
  documentId: string
  currency: string
  role: FxPositionRole
  openTxnMinor: number
  originalFunctionalMinor: number
  revaluedFunctionalMinor: number
  unrealizedFxMinor: number
  rateId: string
  rateScaled: number
  rateScale: number
}

export interface FxRevaluationRun {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  periodId: string
  asOfDate: string
  rateSetId: string
  status: FxRevaluationStatus
  lines: FxRevaluationLine[]
  netUnrealizedMinor: number
  journalProposal: FxJournalProposal
  reverseNextPeriod: boolean
  reversePeriodId?: string
  reversePostingDate?: string
  reverseJournalProposal?: FxJournalProposal
  approvalId?: string
  approvalActorId?: string
  approvedAt?: string
  approvalReason?: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxFunctionalReportRow {
  positionId: string
  documentId: string
  currency: string
  role: FxPositionRole
  openTxnMinor: number
  openFunctionalAtOriginalMinor: number
  openFunctionalAtReportRateMinor: number
  realizedFxMinor: number
  unrealizedFxMinor: number
  status: FxPositionStatus
}

export interface FxFunctionalReport {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  asOfDate: string
  rateSetId: string
  functionalCurrency: string
  rows: FxFunctionalReportRow[]
  totalOpenTxnMinor: number
  totalOpenFunctionalAtOriginalMinor: number
  totalOpenFunctionalAtReportRateMinor: number
  totalRealizedFxMinor: number
  totalUnrealizedFxMinor: number
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export interface FxAuditEvent {
  id: string
  orgId: string
  action: string
  actorId: string
  at: string
  entityType: string
  entityId: string
  requestId?: string
  detail?: Record<string, unknown>
  externalEgressAllowed: false
  sarsSubmissionInitiated: false
  externalPaymentInitiated: false
}

export type MultiCurrencyFinanceAction =
  | 'fx.policy.configure'
  | 'fx.rate_set.create'
  | 'fx.rate_set.add_rate'
  | 'fx.rate_set.approve'
  | 'fx.document.record'
  | 'fx.settlement.record'
  | 'fx.revaluation.create'
  | 'fx.revaluation.approve'
  | 'fx.report.generate'
  | 'fx.read'
