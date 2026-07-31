import {
  FinanceFoundationService,
  financeApprovalSubjectDigest,
  InMemoryFinanceFoundationStore,
} from '@/lib/accounting/foundation-service'
import type { FinanceActorContext } from '@/lib/finance/types'

const now = '2026-07-30T10:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const actor: FinanceActorContext = {
  uid: 'finance-admin', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'admin-assignment', orgId: 'org-a', userId: 'finance-admin', legalEntityId: 'entity-a',
    scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor, uid: 'approver', membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'approver-assignment', userId: 'approver', role: 'finance_approver' }],
}

function command(id = 'journal-a') {
  return { id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a', sourceType: 'opening_balance',
    sourceId: 'opening-a', sourceVersion: 1, postingPurpose: 'opening_balance', entryType: 'opening', postingDate: '2026-07-15',
    documentDate: '2026-07-15', description: 'Opening', currency: 'ZAR', policyVersionId: 'policy-a-v1', expectedVersion: 0 as const,
    requestId: 'request-a', idempotencyKey: 'idem-a', approvalId: 'approval-a',
    lines: [{ accountId: 'cash', debitMinor: 1000, creditMinor: 0 }, { accountId: 'capital', debitMinor: 0, creditMinor: 1000 }] }
}

async function seededService() {
  const store = new InMemoryFinanceFoundationStore(); const service = new FinanceFoundationService(store, () => now)
  await service.createLegalEntity(actor, { id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz',
    jurisdictionCode: 'ZA', functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
    timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity') })
  await service.createBook(actor, { id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: 'MAIN', name: 'Primary',
    bookType: 'primary', functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA',
    taxPointPolicyId: 'za-invoice', defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('book') })
  const policyCommand = { id: 'policy-a-v1', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    versionNumber: 1, accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
    roundingMode: 'half_up' as const, effectiveFrom: '2026-07-01', expectedVersion: 0 as const, ...request('policy') }
  await service.createFinanceApproval(approver, { id: 'policy-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand),
    reason: 'Policy reviewed', expectedVersion: 0, ...request('approve-policy') })
  await service.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'policy-approval' })
  await service.createPeriod(actor, { id: 'period-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
    periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0, ...request('period') })
  for (const account of [
    { id: 'cash', code: '1000', accountType: 'asset' as const, normalBalance: 'debit' as const },
    { id: 'capital', code: '3000', accountType: 'equity' as const, normalBalance: 'credit' as const },
  ]) await service.createAccount(actor, { ...account, name: account.id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    currency: 'ZAR', currencyPolicy: 'functional_only', reportMapping: account.accountType, postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0, ...request(`account-${account.id}`) })
  await service.createFinanceApproval(approver, { id: 'approval-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    action: 'journal.post', subjectDigest: financeApprovalSubjectDigest('journal.post', command()), reason: 'Reviewed',
    expectedVersion: 0, ...request('approve-journal') })
  return { store, service }
}

describe('finance foundation service integration', () => {
  test('posts immutable journal with atomic audit and outbox evidence', async () => {
    const { store, service } = await seededService(); const posted = await service.postJournal(actor, command())
    expect(posted.totalDebitMinor).toBe(1000); expect(store.auditEvents.at(-1)?.aggregateDigest).toBe(posted.contentHash)
    expect(store.outboxEvents.at(-1)?.externalEgressAllowed).toBe(false)
    expect(() => store.unsafeUpdatePostedJournal(posted.id, { description: 'tampered' })).toThrow('immutable')
  })
  test('rejects duplicate source without partial writes', async () => {
    const { store, service } = await seededService(); await service.postJournal(actor, command())
    const before = [store.journals.size, store.auditEvents.length, store.outboxEvents.length]
    const duplicate = { ...command('journal-b'), idempotencyKey: 'idem-b', requestId: 'request-b', approvalId: 'approval-b' }
    await service.createFinanceApproval(approver, { id: 'approval-b', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      action: 'journal.post', subjectDigest: financeApprovalSubjectDigest('journal.post', duplicate), reason: 'Reviewed duplicate',
      expectedVersion: 0, ...request('approve-duplicate') })
    await expect(service.postJournal(actor, duplicate)).rejects.toThrow('source already exists')
    expect([store.journals.size, store.auditEvents.length, store.outboxEvents.length]).toEqual([before[0], before[1] + 1, before[2] + 1])
  })
  test('appends an approved equal-opposite reversal and preserves original', async () => {
    const { store, service } = await seededService(); const original = await service.postJournal(actor, command())
    const reverseCommand = { originalJournalId: original.id, reversalJournalId: 'journal-r', orgId: 'org-a',
      legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      postingDate: '2026-07-20', reason: 'Correction', requestId: 'request-r', idempotencyKey: 'idem-r', expectedVersion: 0 as const }
    await service.createFinanceApproval(approver, { id: 'approval-r', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      action: 'journal.reverse', subjectDigest: financeApprovalSubjectDigest('journal.reverse', reverseCommand),
      reason: 'Correction approved', expectedVersion: 0, ...request('approve-reversal') })
    const reversal = await service.reverseJournal(actor, { ...reverseCommand, approvalId: 'approval-r' })
    expect(reversal.lines.map((line) => [line.debitMinor, line.creditMinor])).toEqual([[0, 1000], [1000, 0]])
    expect(store.journals.get(original.id)).toEqual(original)
  })
})
