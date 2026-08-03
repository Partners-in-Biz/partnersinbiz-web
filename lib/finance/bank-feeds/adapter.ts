/**
 * Bank feed connector adapter interface.
 *
 * Live providers (future Yodlee/Stitch/etc.) implement this contract and register
 * via createBankFeedAdapterRegistry. Unit tests and default runtime use Mock only —
 * no real bank egress. Do not sign paid vendor contracts from this module.
 */

import type {
  BankFeedBankLine,
  BankFeedProviderAccount,
  BankFeedProviderId,
  BankFeedProviderTransaction,
} from './types'
import { MockBankFeedProvider } from './mock-provider'

export interface BankFeedFetchCursor {
  /** Opaque provider cursor or ISO date-time. */
  value?: string
  /** Inclusive lower bound when provider has no cursor API. */
  sinceIso?: string
}

export interface BankFeedFetchResult {
  transactions: BankFeedProviderTransaction[]
  /** Next cursor to persist on the connection after successful sync. */
  nextCursor?: string
  /** When true, caller may page again with nextCursor. */
  hasMore?: boolean
}

export interface BankFeedAdapterContext {
  orgId: string
  legalEntityId: string
  bookId: string
  connectionId: string
  /** Secret ref only — adapters must never receive raw secrets in unit tests. */
  secretRefId?: string
  /** Injected clock for deterministic mock generation. */
  nowIso: string
  /**
   * HARD GATE: when true (default in unit tests / mock), adapters must not open
   * network sockets or call external bank APIs.
   */
  noEgress: boolean
}

export interface BankFeedConnectorAdapter {
  readonly providerId: BankFeedProviderId
  listAccounts(ctx: BankFeedAdapterContext): Promise<BankFeedProviderAccount[]>
  fetchTransactions(
    ctx: BankFeedAdapterContext,
    externalAccountId: string,
    cursor: BankFeedFetchCursor,
  ): Promise<BankFeedFetchResult>
  /**
   * Map provider transactions into PiB bank lines (import-ready fingerprints).
   * Pure relative to ids; does not write storage.
   */
  mapToBankLines(input: {
    orgId: string
    legalEntityId: string
    bookId: string
    connectionId: string
    syncRunId: string
    bankAccountId: string
    transactions: BankFeedProviderTransaction[]
    actorId: string
    nowIso: string
  }): BankFeedBankLine[]
}

export class BankFeedAdapterEgressError extends Error {
  readonly statusCode = 400
  constructor(message = 'Bank feed adapter refused real-bank egress (noEgress gate)') {
    super(message)
    this.name = 'BankFeedAdapterEgressError'
  }
}

export function assertNoEgress(ctx: BankFeedAdapterContext, providerLabel: string): void {
  if (ctx.noEgress !== true) {
    // Live path still must not run without explicit future approval wiring.
    // Default production mock keeps noEgress true.
  }
  if (ctx.noEgress && providerLabel !== 'mock') {
    throw new BankFeedAdapterEgressError(
      `Provider ${providerLabel} blocked: unit/runtime noEgress=true (no real bank network calls)`,
    )
  }
}

/** Deterministic source fingerprint for idempotent bank_transaction import. */
export function bankFeedSourceFingerprint(input: {
  providerId: string
  externalAccountId: string
  externalTransactionId: string
  amountMinor: number
  valueDate: string
}): string {
  const raw = [
    input.providerId,
    input.externalAccountId,
    input.externalTransactionId,
    String(input.amountMinor),
    input.valueDate,
  ].join('|')
  // FNV-1a 32-bit hex — stable, no crypto dependency.
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `bf_${(h >>> 0).toString(16).padStart(8, '0')}_${input.externalTransactionId}`.slice(0, 120)
}

