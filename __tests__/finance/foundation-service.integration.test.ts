import {
  FinanceFoundationService,
  InMemoryFinanceFoundationStore,
} from '@/lib/accounting/foundation-service'
import type { FinanceActorContext } from '@/lib/finance/types'

const actor: FinanceActorContext = {
  uid: 'finance-admin',
  orgId: 'org-a',
  membershipRole: 'owner',
  membershipActive: true,
  assignments: [{
    id: 'admin-assignment',
    orgId: 'org-a',
    userId: 'finance-admin',
    legalEntityId: 'entity-a',
    scopeMode: 'entity',
    role: 'finance_admin',
    status: 'active',
  }],
}

async function seededService() {
  const store = new InMemoryFinanceFoundationStore()
  const service = new FinanceFoundationService(store, () => '2026-07-30T10:00:00.000Z')

  await service.createLegalEntity(actor, {
    id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz (Pty) Ltd',
    jurisdictionCode: 'ZA', functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual',
    fiscalYearStartMonth: 3, timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0,
  })
  await service.createBook(actor, {
    id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: 'MAIN', name: 'Primary book',
    bookType: 'primary', functionalCurrency: 'ZAR', accountingBasis: 'accrual',
    jurisdictionCode: 'ZA', status: 'active', expectedVersion: 0,
  })
  await service.createPeriod(actor, {
    id: 'period-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    fiscalYear: 2027, periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31',
    status: 'open', expectedVersion: 0,
  })
  await service.createAccount(actor, {
    id: 'cash', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', code: '1000',
    name: 'Cash', accountType: 'asset', normalBalance: 'debit', postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0,
  })
  await service.createAccount(actor, {
    id: 'capital', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', code: '3000',
    name: 'Capital', accountType: 'equity', normalBalance: 'credit', postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0,
  })
  return { store, service }
}

describe('finance foundation service integration', () => {
  test('posts an immutable balanced journal atomically with audit and internal outbox evidence', async () => {
    const { store, service } = await seededService()
    const posted = await service.postJournal(actor, {
      id: 'journal-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      sourceType: 'opening_balance', sourceId: 'opening-a', sourceVersion: 1, postingPurpose: 'opening_balance',
      entryType: 'opening', postingDate: '2026-07-15', documentDate: '2026-07-15',
      description: 'Approved opening balance', currency: 'ZAR', expectedVersion: 0,
      lines: [
        { accountId: 'cash', debitMinor: 50_000, creditMinor: 0 },
        { accountId: 'capital', debitMinor: 0, creditMinor: 50_000 },
      ],
    })

    expect(posted.status).toBe('posted')
    expect(posted.totalDebitMinor).toBe(50_000)
    expect(store.journals.get('journal-a')?.immutable).toBe(true)
    expect(store.auditEvents).toHaveLength(6)
    expect(store.outboxEvents.at(-1)?.eventType).toBe('finance.journal.posted.v1')
    expect(() => store.unsafeUpdatePostedJournal('journal-a', { description: 'tampered' }))
      .toThrow('Posted journals are immutable')
  })

  test('rejects duplicate source posting without any partial journal, audit or outbox writes', async () => {
    const { store, service } = await seededService()
    const command = {
      id: 'journal-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      sourceType: 'manual', sourceId: 'source-a', sourceVersion: 1, postingPurpose: 'adjustment',
      entryType: 'manual', postingDate: '2026-07-15', documentDate: '2026-07-15',
      description: 'Adjustment', currency: 'ZAR', expectedVersion: 0,
      lines: [
        { accountId: 'cash', debitMinor: 1_000, creditMinor: 0 },
        { accountId: 'capital', debitMinor: 0, creditMinor: 1_000 },
      ],
    } as const
    await service.postJournal(actor, command)
    const before = { journals: store.journals.size, audit: store.auditEvents.length, outbox: store.outboxEvents.length }

    await expect(service.postJournal(actor, { ...command, id: 'journal-b' })).rejects.toThrow('Posting source already exists')
    expect({ journals: store.journals.size, audit: store.auditEvents.length, outbox: store.outboxEvents.length }).toEqual(before)
  })

  test('reverses by appending a separate posted journal while preserving the original', async () => {
    const { store, service } = await seededService()
    await service.postJournal(actor, {
      id: 'journal-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      sourceType: 'manual', sourceId: 'source-a', sourceVersion: 1, postingPurpose: 'adjustment',
      entryType: 'manual', postingDate: '2026-07-15', documentDate: '2026-07-15',
      description: 'Adjustment', currency: 'ZAR', expectedVersion: 0,
      lines: [
        { accountId: 'cash', debitMinor: 1_000, creditMinor: 0 },
        { accountId: 'capital', debitMinor: 0, creditMinor: 1_000 },
      ],
    })

    const reversal = await service.reverseJournal(actor, {
      originalJournalId: 'journal-a', reversalJournalId: 'journal-r', periodId: 'period-a',
      postingDate: '2026-07-20', reason: 'Approved correction', expectedVersion: 0,
    })

    expect(store.journals.get('journal-a')?.status).toBe('posted')
    expect(store.journals.get('journal-a')?.reversesJournalEntryId).toBeUndefined()
    expect(reversal.reversesJournalEntryId).toBe('journal-a')
    expect(reversal.lines).toEqual([
      expect.objectContaining({ accountId: 'cash', debitMinor: 0, creditMinor: 1_000 }),
      expect.objectContaining({ accountId: 'capital', debitMinor: 1_000, creditMinor: 0 }),
    ])
  })
})
