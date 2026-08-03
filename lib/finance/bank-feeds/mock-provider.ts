/**
 * Deterministic mock SA bank feed provider for proving kit.
 * Generates realistic ZAR cheque-account lines with no network I/O.
 */

import type {
  BankFeedBankLine,
  BankFeedProviderAccount,
  BankFeedProviderTransaction,
} from './types'
import {
  assertNoEgress,
  mapProviderTransactionsToBankLines,
  type BankFeedAdapterContext,
  type BankFeedConnectorAdapter,
  type BankFeedFetchCursor,
  type BankFeedFetchResult,
} from './adapter'

const MOCK_ACCOUNT: BankFeedProviderAccount = {
  externalAccountId: 'mock-za-cheque-001',
  name: 'Business Cheque ****4821',
  currency: 'ZAR',
  maskedAccountNumber: '****4821',
  accountType: 'cheque',
  availableBalanceMinor: 248_550_00,
  currentBalanceMinor: 248_550_00,
}

/** Seed catalogue of SA-flavoured movements (amounts in ZAR cents). */
const SA_SEED: Array<Omit<BankFeedProviderTransaction, 'externalAccountId' | 'bookedAt' | 'valueDate' | 'currency'> & {
  dayOffset: number
}> = [
  {
    dayOffset: 0,
    externalTransactionId: 'mock_tx_salary_in',
    amountMinor: 85_000_00,
    description: 'SALARY ACME HOLDINGS PTY',
    reference: 'PAY202608',
    counterpartyName: 'Acme Holdings Pty Ltd',
  },
  {
    dayOffset: 0,
    externalTransactionId: 'mock_tx_rent',
    amountMinor: -22_500_00,
    description: 'DEBIT ORDER RENT SANDTON OFFICE',
    reference: 'DO-RENT-08',
    counterpartyName: 'Sandton Properties',
  },
  {
    dayOffset: 1,
    externalTransactionId: 'mock_tx_fnb_fee',
    amountMinor: -165_00,
    description: 'FNB MONTHLY ACCOUNT FEE',
    reference: 'FEE-AUG',
  },
  {
    dayOffset: 1,
    externalTransactionId: 'mock_tx_client_eft',
    amountMinor: 12_450_00,
    description: 'EFT FROM CLIENT BLUE SKY CC',
    reference: 'INV-1042',
    counterpartyName: 'Blue Sky CC',
  },
  {
    dayOffset: 2,
    externalTransactionId: 'mock_tx_sars_paye',
    amountMinor: -18_220_50,
    description: 'SARS EFT PAYE PAYMENT',
    reference: 'PAYE-202608',
    counterpartyName: 'SARS',
  },
  {
    dayOffset: 2,
    externalTransactionId: 'mock_tx_vodacom',
    amountMinor: -899_00,
    description: 'DEBIT ORDER VODACOM BUSINESS',
    reference: 'VC-BIZ-88',
    counterpartyName: 'Vodacom',
  },
  {
    dayOffset: 3,
    externalTransactionId: 'mock_tx_card_woolies',
    amountMinor: -1_245_99,
    description: 'POS PURCHASE WOOLWORTHS SANDTON',
    reference: 'CARD*4821',
  },
  {
    dayOffset: 3,
    externalTransactionId: 'mock_tx_supplier',
    amountMinor: -6_800_00,
    description: 'EFT TO SUPPLIER PRINTWORKS',
    reference: 'BILL-331',
    counterpartyName: 'Printworks SA',
  },
]

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function addDaysUtc(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T12:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`
}

export class MockBankFeedProvider implements BankFeedConnectorAdapter {
  readonly providerId = 'mock' as const

  async listAccounts(ctx: BankFeedAdapterContext): Promise<BankFeedProviderAccount[]> {
    assertNoEgress(ctx, this.providerId)
    // Mock never opens sockets — pure in-process catalogue.
    return [{ ...MOCK_ACCOUNT }]
  }

  async fetchTransactions(
    ctx: BankFeedAdapterContext,
    externalAccountId: string,
    cursor: BankFeedFetchCursor,
  ): Promise<BankFeedFetchResult> {
    assertNoEgress(ctx, this.providerId)
    if (externalAccountId !== MOCK_ACCOUNT.externalAccountId) {
      return { transactions: [], nextCursor: cursor.value, hasMore: false }
    }

    const today = ctx.nowIso.slice(0, 10)
    // Cursor is last synced ISO date; only emit lines with valueDate > cursor.
    const since = (cursor.value || cursor.sinceIso || '1970-01-01').slice(0, 10)

    const transactions: BankFeedProviderTransaction[] = []
    for (const seed of SA_SEED) {
      // Anchor seed days relative to "today - 7" so proving kit always has recent lines.
      const anchor = addDaysUtc(today, -7)
      const valueDate = addDaysUtc(anchor, seed.dayOffset)
      if (valueDate <= since) continue
      transactions.push({
        externalAccountId,
        externalTransactionId: seed.externalTransactionId,
        bookedAt: valueDate,
        valueDate,
        amountMinor: seed.amountMinor,
        currency: 'ZAR',
        description: seed.description,
        ...(seed.reference ? { reference: seed.reference } : {}),
        ...(seed.counterpartyName ? { counterpartyName: seed.counterpartyName } : {}),
      })
    }

    const nextCursor =
      transactions.length > 0
        ? transactions.map((t) => t.valueDate).sort().slice(-1)[0]
        : since

    return {
      transactions,
      nextCursor,
      hasMore: false,
    }
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

export { MOCK_ACCOUNT as MOCK_BANK_FEED_ACCOUNT, SA_SEED as MOCK_BANK_FEED_SA_SEED }