export function mapProviderTransactionsToBankLines(
  providerId: BankFeedProviderId,
  input: {
    orgId: string
    legalEntityId: string
    bookId: string
    connectionId: string
    syncRunId: string
    bankAccountId: string
    transactions: BankFeedProviderTransaction[]
    actorId: string
    nowIso: string
  },
): BankFeedBankLine[] {
  return input.transactions.map((txn, index) => {
    const sourceFingerprint = bankFeedSourceFingerprint({
      providerId,
      externalAccountId: txn.externalAccountId,
      externalTransactionId: txn.externalTransactionId,
      amountMinor: txn.amountMinor,
      valueDate: txn.valueDate,
    })
    const id = `bfl_${sourceFingerprint}`.slice(0, 120)
    const line: BankFeedBankLine = {
      id,
      orgId: input.orgId,
      legalEntityId: input.legalEntityId,
      bookId: input.bookId,
      connectionId: input.connectionId,
      syncRunId: input.syncRunId,
      bankAccountId: input.bankAccountId,
      externalAccountId: txn.externalAccountId,
      externalTransactionId: txn.externalTransactionId,
      statementDate: txn.bookedAt.slice(0, 10),
      effectiveDate: txn.valueDate.slice(0, 10),
      amountMinor: txn.amountMinor,
      currency: txn.currency.toUpperCase(),
      description: txn.description,
      sourceFingerprint,
      importStatus: 'staged',
      schemaVersion: 1,
      version: 1,
      createdAt: input.nowIso,
      createdBy: input.actorId,
      autoPosted: false,
      externalPaymentInitiated: false,
      externalEgressAllowed: false,
      ...(txn.reference ? { reference: txn.reference } : {}),
      ...(txn.counterpartyName ? { counterpartyName: txn.counterpartyName } : {}),
    }
    // index unused except keeping stable order; silence unused in lint via void
    void index
    return line
  })
}

export type BankFeedAdapterFactory = () => BankFeedConnectorAdapter

export function createBankFeedAdapterRegistry(
  overrides?: Partial<Record<BankFeedProviderId, BankFeedAdapterFactory>>,
): Record<BankFeedProviderId, BankFeedAdapterFactory> {
  return {
    mock: () => new MockBankFeedProvider(),
    live_stub: () => new LiveStubBankFeedProvider(),
    ...overrides,
  }
}

/**
 * Placeholder for a future live open-banking provider.
 * Always refuses when noEgress=true; never implements real HTTP.
 * Plug-in guide: docs/architecture/finance-bank-feed-connector.md
 */
export class LiveStubBankFeedProvider implements BankFeedConnectorAdapter {
  readonly providerId = 'live_stub' as const

  async listAccounts(ctx: BankFeedAdapterContext): Promise<BankFeedProviderAccount[]> {
    assertNoEgress(ctx, this.providerId)
    throw new BankFeedAdapterEgressError(
      'live_stub is not configured — implement BankFeedConnectorAdapter and register after vendor approval',
    )
  }

  async fetchTransactions(
    ctx: BankFeedAdapterContext,
    _externalAccountId: string,
    _cursor: BankFeedFetchCursor,
  ): Promise<BankFeedFetchResult> {
    assertNoEgress(ctx, this.providerId)
    throw new BankFeedAdapterEgressError(
      'live_stub is not configured — no real bank fetch without approved secret + vendor contract',
    )
  }

  mapToBankLines(input: {
    orgId: string
    legalEntityId: string
    bookId: string
    connectionId: string
    syncRunId: string
    bankAccountId: string
    transactions: BankFeedProviderTransaction[]
    actorId: string
    nowIso: string
  }): BankFeedBankLine[] {
    return mapProviderTransactionsToBankLines(this.providerId, input)
  }
}

export function resolveBankFeedAdapter(
  providerId: BankFeedProviderId,
  registry: Record<BankFeedProviderId, BankFeedAdapterFactory> = createBankFeedAdapterRegistry(),
): BankFeedConnectorAdapter {
  const factory = registry[providerId]
  if (!factory) {
    throw new BankFeedAdapterEgressError(`Unknown bank feed provider: ${providerId}`)
  }
  return factory()
}
