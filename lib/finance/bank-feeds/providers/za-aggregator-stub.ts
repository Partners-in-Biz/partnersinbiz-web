/**
 * ZA open-banking / bank-data aggregator adapter skeleton.
 *
 * Production-shaped boundary for a future South African aggregator integration.
 * Does NOT bind Stitch, Yodlee, or any paid vendor:
 * - No vendor SDK imports
 * - No vendor hostnames / base URLs
 * - No network I/O
 * - Fails closed without vault-resolved secretRefId
 * - Fails closed when noEgress=true (default)
 *
 * Live implementation requires separate Peet approval — see
 * docs/architecture/finance-bank-feed-za-aggregator-boundary.md
 */

import {
  assertNoEgress,
  BankFeedAdapterEgressError,
  mapProviderTransactionsToBankLines,
  type BankFeedAdapterContext,
  type BankFeedConnectorAdapter,
  type BankFeedFetchCursor,
  type BankFeedFetchResult,
} from '../adapter'
import {
  BankFeedCredentialVaultError,
  BankFeedCredentialVaultStub,
  createEmptyBankFeedCredentialVault,
} from '../credential-vault-stub'
import type { BankFeedBankLine, BankFeedProviderAccount, BankFeedProviderTransaction } from '../types'

export const ZA_AGGREGATOR_STUB_PROVIDER_ID = 'za_aggregator_stub' as const

export class ZaAggregatorStubBankFeedProvider implements BankFeedConnectorAdapter {
  readonly providerId = ZA_AGGREGATOR_STUB_PROVIDER_ID

  constructor(private readonly vault: BankFeedCredentialVaultStub = createEmptyBankFeedCredentialVault()) {}

  async listAccounts(ctx: BankFeedAdapterContext): Promise<BankFeedProviderAccount[]> {
    this.preflight(ctx)
    // Unreachable when preflight enforces noEgress + credentials; kept for contract shape.
    throw new BankFeedAdapterEgressError(
      'za_aggregator_stub has no live account list — vendor implementation gated on Peet approval',
    )
  }

  async fetchTransactions(
    ctx: BankFeedAdapterContext,
    _externalAccountId: string,
    _cursor: BankFeedFetchCursor,
  ): Promise<BankFeedFetchResult> {
    this.preflight(ctx)
    throw new BankFeedAdapterEgressError(
      'za_aggregator_stub has no live fetch — vendor implementation gated on Peet approval',
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

  /**
   * Fail-closed gates (order matters for clear errors):
   * 1) credentials present + vault metadata usable
   * 2) noEgress blocks any future network path
   * 3) even if egress were allowed, skeleton still refuses (no vendor bind)
   */
  private preflight(ctx: BankFeedAdapterContext): void {
    if (!ctx.secretRefId?.trim()) {
      throw new BankFeedCredentialVaultError(
        'za_aggregator_stub requires secretRefId (credential vault ref) — fail closed',
      )
    }

    try {
      this.vault.assertUsableForProvider({
        orgId: ctx.orgId,
        secretRefId: ctx.secretRefId,
        providerId: this.providerId,
      })
    } catch (err) {
      if (err instanceof BankFeedCredentialVaultError) throw err
      throw new BankFeedCredentialVaultError(
        err instanceof Error ? err.message : 'Credential vault preflight failed',
      )
    }

    // Unit tests + default runtime: no real bank network.
    assertNoEgress(ctx, this.providerId)

    // Defense in depth: skeleton never proceeds to HTTP even if noEgress were false.
    throw new BankFeedAdapterEgressError(
      'za_aggregator_stub refuses live open-banking calls — no paid vendor bound; Peet vendor gate required',
    )
  }
}
