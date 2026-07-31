import {
  assertPeriodAllowsPosting,
  FinanceValidationError,
} from '@/lib/accounting/foundation'
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
  isIncomeExpenseRecognized,
} from '@/lib/accounting/reporting'
import type { AccountingPeriod, LedgerAccount, PostedJournalEntry } from '@/lib/accounting/types'

const scope = {
  orgId: 'org-a',
  legalEntityId: 'entity-a',
  bookId: 'book-a',
  schemaVersion: 1 as const,
  version: 1,
  createdAt: '2026-07-15T10:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2026-07-15T10:00:00.000Z',
  updatedBy: 'admin',
}

function account(partial: Pick<LedgerAccount, 'id' | 'code' | 'accountType' | 'normalBalance' | 'reportMapping'>): LedgerAccount {
  return {
    ...scope,
    ...partial,
    name: partial.id,
    currency: 'ZAR',
    currencyPolicy: 'functional_only',
    postingAllowed: true,
    activeFrom: '2026-07-01',
  }
}

function journal(partial: {
  id: string
  postingPurpose: string
  accountingBasis: 'cash' | 'accrual'
  lines: Array<{ accountId: string; debitMinor: number; creditMinor: number }>
  postingDate?: string
}): PostedJournalEntry {
  const lines = partial.lines.map((line, index) => ({
    ...scope,
    ...line,
    id: `${partial.id}_${String(index + 1).padStart(4, '0')}`,
    journalEntryId: partial.id,
    periodId: 'period-a',
    sequence: index + 1,
  }))
  const totalDebitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0)
  const totalCreditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0)
  return {
    ...scope,
    id: partial.id,
    periodId: 'period-a',
    sourceType: 'test',
    sourceId: partial.id,
    sourceVersion: 1,
    postingPurpose: partial.postingPurpose,
    entryNumber: 1,
    entryType: 'standard',
    postingDate: partial.postingDate ?? '2026-07-15',
    documentDate: partial.postingDate ?? '2026-07-15',
    status: 'posted',
    description: partial.id,
    currency: 'ZAR',
    policyVersionId: 'policy-a',
    accountingBasis: partial.accountingBasis,
    totalDebitMinor,
    totalCreditMinor,
    lines,
    lineDigest: 'digest',
    approvalId: 'approval',
    approvalActorId: 'approver',
    approvedAt: '2026-07-15T10:00:00.000Z',
    requestId: 'req',
    idempotencyKey: 'idem',
    immutable: true,
    contentHash: 'hash',
    canonicalPayloadVersion: 1,
    hashAlgorithmVersion: 'sha256-v1',
  }
}

const accounts: LedgerAccount[] = [
  account({ id: 'cash', code: '1000', accountType: 'asset', normalBalance: 'debit', reportMapping: 'current_assets.cash' }),
  account({ id: 'ar', code: '1100', accountType: 'asset', normalBalance: 'debit', reportMapping: 'current_assets.receivables' }),
  account({ id: 'vat', code: '2100', accountType: 'liability', normalBalance: 'credit', reportMapping: 'current_liabilities.tax' }),
  account({ id: 'capital', code: '3000', accountType: 'equity', normalBalance: 'credit', reportMapping: 'equity.capital' }),
  account({ id: 'revenue', code: '4000', accountType: 'income', normalBalance: 'credit', reportMapping: 'income.sales' }),
  account({ id: 'expense', code: '5000', accountType: 'expense', normalBalance: 'debit', reportMapping: 'expense.ops' }),
  account({ id: 'retained', code: '3100', accountType: 'equity', normalBalance: 'credit', reportMapping: 'equity.retained_earnings' }),
]

