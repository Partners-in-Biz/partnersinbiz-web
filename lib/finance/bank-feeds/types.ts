/** Phase-5 bank feed connector framework (mock-first). Observation only — never auto-post, never initiate payments. */

export type BankFeedProviderId = 'mock' | 'live_stub'

export type BankFeedConnectionStatus =
  | 'draft'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'disconnected'

export type BankFeedSyncRunStatus = 'running' | 'succeeded' | 'partial' | 'failed'

export type BankFeedSuggestionStatus = 'pending' | 'accepted' | 'dismissed'

/** Provider-native account as returned by adapters. */
export interface BankFeedProviderAccount {
  externalAccountId: string
  name: string
  currency: string
  /** Masked number for display only (e.g. ****1234). */
  maskedAccountNumber?: string
  accountType?: 'cheque' | 'savings' | 'credit' | 'other'
  availableBalanceMinor?: number
  currentBalanceMinor?: number
}

/** Provider-native transaction before mapping into PiB bank lines. */
export interface BankFeedProviderTransaction {
  externalTransactionId: string
  externalAccountId: string
  bookedAt: string
  valueDate: string
  amountMinor: number
  currency: string
  description: string
  reference?: string
  counterpartyName?: string
  raw?: Record<string, unknown>
}

/** Canonical bank line after adapter mapping (import-ready). */
export interface BankFeedBankLine {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId: string
  syncRunId: string
  bankAccountId: string
  externalAccountId: string
  externalTransactionId: string
  statementDate: string
  effectiveDate: string
  amountMinor: number
  currency: string
  description: string
  reference?: string
  counterpartyName?: string
  sourceFingerprint: string
  /** When imported into documents bank_transactions. */
  bankTransactionId?: string
  importStatus: 'staged' | 'imported' | 'duplicate' | 'error'
  errorMessage?: string
  schemaVersion: 1
  version: number
  createdAt: string
  createdBy: string
  /** Hard gates */
  autoPosted: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
}

export interface BankFeedConnection {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  providerId: BankFeedProviderId
  label: string
  status: BankFeedConnectionStatus
  /** Linked PiB bank_accounts.id for import target. */
  bankAccountId: string
  /** Provider external account selected for this connection. */
  externalAccountId?: string
  /** Opaque cursor for incremental fetch (ISO date or provider token). */
  cursor?: string
  lastSyncAt?: string
  lastSyncRunId?: string
  lastError?: string
  /**
   * Secret material never stored inline. Live providers must reference the approved
   * secret store by id only. Mock provider requires none.
   */
  secretRefId?: string
  schemaVersion: 1
  version: number
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  externalEgressAllowed: false
  externalPaymentInitiated: false
  sarsSubmissionInitiated: false
  /** Unit tests assert adapters do not open real bank sockets. */
  noEgress: true
}

export interface BankFeedSyncRun {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId: string
  providerId: BankFeedProviderId
  status: BankFeedSyncRunStatus
  startedAt: string
  finishedAt?: string
  cursorBefore?: string
  cursorAfter?: string
  fetchedCount: number
  stagedCount: number
  importedCount: number
  duplicateCount: number
  errorCount: number
  suggestionCount: number
  errorMessage?: string
  triggeredBy: string
  schemaVersion: 1
  version: number
  /** Hard gates held on every run. */
  autoPosted: false
  externalPaymentInitiated: false
  externalEgressAllowed: false
  noEgress: true
}

export interface BankFeedSuggestion {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId: string
  syncRunId: string
  bankLineId: string
  bankTransactionId?: string
  status: BankFeedSuggestionStatus
  kind: 'suggest_expense_account' | 'suggest_counterparty' | 'flag_review' | 'match_payment'
  confidence: number
  reason: string
  suggestedAccountId?: string
  suggestedCounterpartyName?: string
  createdBy: string
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
  resolutionNote?: string
  schemaVersion: 1
  version: number
  autoPosted: false
  externalPaymentInitiated: false
}

export interface BankFeedAuditEvent {
  id: string
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId?: string
  syncRunId?: string
  eventType:
    | 'connection.created'
    | 'connection.updated'
    | 'connection.disconnected'
    | 'sync.started'
    | 'sync.finished'
    | 'sync.failed'
    | 'suggestion.accepted'
    | 'suggestion.dismissed'
  actorId: string
  at: string
  detail: string
  schemaVersion: 1
  externalEgressAllowed: false
  externalPaymentInitiated: false
  autoPosted: false
}

export type BankFeedFinanceAction =
  | 'bank_feed.connection.configure'
  | 'bank_feed.connection.read'
  | 'bank_feed.sync'
  | 'bank_feed.suggestion.accept'
  | 'bank_feed.suggestion.dismiss'
  | 'bank_feed.audit.read'
