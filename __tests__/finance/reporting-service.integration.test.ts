import type { FinanceActorContext } from '@/lib/finance/types'
import { FinanceReportingService } from '@/lib/accounting/reporting-service'
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

const actor: FinanceActorContext = {
  uid: 'viewer',
  orgId: 'org-a',
  membershipRole: 'member',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [{
    id: 'viewer-assignment',
    orgId: 'org-a',
    userId: 'viewer',
    legalEntityId: 'entity-a',
    bookId: 'book-a',
    scopeMode: 'book',
    role: 'finance_viewer',
    status: 'active',
  }],
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
}): PostedJournalEntry {
  const lines = partial.lines.map((line, index) => ({
    ...scope,
    ...line,
    id: `${partial.id}_${String(index + 1).padStart(4, '0')}`,
    journalEntryId: partial.id,
    periodId: 'period-a',
    sequence: index + 1,
  }))
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
    postingDate: '2026-07-15',
    documentDate: '2026-07-15',
    status: 'posted',
    description: partial.id,
    currency: 'ZAR',
    policyVersionId: 'policy-a',
    accountingBasis: partial.accountingBasis,
    totalDebitMinor: lines.reduce((sum, line) => sum + line.debitMinor, 0),
    totalCreditMinor: lines.reduce((sum, line) => sum + line.creditMinor, 0),
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

describe('finance reporting service', () => {
  test('reads scoped ledger data into trial balance, P&L, and balance sheet', () => {
    const accounts = new Map<string, LedgerAccount>([
      ['cash', account({ id: 'cash', code: '1000', accountType: 'asset', normalBalance: 'debit', reportMapping: 'current_assets.cash' })],
      ['revenue', account({ id: 'revenue', code: '4000', accountType: 'income', normalBalance: 'credit', reportMapping: 'income.sales' })],
      ['capital', account({ id: 'capital', code: '3000', accountType: 'equity', normalBalance: 'credit', reportMapping: 'equity.capital' })],
      ['retained', account({ id: 'retained', code: '3100', accountType: 'equity', normalBalance: 'credit', reportMapping: 'equity.retained_earnings' })],
    ])
    const journals = new Map<string, PostedJournalEntry>([
      ['open', journal({
        id: 'open',
        postingPurpose: 'opening_balance',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'cash', debitMinor: 1_000, creditMinor: 0 },
          { accountId: 'capital', debitMinor: 0, creditMinor: 1_000 },
        ],
      })],
      ['sale', journal({
        id: 'sale',
        postingPurpose: 'document_issue',
        accountingBasis: 'accrual',
        lines: [
          { accountId: 'cash', debitMinor: 5_000, creditMinor: 0 },
          { accountId: 'revenue', debitMinor: 0, creditMinor: 5_000 },
        ],
      })],
    ])
    const periods = new Map<string, AccountingPeriod>([
      ['period-a', {
        ...scope,
        id: 'period-a',
        fiscalYear: 2027,
        periodNumber: 5,
        startsAt: '2026-07-01',
        endsAt: '2026-07-31',
        status: 'soft_closed',
      }],
    ])

    const service = new FinanceReportingService({ accounts, journals, periods })
    const tb = service.trialBalance(actor, {
      ...scope,
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
      periodId: 'period-a',
    })
    expect(tb.balanced).toBe(true)
    expect(tb.periodStatus).toBe('soft_closed')
    expect(tb.input.journalEntryIds).toEqual(['open', 'sale'])

    const pnl = service.incomeStatement(actor, {
      ...scope,
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      accountingBasis: 'accrual',
    })
    expect(pnl.netIncomeMinor).toBe(5_000)

    const sheet = service.balanceSheet(actor, {
      ...scope,
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
      retainedEarningsAccountId: 'retained',
    })
    expect(sheet.balanced).toBe(true)
    expect(sheet.totalAssetsMinor).toBe(6_000)
    expect(sheet.periodNetIncomeMinor).toBe(5_000)
  })

  test('denies report reads without finance assignment coverage', () => {
    const service = new FinanceReportingService({
      accounts: new Map(),
      journals: new Map(),
      periods: new Map(),
    })
    const stranger: FinanceActorContext = {
      ...actor,
      assignments: [],
    }
    expect(() => service.trialBalance(stranger, {
      ...scope,
      asOfDate: '2026-07-31',
      accountingBasis: 'accrual',
    })).toThrow('No active finance assignment covers this scope')
  })
})