describe('accountant-ready financial statements', () => {
  test('builds a balanced trial balance with traceable journal inputs', () => {
    const journals = [
      journal({
        id: 'j1',
        postingPurpose: 'document_issue',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'ar', debitMinor: 11_500, creditMinor: 0 },
          { accountId: 'revenue', debitMinor: 0, creditMinor: 10_000 },
          { accountId: 'vat', debitMinor: 0, creditMinor: 1_500 },
        ],
      }),
    ]

    const tb = buildTrialBalance({
      scope: { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
      accounts,
      journals,
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
    })

    expect(tb.balanced).toBe(true)
    expect(tb.totalDebitMinor).toBe(tb.totalCreditMinor)
    expect(tb.lines.find((line) => line.accountId === 'revenue')?.creditMinor).toBe(10_000)
    expect(tb.input.journalEntryIds).toEqual(['j1'])
    expect(tb.input.asOfDate).toBe('2026-07-31')
    expect(tb.inputDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  test('cash basis excludes issue-time income recognition while accrual includes it', () => {
    const issue = journal({
      id: 'issue',
      postingPurpose: 'document_issue',
      accountingBasis: 'accrual',
      lines: [
        { accountId: 'ar', debitMinor: 10_000, creditMinor: 0 },
        { accountId: 'revenue', debitMinor: 0, creditMinor: 10_000 },
      ],
    })
    const receipt = journal({
      id: 'receipt',
      postingPurpose: 'verified_allocation',
      accountingBasis: 'cash',
      lines: [
        { accountId: 'cash', debitMinor: 10_000, creditMinor: 0 },
        { accountId: 'revenue', debitMinor: 0, creditMinor: 10_000 },
      ],
    })

    expect(isIncomeExpenseRecognized('accrual', 'document_issue')).toBe(true)
    expect(isIncomeExpenseRecognized('cash', 'document_issue')).toBe(false)
    expect(isIncomeExpenseRecognized('cash', 'verified_allocation')).toBe(true)

    const accrualPnL = buildIncomeStatement({
      scope: { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
      accounts,
      journals: [issue],
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      accountingBasis: 'accrual',
    })
    const cashPnL = buildIncomeStatement({
      scope: { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
      accounts,
      journals: [issue, receipt],
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      accountingBasis: 'cash',
    })

    expect(accrualPnL.netIncomeMinor).toBe(10_000)
    expect(cashPnL.netIncomeMinor).toBe(10_000)
    expect(cashPnL.input.journalEntryIds).toEqual(['receipt'])
    expect(accrualPnL.input.journalEntryIds).toEqual(['issue'])
  })

  test('balance sheet absorbs period net income into equity and stays in balance', () => {
    const journals = [
      journal({
        id: 'open',
        postingPurpose: 'opening_balance',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'cash', debitMinor: 5_000, creditMinor: 0 },
          { accountId: 'capital', debitMinor: 0, creditMinor: 5_000 },
        ],
      }),
      journal({
        id: 'sale',
        postingPurpose: 'document_issue',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'cash', debitMinor: 11_500, creditMinor: 0 },
          { accountId: 'revenue', debitMinor: 0, creditMinor: 10_000 },
          { accountId: 'vat', debitMinor: 0, creditMinor: 1_500 },
        ],
      }),
      journal({
        id: 'cost',
        postingPurpose: 'document_issue',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'expense', debitMinor: 2_000, creditMinor: 0 },
          { accountId: 'cash', debitMinor: 0, creditMinor: 2_000 },
        ],
      }),
    ]

    const sheet = buildBalanceSheet({
      scope: { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
      accounts,
      journals,
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
      retainedEarningsAccountId: 'retained',
    })

    expect(sheet.balanced).toBe(true)
    expect(sheet.totalAssetsMinor).toBe(14_500)
    expect(sheet.totalLiabilitiesMinor + sheet.totalEquityMinor).toBe(14_500)
    expect(sheet.periodNetIncomeMinor).toBe(8_000)
    expect(sheet.inputDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  test('period close rules still block ordinary postings while reports remain readable', () => {
    const period: AccountingPeriod = {
      ...scope,
      id: 'period-a',
      fiscalYear: 2027,
      periodNumber: 5,
      startsAt: '2026-07-01',
      endsAt: '2026-07-31',
      status: 'soft_closed',
    }
    expect(() => assertPeriodAllowsPosting(period, '2026-07-15', false))
      .toThrow(FinanceValidationError)
    expect(() => assertPeriodAllowsPosting(period, '2026-07-15', true)).not.toThrow()

    const hard: AccountingPeriod = { ...period, status: 'hard_closed' }
    expect(() => assertPeriodAllowsPosting(hard, '2026-07-15', true))
      .toThrow('hard closed')

    const tb = buildTrialBalance({
      scope: { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
      accounts,
      journals: [],
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
      periodStatus: hard.status,
    })
    expect(tb.periodStatus).toBe('hard_closed')
    expect(tb.balanced).toBe(true)
  })
})
