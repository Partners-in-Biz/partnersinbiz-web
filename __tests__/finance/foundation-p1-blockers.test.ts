import {
  FinanceFoundationService,
  financeApprovalSubjectDigest,
  InMemoryFinanceFoundationStore,
} from '@/lib/accounting/foundation-service'
import { canonicalDigest, verifyFinanceAuditChain } from '@/lib/finance/integrity'
import type { FinanceActorContext } from '@/lib/finance/types'

const NOW = '2026-07-30T10:00:00.000Z'
const actor: FinanceActorContext = {
  uid: 'poster', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'poster-assignment', orgId: 'org-a', userId: 'poster', legalEntityId: 'entity-a',
    scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor,
  uid: 'approver',
  membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'approver-assignment', userId: 'approver', role: 'finance_approver' }],
}

function request(key: string) {
  return { requestId: `request-${key}`, idempotencyKey: `idem-${key}` }
}

async function seeded(options: { policyFrom?: string; policyTo?: string } = {}) {
  const store = new InMemoryFinanceFoundationStore()
  const service = new FinanceFoundationService(store, () => NOW)
  await service.createLegalEntity(actor, {
    id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz', jurisdictionCode: 'ZA',
    functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
    timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity'),
  })
  await service.createBook(actor, {
    id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: 'MAIN', name: 'Primary', bookType: 'primary',
    functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA', taxPointPolicyId: 'za-invoice',
    defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('book'),
  })
  const policyCommand = {
    id: 'policy-a-v1', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 1,
    accountingBasis: 'accrual', taxPointPolicyId: 'za-invoice', currencyPrecision: 2, roundingMode: 'half_up',
    effectiveFrom: options.policyFrom ?? '2026-07-01', effectiveTo: options.policyTo,
    expectedVersion: 0, ...request('policy'),
  } as const
  await service.createFinanceApproval(approver, {
    id: 'policy-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
    action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand),
    reason: 'Independent policy approval', expectedVersion: 0, ...request('approve-policy'),
  })
  await service.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'policy-approval' })
  await service.createPeriod(actor, {
    id: 'period-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
    periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0,
    ...request('period'),
  })
  for (const account of [
    { id: 'cash', code: '1000', accountType: 'asset' as const, normalBalance: 'debit' as const },
    { id: 'capital', code: '3000', accountType: 'equity' as const, normalBalance: 'credit' as const },
  ]) await service.createAccount(actor, {
    ...account, name: account.id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'ZAR',
    currencyPolicy: 'functional_only', reportMapping: account.accountType, postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0, ...request(`account-${account.id}`),
  })
  const journalCommand = postCommand()
  await service.createFinanceApproval(approver, {
    id: 'journal-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post',
    subjectDigest: financeApprovalSubjectDigest('journal.post', journalCommand), reason: 'Independent journal approval',
    expectedVersion: 0, ...request('approve-journal'),
  })
  return { store, service }
}

function postCommand() {
  return {
    id: 'journal-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
    sourceType: 'manual_journal', sourceId: 'manual-a', sourceVersion: 1, postingPurpose: 'manual', entryType: 'manual',
    postingDate: '2026-07-15', documentDate: '2026-07-15', description: 'Manual journal', currency: 'ZAR',
    policyVersionId: 'policy-a-v1', expectedVersion: 0 as const, ...request('journal'), approvalId: 'journal-approval',
    lines: [{ accountId: 'cash', debitMinor: 1000, creditMinor: 0 }, { accountId: 'capital', debitMinor: 0, creditMinor: 1000 }],
  }
}

