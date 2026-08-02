/** Phase-2 bank statement file import + human-gated recon suggestions. */

export type StatementFileFormat = 'csv' | 'ofx' | 'mt940' | 'auto'

export type StatementImportBatchStatus = 'parsed' | 'applied' | 'partial' | 'failed'

export type ReconSuggestionKind =
  | 'match_payment'
  | 'match_recurring'
  | 'propose_expense'
  | 'unmatched_review'

export type ReconSuggestionStatus = 'pending' | 'accepted' | 'dismissed'

export interface ParsedStatementLine {
  lineIndex: number
  statementDate: string
  effectiveDate: string
  /** Signed minor units; credits positive, debits negative (bank statement convention for cash). */
  amountMinor: number
  description: string
  reference?: string
  counterpartyName?: string
  /** Deterministic fingerprint for idempotent bank_transaction.import. */
  sourceFingerprint: string
  raw: string
}

export interface StatementImportBatch {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  format: Exclude<StatementFileFormat, 'auto'>
  fileName: string
  contentDigest: string
  status: StatementImportBatchStatus
  lineCount: number
  importedCount: number
  skippedDuplicateCount: number
  errorCount: number
  createdBy: string
  createdAt: string
  appliedAt?: string
  schemaVersion: 1
  version: number
  /** Hard gate: never true — import is observation only. */
  externalPaymentInitiated: false
}

export interface StatementImportLineRecord {
  id: string
  batchId: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  lineIndex: number
  statementDate: string
  effectiveDate: string
  amountMinor: number
  description: string
  reference?: string
  counterpartyName?: string
  sourceFingerprint: string
  raw: string
  importStatus: 'pending' | 'imported' | 'duplicate' | 'error'
  bankTransactionId?: string
  errorMessage?: string
  schemaVersion: 1
  version: number
}

export interface ReconSuggestion {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  bankAccountId: string
  bankTransactionId: string
  kind: ReconSuggestionKind
  status: ReconSuggestionStatus
  confidence: number
  reason: string
  /** Candidate payment to match, when kind=match_payment|match_recurring. */
  suggestedPaymentId?: string
  /** Human-readable expense proposal only — never auto-posted. */
  proposedExpenseDescription?: string
  proposedExpenseAmountMinor?: number
  recurringKey?: string
  createdBy: string
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
  resolutionNote?: string
  schemaVersion: 1
  version: number
  /** Hard gate: suggestions never auto-post journals/expenses/payments. */
  autoPosted: false
}

export type StatementFinanceAction =
  | 'statement.import.parse'
  | 'statement.import.apply'
  | 'recon.suggestion.generate'
  | 'recon.suggestion.accept'
  | 'recon.suggestion.dismiss'
  | 'statement.read'
