import { FinanceFoundationService, InMemoryFinanceFoundationStore } from '../../lib/accounting/foundation-service'
import type { FinanceActorContext } from '../../lib/finance/types'

async function main() {
  const now = () => '2026-07-30T12:00:00.000Z'
  const actor: FinanceActorContext = {
    uid: 'staging-verifier', orgId: 'staging-finance-foundation', membershipRole: 'admin', membershipActive: true,
    assignments: [{
      id: 'staging-admin', orgId: 'staging-finance-foundation', userId: 'staging-verifier',
      legalEntityId: 'entity-staging', scopeMode: 'entity', role: 'finance_admin', status: 'active',
    }],
  }
  const store = new InMemoryFinanceFoundationStore()
  const service = new FinanceFoundationService(store, now)
  await service.createLegalEntity(actor, {
    id: 'entity-staging', orgId: actor.orgId, code: 'STG', legalName: 'Staging Finance Entity',
    jurisdictionCode: 'ZA', functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual',
    fiscalYearStartMonth: 3, timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0,
  })
  await service.createBranch(actor, {
    id: 'branch-staging', orgId: actor.orgId, legalEntityId: 'entity-staging', code: 'JHB',
    name: 'Johannesburg', status: 'active', reportingOnly: true, expectedVersion: 0,
  })
  await service.createBook(actor, {
    id: 'book-staging', orgId: actor.orgId, legalEntityId: 'entity-staging', code: 'MAIN', name: 'Primary',
    bookType: 'primary', functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA',
    status: 'active', expectedVersion: 0,
  })
  await service.createPeriod(actor, {
    id: 'period-staging', orgId: actor.orgId, legalEntityId: 'entity-staging', bookId: 'book-staging',
    fiscalYear: 2027, periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0,
  })
  for (const account of [
    { id: 'cash', code: '1000', name: 'Cash', accountType: 'asset' as const, normalBalance: 'debit' as const },
    { id: 'capital', code: '3000', name: 'Capital', accountType: 'equity' as const, normalBalance: 'credit' as const },
  ]) {
    await service.createAccount(actor, {
      ...account, orgId: actor.orgId, legalEntityId: 'entity-staging', bookId: 'book-staging',
      postingAllowed: true, activeFrom: '2026-07-01', expectedVersion: 0,
    })
  }
  const journal = await service.postJournal(actor, {
    id: 'journal-staging', orgId: actor.orgId, legalEntityId: 'entity-staging', bookId: 'book-staging',
    periodId: 'period-staging', sourceType: 'staging_verification', sourceId: 'foundation', sourceVersion: 1,
    postingPurpose: 'opening_balance', entryType: 'opening', postingDate: '2026-07-30', documentDate: '2026-07-30',
    description: 'Staging-safe finance foundation verification', currency: 'ZAR', expectedVersion: 0,
    lines: [{ accountId: 'cash', debitMinor: 100_00, creditMinor: 0 }, { accountId: 'capital', debitMinor: 0, creditMinor: 100_00 }],
  })
  const reversal = await service.reverseJournal(actor, {
    originalJournalId: journal.id, reversalJournalId: 'journal-staging-reversal', periodId: 'period-staging',
    postingDate: '2026-07-30', reason: 'Verify append-only reversal', expectedVersion: 0,
  })
  const result = {
    ok: true,
    mode: 'staging-safe-in-memory-no-egress',
    records: {
      legalEntities: store.legalEntities.size, branches: store.branches.size, books: store.books.size,
      periods: store.periods.size, accounts: store.accounts.size, journals: store.journals.size,
      auditEvents: store.auditEvents.length, outboxEvents: store.outboxEvents.length,
    },
    balanced: journal.totalDebitMinor === journal.totalCreditMinor,
    originalPreserved: store.journals.get(journal.id)?.status === 'posted',
    reversalLinksOriginal: reversal.reversesJournalEntryId === journal.id,
    externalEgressAllowed: store.outboxEvents.some((event) => event.externalEgressAllowed !== false),
  }
  if (!result.balanced || !result.originalPreserved || !result.reversalLinksOriginal || result.externalEgressAllowed) {
    throw new Error(JSON.stringify(result))
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