describe('finance P1 blocker regressions', () => {
  test.each([
    ['top-level undefined', undefined],
    ['nested undefined', { value: undefined }],
    ['array undefined', [undefined]],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional number', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['Date', new Date(NOW)],
    ['Map', new Map([['a', 1]])],
  ])('canonical hashing fails closed for %s', (_name, value) => {
    expect(() => canonicalDigest(value)).toThrow()
  })

  test('create command idempotency returns matching result and rejects key reuse with a different payload', async () => {
    const store = new InMemoryFinanceFoundationStore()
    const service = new FinanceFoundationService(store, () => NOW)
    const command = {
      id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz', jurisdictionCode: 'ZA',
      functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual' as const, fiscalYearStartMonth: 3,
      timezone: 'Africa/Johannesburg', status: 'active' as const, expectedVersion: 0 as const, ...request('entity'),
    }
    const first = await service.createLegalEntity(actor, command)
    await expect(service.createLegalEntity(actor, command)).resolves.toEqual(first)
    await expect(service.createLegalEntity(actor, { ...command, legalName: 'Different' }))
      .rejects.toThrow('Idempotency key payload mismatch')
  })

  test.each([
    ['non-canonical date', '2026-7-15', '2026-07-31'],
    ['impossible date', '2026-02-30', '2026-03-31'],
  ])('rejects %s before period overlap comparison', async (_name, startsAt, endsAt) => {
    const store = new InMemoryFinanceFoundationStore()
    const service = new FinanceFoundationService(store, () => NOW)
    await service.createLegalEntity(actor, {
      id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz', jurisdictionCode: 'ZA',
      functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
      timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request(`entity-${startsAt}`),
    })
    await service.createBook(actor, {
      id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: 'MAIN', name: 'Primary', bookType: 'primary',
      functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA', taxPointPolicyId: 'za-invoice',
      defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request(`book-${startsAt}`),
    })
    await expect(service.createPeriod(actor, {
      id: 'bad-period', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
      periodNumber: 1, startsAt, endsAt, status: 'open', expectedVersion: 0, ...request(`period-${startsAt}`),
    })).rejects.toThrow('canonical YYYY-MM-DD')
  })

  test('rejects posting outside the approved immutable policy effective range', async () => {
    const { service } = await seeded({ policyFrom: '2026-07-16', policyTo: '2026-07-31' })
    await expect(service.postJournal(actor, postCommand())).rejects.toThrow('policy effective')
  })

  test('rejects fabricated approval identity and leaves no partial journal evidence', async () => {
    const { store, service } = await seeded()
    const before = [store.journals.size, store.auditEvents.length, store.outboxEvents.length]
    await expect(service.postJournal(actor, { ...postCommand(), approvalId: 'does-not-exist' }))
      .rejects.toThrow('Persisted approval')
    expect([store.journals.size, store.auditEvents.length, store.outboxEvents.length]).toEqual(before)
  })

  test('direct posting cannot self-authorize a reversal source type', async () => {
    const { service } = await seeded()
    await expect(service.postJournal(actor, { ...postCommand(), sourceType: 'journal_reversal' }))
      .rejects.toThrow('reverseJournal')
  })

  test('rejects non-finite and unsafe runtime command numbers before persistence', async () => {
    const { service } = await seeded()
    await expect(service.postJournal(actor, { ...postCommand(), sourceVersion: Number.NaN }))
      .rejects.toThrow('sourceVersion')
  })

  test('exports an executable audit-chain verifier', () => {
    const integrity = jest.requireActual('@/lib/finance/integrity') as Record<string, unknown>
    expect(typeof integrity.verifyFinanceAuditChain).toBe('function')
  })

  test.each([
    ['protected line identity', { id: 'attacker-line', journalEntryId: 'other-journal', sequence: 99 }],
    ['protected line scope', { orgId: 'org-b', legalEntityId: 'entity-b', bookId: 'book-b', periodId: 'period-b' }],
    ['unknown line field', { attackerMetadata: true }],
  ])('rejects %s instead of persisting caller metadata', async (_name, injected) => {
    const { service } = await seeded()
    const malicious = { ...postCommand(), id: `journal-${_name.replaceAll(' ', '-')}`,
      requestId: `request-${_name}`, idempotencyKey: `idem-${_name}`, approvalId: `approval-${_name}`,
      lines: postCommand().lines.map((line, index) => index === 0 ? { ...line, ...injected } : line) }
    await service.createFinanceApproval(approver, {
      id: malicious.approvalId, orgId: malicious.orgId, legalEntityId: malicious.legalEntityId, bookId: malicious.bookId,
      action: 'journal.post', subjectDigest: financeApprovalSubjectDigest('journal.post', malicious),
      reason: 'Adversarial command review fixture', expectedVersion: 0, ...request(`approve-${_name}`),
    })
    await expect(service.postJournal(actor, malicious as never)).rejects.toThrow(/unknown|protected/i)
  })

  test('rejects protected top-level journal metadata instead of silently ignoring it', async () => {
    const { service } = await seeded()
    const malicious = { ...postCommand(), id: 'journal-protected', requestId: 'request-protected',
      idempotencyKey: 'idem-protected', approvalId: 'approval-protected', createdBy: 'attacker', contentHash: 'forged' }
    await service.createFinanceApproval(approver, {
      id: malicious.approvalId, orgId: malicious.orgId, legalEntityId: malicious.legalEntityId, bookId: malicious.bookId,
      action: 'journal.post', subjectDigest: financeApprovalSubjectDigest('journal.post', malicious),
      reason: 'Adversarial command review fixture', expectedVersion: 0, ...request('approve-protected'),
    })
    await expect(service.postJournal(actor, malicious as never)).rejects.toThrow(/unknown|protected/i)
  })

  test('compares approval expiry by epoch across timezone offsets', async () => {
    const { service } = await seeded()
    const base = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post' as const,
      subjectDigest: canonicalDigest({ subject: 'offset-expiry' }), reason: 'Offset expiry test', expectedVersion: 0 as const }
    await expect(service.createFinanceApproval(approver, {
      ...base, id: 'expired-offset', expiresAt: '2026-07-30T11:30:00+02:00', ...request('expired-offset'),
    })).rejects.toThrow('future ISO timestamp')
    await expect(service.createFinanceApproval(approver, {
      ...base, id: 'future-offset', expiresAt: '2026-07-30T05:30:00-05:00', ...request('future-offset'),
    })).resolves.toEqual(expect.objectContaining({ id: 'future-offset' }))
  })

  test('does not use a future approver assignment as approval provenance', async () => {
    const { service } = await seeded()
    const mixedApprover: FinanceActorContext = {
      ...approver,
      assignments: [
        { ...approver.assignments[0], id: 'future-approver', effectiveFrom: '2026-07-31T00:00:00Z' },
        { ...approver.assignments[0], id: 'current-accountant', role: 'accountant' },
      ],
    }
    await expect(service.createFinanceApproval(mixedApprover, {
      id: 'bad-provenance', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post',
      subjectDigest: canonicalDigest({ subject: 'bad-provenance' }), reason: 'Must not use future provenance',
      expectedVersion: 0, ...request('bad-provenance'),
    })).rejects.toThrow('effective finance approver assignment')
  })

  test('rejects overlapping approved policy versions and ambiguous effective policy selection', async () => {
    const { store, service } = await seeded()
    const overlapping = {
      id: 'policy-a-v2', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 2,
      accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
      roundingMode: 'half_up' as const, effectiveFrom: '2026-07-15', expectedVersion: 0 as const, ...request('policy-v2'),
    }
    await service.createFinanceApproval(approver, {
      id: 'policy-v2-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', overlapping),
      reason: 'Policy v2 review', expectedVersion: 0, ...request('approve-policy-v2'),
    })
    await expect(service.createBookPolicyVersion(actor, { ...overlapping, approvalId: 'policy-v2-approval' }))
      .rejects.toThrow('overlaps')

    const existing = store.policies.get('policy-a-v1')!
    store.policies.set('corrupt-overlap', { ...existing, id: 'corrupt-overlap', versionNumber: 99 })
    await expect(service.postJournal(actor, postCommand())).rejects.toThrow(/unique|ambiguous/i)
  })

  test('validates the original full content hash before deriving reversal lines', async () => {
    const { store, service } = await seeded()
    const original = await service.postJournal(actor, postCommand())
    store.journals.set(original.id, { ...original, description: 'tampered without matching content hash' })
    const reverse = { originalJournalId: original.id, reversalJournalId: 'journal-r', orgId: 'org-a',
      legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a', postingDate: '2026-07-20',
      reason: 'Correction', requestId: 'request-r', idempotencyKey: 'idem-r', expectedVersion: 0 as const }
    await service.createFinanceApproval(approver, {
      id: 'approval-r', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.reverse',
      subjectDigest: financeApprovalSubjectDigest('journal.reverse', reverse), reason: 'Reversal review',
      expectedVersion: 0, ...request('approve-r'),
    })
    await expect(service.reverseJournal(actor, { ...reverse, approvalId: 'approval-r' }))
      .rejects.toThrow('content hash')
  })

  test('audit verification requires complete journal coverage and rejects orphan journals', async () => {
    const { store, service } = await seeded()
    const journal = await service.postJournal(actor, postCommand())
    const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }
    const events = store.auditEvents.filter((event) => event.orgId === scope.orgId &&
      event.legalEntityId === scope.legalEntityId && event.bookId === scope.bookId)
    const last = events.at(-1)!
    const head = { ...scope, eventId: last.id, eventHash: last.eventHash, sequence: last.sequence,
      canonicalPayloadVersion: last.canonicalPayloadVersion, hashAlgorithmVersion: last.hashAlgorithmVersion }
    expect(() => (verifyFinanceAuditChain as (input: unknown) => void)({ scope, events, head }))
      .toThrow(/journals|coverage/i)
    const { contentHash: _ignored, ...orphanBase } = { ...journal, id: 'orphan-journal' }
    const orphan = { ...orphanBase, contentHash: canonicalDigest(orphanBase) }
    expect(() => verifyFinanceAuditChain({ scope, events, head, journals: [journal, orphan] }))
      .toThrow(/orphan|corresponding audit/i)
  })

  test('book default control accounts are authoritative and configuration roles must agree', async () => {
    const { store, service } = await seeded()
    const book = store.books.get('book-a')!
    store.books.set(book.id, { ...book, defaultControlAccountIds: { cash: 'cash' } })
    await expect(service.postJournal(actor, postCommand())).rejects.toThrow('authoritative source')
    store.books.set(book.id, { ...book, defaultControlAccountIds: { cash: 'bad-cash-control' } })
    await expect(service.createAccount(actor, {
      id: 'bad-cash-control', code: '1010', name: 'Bad cash control', accountType: 'asset', normalBalance: 'debit',
      orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'ZAR', currencyPolicy: 'functional_only',
      reportMapping: 'asset', postingAllowed: true, activeFrom: '2026-07-01', expectedVersion: 0,
      ...request('bad-cash-control'),
    })).rejects.toThrow(/control account.*role|configuration/i)
  })

  test('period close and reopen claims replay exact retries and reject payload mismatch with audit metadata', async () => {
    const { store, service } = await seeded()
    const close = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      status: 'soft_closed' as const, expectedVersion: 1, reason: 'Month end', approvalId: 'close-approval',
      requestId: 'close-request', idempotencyKey: 'close-idem' }
    await service.createFinanceApproval(approver, {
      id: 'close-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'period.close',
      subjectDigest: financeApprovalSubjectDigest('period.close', close), reason: 'Close review', expectedVersion: 0,
      ...request('approve-close'),
    })
    const closed = await service.changePeriodStatus(actor, close)
    await expect(service.changePeriodStatus(actor, close)).resolves.toEqual(closed)
    await expect(service.changePeriodStatus(actor, { ...close, reason: 'Changed payload' }))
      .rejects.toThrow('payload mismatch')

    const reopen = { ...close, status: 'open' as const, expectedVersion: 2, reason: 'Approved correction',
      approvalId: 'reopen-approval', requestId: 'reopen-request', idempotencyKey: 'reopen-idem' }
    await service.createFinanceApproval(approver, {
      id: 'reopen-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'period.reopen',
      subjectDigest: financeApprovalSubjectDigest('period.reopen', reopen), reason: 'Reopen review', expectedVersion: 0,
      ...request('approve-reopen'),
    })
    const reopened = await service.changePeriodStatus(actor, reopen)
    await expect(service.changePeriodStatus(actor, reopen)).resolves.toEqual(reopened)
    await expect(service.changePeriodStatus(actor, close)).resolves.toEqual(closed)
    expect(store.auditEvents.at(-1)).toEqual(expect.objectContaining({
      requestId: reopen.requestId, idempotencyKey: reopen.idempotencyKey,
    }))
  })

  test('rejects protected or unknown period states at the runtime boundary', async () => {
    const { service } = await seeded()
    await expect(service.createPeriod(actor, {
      id: 'period-protected', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
      periodNumber: 6, startsAt: '2026-08-01', endsAt: '2026-08-31', status: 'hard_closed', expectedVersion: 0,
      ...request('period-protected'),
    })).rejects.toThrow(/status|open/i)
  })

  test('rejects malformed account enums and truthy non-boolean posting flags', async () => {
    const { service } = await seeded()
    await expect(service.createAccount(actor, {
      id: 'malformed-account', code: '1099', name: 'Malformed', accountType: 'asset', normalBalance: 'debit',
      orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'USD',
      currencyPolicy: 'bogus', reportMapping: 'asset', postingAllowed: 'false', activeFrom: '2026-07-01',
      expectedVersion: 0, ...request('malformed-account'),
    } as never)).rejects.toThrow(/currencyPolicy|postingAllowed/i)
  })

  test('accepts a future approved basis policy and uses it for a cross-period reversal', async () => {
    const { service } = await seeded({ policyTo: '2026-07-31' })
    const original = await service.postJournal(actor, postCommand())
    await service.createPeriod(actor, {
      id: 'period-aug', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
      periodNumber: 6, startsAt: '2026-08-01', endsAt: '2026-08-31', status: 'open', expectedVersion: 0,
      ...request('period-aug'),
    })
    const policy = {
      id: 'policy-a-v2', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 2,
      accountingBasis: 'cash' as const, taxPointPolicyId: 'za-payment', currencyPrecision: 2,
      roundingMode: 'half_up' as const, effectiveFrom: '2026-08-01', expectedVersion: 0 as const, ...request('policy-v2'),
    }
    await service.createFinanceApproval(approver, {
      id: 'policy-v2-approval', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      action: 'book-policy.approve', subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policy),
      reason: 'Future basis approved', expectedVersion: 0, ...request('approve-policy-v2'),
    })
    await expect(service.createBookPolicyVersion(actor, { ...policy, approvalId: 'policy-v2-approval' })).resolves.toBeDefined()
    const reverse = { originalJournalId: original.id, reversalJournalId: 'journal-aug-r', orgId: 'org-a',
      legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-aug', postingDate: '2026-08-15',
      reason: 'August correction', requestId: 'request-aug-r', idempotencyKey: 'idem-aug-r', expectedVersion: 0 as const }
    await service.createFinanceApproval(approver, {
      id: 'approval-aug-r', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.reverse',
      subjectDigest: financeApprovalSubjectDigest('journal.reverse', reverse), reason: 'Cross-period reversal approved',
      expectedVersion: 0, ...request('approve-aug-r'),
    })
    await expect(service.reverseJournal(actor, { ...reverse, approvalId: 'approval-aug-r' }))
      .resolves.toEqual(expect.objectContaining({ policyVersionId: 'policy-a-v2', accountingBasis: 'cash' }))
  })

  test('requires a cutover date before an active book can accept postings', async () => {
    const { store, service } = await seeded()
    const book = store.books.get('book-a')!
    store.books.set(book.id, { ...book, cutoverAt: undefined })
    await expect(service.postJournal(actor, postCommand())).rejects.toThrow(/cutover/i)
  })

  test('rejects tampered immutable approval and policy snapshots', async () => {
    const approvalState = await seeded()
    const approval = approvalState.store.approvals.get('journal-approval')!
    approvalState.store.approvals.set(approval.id, { ...approval, subjectDigest: canonicalDigest({ forged: true }) })
    await expect(approvalState.service.postJournal(actor, {
      ...postCommand(),
      approvalId: 'journal-approval',
    })).rejects.toThrow(/content hash|integrity|invalid/i)

    const policyState = await seeded()
    const policy = policyState.store.policies.get('policy-a-v1')!
    policyState.store.policies.set(policy.id, { ...policy, accountingBasis: 'cash' })
    await expect(policyState.service.postJournal(actor, postCommand())).rejects.toThrow(/content hash|integrity|invalid/i)
  })
})
