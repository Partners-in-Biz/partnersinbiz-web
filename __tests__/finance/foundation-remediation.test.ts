import {
  FinanceFoundationService,
  financeApprovalSubjectDigest,
  InMemoryFinanceFoundationStore,
} from '@/lib/accounting/foundation-service'
import { canonicalDigest, financeScopeKey } from '@/lib/finance/integrity'
import { authorizeFinanceAction } from '@/lib/finance/policy'
import type { FinanceActorContext } from '@/lib/finance/types'

const NOW = '2026-07-30T10:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })

const actor: FinanceActorContext = {
  uid: 'poster', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'assignment-a', orgId: 'org-a', userId: 'poster', legalEntityId: 'entity-a',
    scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor, uid: 'approver', membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'approver-assignment', userId: 'approver', role: 'finance_approver' }],
}

function postCommand(id = 'journal-a') {
  return {
    id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
    sourceType: 'opening_balance', sourceId: 'opening-a', sourceVersion: 1, postingPurpose: 'opening_balance',
    entryType: 'opening', postingDate: '2026-07-15', documentDate: '2026-07-15', description: 'Opening',
    currency: 'ZAR', policyVersionId: 'policy-a-v1', expectedVersion: 0 as const,
    requestId: 'request-1', idempotencyKey: 'idem-1', approvalId: 'approval-1',
    lines: [
      { accountId: 'cash', debitMinor: 1000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 1000 },
    ],
  }
}

async function seeded() {
  const store = new InMemoryFinanceFoundationStore()
  const service = new FinanceFoundationService(store, () => NOW)
  await service.createLegalEntity(actor, {
    id: 'entity-a', orgId: 'org-a', code: ' pib ', legalName: 'Partners in Biz', jurisdictionCode: 'ZA',
    functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
    timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity'),
  })
  await service.createBook(actor, {
    id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: ' main ', name: 'Primary',
    bookType: 'primary', functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA',
    taxPointPolicyId: 'za-invoice', defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('book'),
  })
  const policyCommand = {
    id: 'policy-a-v1', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 1,
    accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
    roundingMode: 'half_up' as const, effectiveFrom: '2026-07-01', expectedVersion: 0 as const, ...request('policy'),
  }
  await service.createFinanceApproval(approver, {
    id: 'policy-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand),
    reason: 'Reviewed policy', expectedVersion: 0, ...request('approve-policy'),
  })
  await service.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'policy-approval' })
  await service.createPeriod(actor, {
    id: 'period-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
    periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0,
    ...request('period'),
  })
  for (const account of [
    { id: 'cash', code: '1000', name: 'Cash', accountType: 'asset' as const, normalBalance: 'debit' as const },
    { id: 'capital', code: '3000', name: 'Capital', accountType: 'equity' as const, normalBalance: 'credit' as const },
  ]) await service.createAccount(actor, {
    ...account, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'ZAR',
    currencyPolicy: 'functional_only', reportMapping: account.accountType, postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0, ...request(`account-${account.id}`),
  })
  await service.createFinanceApproval(approver, {
    id: 'approval-1', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post',
    subjectDigest: financeApprovalSubjectDigest('journal.post', postCommand()),
    reason: 'Reviewed opening balance evidence', expectedVersion: 0, ...request('approve-journal'),
  })
  return { store, service }
}

