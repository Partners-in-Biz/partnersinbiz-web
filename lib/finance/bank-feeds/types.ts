/** Phase-5/6 bank feed connector (mock-first) + daily operator productization. Observation only — never auto-post, never initiate payments. */

/**
 * mock — default deterministic SA lines (no secrets, no network).
 * live_stub — generic refuse-closed placeholder (legacy Phase 5).
 * za_aggregator_stub — production-shaped ZA aggregator boundary (no paid vendor bind).
 */
export type BankFeedProviderId = 'mock' | 'live_stub' | 'za_aggregator_stub'

export type BankFeedConnectionStatus =
  | 'draft'
  | 'connected'
  | 'syncing'
  | 'error'
  | 'disconnected'

/** Operator-facing health (derived + persisted lastError/status). */
export type BankFeedHealthStatus =
  | 'healthy'
  | 'syncing'
  | 'stale'
  | 'error'
  | 'needs_reconnect'
  | 'disconnected'
  | 'draft'

export type BankFeedAccountFeedStatus = 'active' | 'paused' | 'error' | 'disconnected'

export type BankFeedAgingBucket = '0-7' | '8-30' | '31-60' | '61+'

export type BankFeedLineReconState =
  | 'unreconciled'
  | 'suggestion_pending'
  | 'suggestion_accepted'
  | 'suggestion_dismissed'

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

/** Per-account feed cursor/status inside a multi-account connection. */
export interface BankFeedAccountFeed {
  externalAccountId: string
  name: string
  currency: string
  maskedAccountNumber?: string
  accountType?: 'cheque' | 'savings' | 'credit' | 'other'
  /** Linked PiB bank_accounts.id for import target. */
  bankAccountId: string
  status: BankFeedAccountFeedStatus
  /** Opaque cursor for incremental fetch (ISO date or provider token). */
  cursor?: string
  lastSyncAt?: string
  lastSyncRunId?: string
  lastError?: string
}

export interface BankFeedConnectionHealth {
  status: BankFeedHealthStatus
  label: string
  detail: string
  needsReconnect: boolean
  lastSyncAt?: string
  lastError?: string
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
  /** Phase 6: continuity into recon centre / bank-rules evaluate payloads. */
  reconMaterializedAt?: string
  reconState?: BankFeedLineReconState
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
  /** Linked PiB bank_accounts.id for import target (legacy primary / default). */
  bankAccountId: string
  /** Provider external account selected for this connection (legacy primary). */
  externalAccountId?: string
  /** Opaque cursor for incremental fetch (ISO date or provider token) — legacy primary. */
  cursor?: string
  lastSyncAt?: string
  lastSyncRunId?: string
  lastError?: string
  /**
   * Phase 6 multi-account feed list. Each entry carries its own cursor/status.
   * Legacy single-account connections are normalized at read time when empty.
   */
  linkedAccounts?: BankFeedAccountFeed[]
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

/** Operator recon centre row — unreconciled aging + suggested matches. */
export interface BankFeedReconCentreItem {
  bankLineId: string
  connectionId: string
  externalAccountId: string
  bankAccountId: string
  bankTransactionId?: string
  effectiveDate: string
  description: string
  amountMinor: number
  currency: string
  importStatus: BankFeedBankLine['importStatus']
  agingDays: number
  agingBucket: BankFeedAgingBucket
  suggestionId?: string
  suggestionKind?: BankFeedSuggestion['kind']
  suggestionStatus?: BankFeedSuggestionStatus
  suggestionConfidence?: number
  /** True when bulk accept is allowed (high confidence, non-flag, non-SARS). */
  safeBulkAccept: boolean
  reconState: BankFeedLineReconState
  materializedAt?: string
  autoPosted: false
  externalPaymentInitiated: false
}

export interface BankFeedReconCentre {
  asOf: string
  unreconciledCount: number
  pendingSuggestionCount: number
  aging: Array<{ bucket: BankFeedAgingBucket; count: number; amountMinor: number }>
  items: BankFeedReconCentreItem[]
  safeBulkAcceptIds: string[]
  pendingSuggestionIds: string[]
  connectionHealth: Array<{
    connectionId: string
    label: string
    health: BankFeedConnectionHealth
    accounts: BankFeedAccountFeed[]
  }>
  /** File import remains the fallback path. */
  fileImportFallbackPath: '/portal/finance/statements'
  hardGates: {
    noEgress: true
    autoPosted: false
    externalPaymentInitiated: false
    externalEgressAllowed: false
    sarsSubmissionInitiated: false
  }
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
    | 'connection.reconnected'
    | 'accounts.linked'
    | 'sync.started'
    | 'sync.finished'
    | 'sync.failed'
    | 'suggestion.accepted'
    | 'suggestion.dismissed'
    | 'suggestion.bulk_accepted'
    | 'suggestion.bulk_dismissed'
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
  | 'bank_feed.suggestion.bulk'
  | 'bank_feed.recon.read'
  | 'bank_feed.audit.read'