describe('finance remediation contracts', () => {
  test('canonical scope keys and digests are versioned, typed and collision resistant', () => {
    expect(financeScopeKey({ orgId: 'a:b', legalEntityId: 'c', bookId: 'd' }))
      .not.toBe(financeScopeKey({ orgId: 'a', legalEntityId: 'b:c', bookId: 'd' }))
    expect(financeScopeKey({ orgId: 'a', legalEntityId: 'b' })).not.toBe(
      financeScopeKey({ orgId: 'a', legalEntityId: 'b', bookId: 'entity' }),
    )
    expect(canonicalDigest({ b: 1, a: 2 })).toBe(canonicalDigest({ a: 2, b: 1 }))
  })

  test.each([
    ['inactive membership', { membershipActive: false }],
    ['wrong org', { orgId: 'org-b' }],
    ['module disabled', { financeModuleEnabled: false }],
    ['viewer membership configuring foundation', { membershipRole: 'viewer' }],
    ['member membership configuring foundation', { membershipRole: 'member' }],
  ])('denies %s', (_name, update) => {
    expect(() => authorizeFinanceAction({ ...actor, ...update } as FinanceActorContext, {
      orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    }, 'foundation.configure', NOW)).toThrow()
  })

  test.each([
    ['wrong entity', { legalEntityId: 'entity-b' }],
    ['wrong book', { scopeMode: 'book' as const, bookId: 'book-b' }],
    ['future assignment', { effectiveFrom: '2026-08-01T00:00:00.000Z' }],
    ['expired assignment', { effectiveTo: '2026-07-01T00:00:00.000Z' }],
    ['revoked assignment', { status: 'revoked' as const }],
    ['assignment user mismatch', { userId: 'other-user' }],
    ['assignment org mismatch', { orgId: 'org-b' }],
  ])('denies %s', (_name, assignmentUpdate) => {
    expect(() => authorizeFinanceAction({ ...actor,
      assignments: [{ ...actor.assignments[0], ...assignmentUpdate }],
    }, { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }, 'journal.post', NOW)).toThrow()
  })

  test('normalizes claims internally and rejects overlapping periods', async () => {
    const { service } = await seeded()
    await expect(service.createPeriod(actor, {
      id: 'period-overlap', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      fiscalYear: 2027, periodNumber: 6, startsAt: '2026-07-31', endsAt: '2026-08-31',
      status: 'open', expectedVersion: 0, ...request('overlap'),
    })).rejects.toThrow('overlaps')
    await expect(service.createLegalEntity({ ...actor,
      assignments: [...actor.assignments, { ...actor.assignments[0], id: 'assignment-b', legalEntityId: 'entity-b' }],
    }, {
      id: 'entity-b', orgId: 'org-a', code: 'PIB', legalName: 'Duplicate', jurisdictionCode: 'ZA',
      functionalCurrency: 'ZAR', defaultAccountingBasis: 'cash', fiscalYearStartMonth: 3,
      timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity-b'),
    })).rejects.toThrow('code already exists')
  })

  test('requires a persisted independent approval rather than caller-controlled evidence', async () => {
    const { service } = await seeded()
    await expect(service.postJournal(actor, { ...postCommand(), approvalId: undefined })).rejects.toThrow('approvalId')
    await expect(service.postJournal(actor, { ...postCommand(), approvalId: 'invented-approval' }))
      .rejects.toThrow('Persisted approval')
  })

  test('binds idempotency to payload and returns the original matching result', async () => {
    const { store, service } = await seeded()
    const first = await service.postJournal(actor, postCommand())
    expect(await service.postJournal(actor, postCommand())).toEqual(first)
    expect(store.journals.size).toBe(1)
    await expect(service.postJournal(actor, { ...postCommand('journal-b'), description: 'different payload' }))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  test('pins an approved immutable policy and complete journal/audit metadata', async () => {
    const { store, service } = await seeded()
    const posted = await service.postJournal(actor, postCommand())
    expect(posted).toEqual(expect.objectContaining({
      policyVersionId: 'policy-a-v1', accountingBasis: 'accrual', approvalId: 'approval-1',
      approvalActorId: 'approver', requestId: 'request-1', idempotencyKey: 'idem-1',
      lineDigest: expect.stringMatching(/^[a-f0-9]{64}$/), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      canonicalPayloadVersion: 1, hashAlgorithmVersion: 'sha256-v1',
    }))
    expect(store.auditEvents.at(-1)).toEqual(expect.objectContaining({
      requestId: 'request-1', idempotencyKey: 'idem-1', reason: 'Reviewed opening balance evidence',
      approvalReference: 'approval-1', aggregateDigest: posted.contentHash,
      canonicalPayloadVersion: 1, hashAlgorithmVersion: 'sha256-v1',
    }))
    expect(store.outboxEvents.at(-1)?.payload).toEqual(expect.objectContaining({ aggregateDigest: posted.contentHash }))
    expect(() => store.unsafeUpdateBookPolicyVersion('policy-a-v1', { accountingBasis: 'cash' })).toThrow('immutable')
  })

  test('derives reversal lines from the stored original and requires durable reversal approval', async () => {
    const { store, service } = await seeded()
    const original = await service.postJournal(actor, postCommand())
    const reverseCommand = {
      originalJournalId: original.id, reversalJournalId: 'reversal-a', orgId: 'org-a',
      legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      postingDate: '2026-07-20', reason: 'Correction', requestId: 'request-r',
      idempotencyKey: 'idem-r', expectedVersion: 0 as const,
    }
    await expect(service.reverseJournal(actor, reverseCommand)).rejects.toThrow('approvalId')
    await service.createFinanceApproval(approver, {
      id: 'approval-r', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.reverse',
      subjectDigest: financeApprovalSubjectDigest('journal.reverse', reverseCommand), reason: 'Correction approved',
      expectedVersion: 0, ...request('approve-reversal'),
    })
    const reversal = await service.reverseJournal(actor, { ...reverseCommand, approvalId: 'approval-r' })
    expect(reversal.lines.map(({ accountId, debitMinor, creditMinor }) => ({ accountId, debitMinor, creditMinor })))
      .toEqual([
        { accountId: 'cash', debitMinor: 0, creditMinor: 1000 },
        { accountId: 'capital', debitMinor: 1000, creditMinor: 0 },
      ])
    expect(store.journals.get(original.id)).toEqual(original)
  })
})
