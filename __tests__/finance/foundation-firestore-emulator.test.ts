/** @jest-environment node */
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import fs from 'fs'
import path from 'path'
import { FirestoreFinanceFoundationRepository } from '@/lib/accounting/firestore-foundation-repository'
import { financeApprovalSubjectDigest } from '@/lib/accounting/foundation-service'
import { verifyFinanceAuditChain } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalAction } from '@/lib/finance/types'
import type { PostedJournalEntry, JournalLine, FinanceAuditEvent } from '@/lib/accounting/types'

const projectId = 'finance-foundation-emulator'
jest.setTimeout(60_000)
const now = () => '2026-07-30T12:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const actor: FinanceActorContext = {
  uid: 'poster', orgId: 'org-a', membershipRole: 'owner', membershipActive: true, financeModuleEnabled: true,
  assignments: [{ id: 'poster-assignment', orgId: 'org-a', userId: 'poster', legalEntityId: 'entity-a',
    scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
}
const approver: FinanceActorContext = {
  ...actor, uid: 'approver', membershipRole: 'admin',
  assignments: [{ ...actor.assignments[0], id: 'approver-assignment', userId: 'approver', role: 'finance_approver' }],
}

function command(id: string, sourceId = id) {
  return {
    id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
    sourceType: 'manual_journal', sourceId, sourceVersion: 1, postingPurpose: 'manual', entryType: 'manual',
    postingDate: '2026-07-15', documentDate: '2026-07-15', description: id, currency: 'ZAR',
    policyVersionId: 'policy-a-v1', expectedVersion: 0 as const,
    requestId: `request-${id}`, idempotencyKey: `idem-${id}`, approvalId: `approval-${id}`,
    lines: [{ accountId: 'cash', debitMinor: 1000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 1000 }],
  }
}

describe('finance foundation Firestore emulator', () => {
  let environment: RulesTestEnvironment
  let db: ReturnType<typeof getFirestore>
  let repository: FirestoreFinanceFoundationRepository

  async function seedAuthorization(context: FinanceActorContext) {
    await db.collection('orgMembers').doc(`${context.orgId}_${context.uid}`).set({
      role: context.membershipRole, status: 'active', accessPolicy: { preset: 'custom', modules: { billing: true } },
    })
    await Promise.all(context.assignments.map((assignment) =>
      db.collection('finance_role_assignments').doc(assignment.id).set(assignment)))
  }

  async function approve(
    action: FinanceApprovalAction,
    subject: object,
    id: string,
    context = approver,
    scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' },
  ) {
    return repository.createFinanceApproval(context, {
      id, ...scope, action, subjectDigest: financeApprovalSubjectDigest(action, subject),
      reason: `${action} independently reviewed`, expectedVersion: 0, ...request(`approve-${id}`),
    })
  }

  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is required; run test:finance:emulator')
    environment = await initializeTestEnvironment({
      projectId,
      firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8') },
    })
    const app = initializeApp({ projectId }, `finance-${Date.now()}`)
    db = getFirestore(app)
    repository = new FirestoreFinanceFoundationRepository({ db, now })
  })

  afterAll(async () => {
    await environment?.cleanup()
    await Promise.all(getApps().filter((app) => app.name.startsWith('finance-')).map(deleteApp))
  })

  beforeEach(async () => {
    await environment.clearFirestore()
    await seedAuthorization(actor); await seedAuthorization(approver)
    await repository.createLegalEntity(actor, {
      id: 'entity-a', orgId: 'org-a', code: 'PIB', legalName: 'Partners in Biz', jurisdictionCode: 'ZA',
      functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
      timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity'),
    })
    await repository.createBook(actor, {
      id: 'book-a', orgId: 'org-a', legalEntityId: 'entity-a', code: 'MAIN', name: 'Primary', bookType: 'primary',
      functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA', taxPointPolicyId: 'za-invoice',
      defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('book'),
    })
    const policyCommand = {
      id: 'policy-a-v1', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 1,
      accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
      roundingMode: 'half_up' as const, effectiveFrom: '2026-07-01', effectiveTo: '2026-07-31',
      expectedVersion: 0 as const, ...request('policy'),
    }
    await approve('book-policy.approve', policyCommand, 'policy-approval')
    await repository.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'policy-approval' })
    await repository.createPeriod(actor, {
      id: 'period-a', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', fiscalYear: 2027,
      periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0,
      ...request('period'),
    })
    for (const account of [
      { id: 'cash', code: '1000', accountType: 'asset' as const, normalBalance: 'debit' as const },
      { id: 'capital', code: '3000', accountType: 'equity' as const, normalBalance: 'credit' as const },
    ]) await repository.createAccount(actor, {
      ...account, name: account.id, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'ZAR',
      currencyPolicy: 'functional_only', reportMapping: account.accountType, postingAllowed: true,
      activeFrom: '2026-07-01', expectedVersion: 0, ...request(`account-${account.id}`),
    })
  })

  test('atomically writes scoped journal lines, audit head and no-egress outbox', async () => {
    const input = command('journal-a'); await approve('journal.post', input, input.approvalId)
    const posted = await repository.postJournal(actor, input)
    const [journal, lines, audit, outbox, head] = await Promise.all([
      db.collection('journal_entries').where('id', '==', posted.id).get(),
      db.collection('journal_lines').where('journalEntryId', '==', posted.id).get(),
      db.collection('finance_audit_events').where('aggregateId', '==', posted.id).get(),
      db.collection('finance_outbox_events').where('aggregateId', '==', posted.id).get(),
      db.collection('finance_audit_heads').where('bookId', '==', 'book-a').get(),
    ])
    expect(journal.size).toBe(1); expect(lines.size).toBe(2); expect(audit.size).toBe(1)
    expect(outbox.docs[0].data().externalEgressAllowed).toBe(false); expect(head.size).toBe(1)
  })

  test('uses durable payload-bound approval and denies fabricated evidence with no partial journal writes', async () => {
    const input = { ...command('forged'), approvalId: 'does-not-exist' }
    const before = (await db.collection('finance_audit_events').get()).size
    await expect(repository.postJournal(actor, input)).rejects.toThrow('Persisted approval')
    expect((await db.collection('journal_entries').get()).empty).toBe(true)
    expect((await db.collection('finance_audit_events').get()).size).toBe(before)
  })

  test('revalidates membership, module and assignment inside the posting transaction', async () => {
    const input = command('revoked'); await approve('journal.post', input, input.approvalId)
    await db.collection('finance_role_assignments').doc('poster-assignment').update({ status: 'revoked' })
    await expect(repository.postJournal(actor, input)).rejects.toThrow('No active finance assignment')
    expect((await db.collection('journal_entries').get()).empty).toBe(true)
  })

  test('revalidates the persisted approver authority inside the posting transaction', async () => {
    const input = command('revoked-approver'); await approve('journal.post', input, input.approvalId)
    await db.collection('finance_role_assignments').doc('approver-assignment').update({ status: 'revoked' })
    await expect(repository.postJournal(actor, input)).rejects.toThrow('approver authority is no longer effective')
    expect((await db.collection('journal_entries').get()).empty).toBe(true)
  })

  test('rejects reserved sourceType and control-account authority bypasses', async () => {
    const sourceBypass = { ...command('source-bypass'), sourceType: 'journal_reversal' }
    await expect(repository.postJournal(actor, sourceBypass)).rejects.toThrow('reverseJournal')
    await repository.createAccount(actor, {
      id: 'control', code: '1100', name: 'Receivables control', accountType: 'asset', normalBalance: 'debit',
      controlAccountRole: 'receivables', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', currency: 'ZAR',
      currencyPolicy: 'functional_only', reportMapping: 'asset', postingAllowed: true,
      activeFrom: '2026-07-01', expectedVersion: 0, ...request('account-control'),
    })
    const controlBypass = { ...command('control-bypass'), approvalId: 'approval-control', lines: [
      { accountId: 'control', debitMinor: 1000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 1000 },
    ] }
    await approve('journal.post', controlBypass, controlBypass.approvalId)
    await expect(repository.postJournal(actor, controlBypass)).rejects.toThrow('authoritative source')
  })

  test.each([
    ['protected identity', { id: 'attacker-line', journalEntryId: 'other-journal', sequence: 77 }],
    ['protected scope', { orgId: 'org-b', legalEntityId: 'entity-b', bookId: 'book-b', periodId: 'period-b' }],
    ['unknown metadata', { attackerMetadata: true }],
  ])('rejects journal lines with %s before any Firestore write', async (_name, injected) => {
    const input = { ...command(`line-${_name.replaceAll(' ', '-')}`),
      lines: command('fixture').lines.map((line, index) => index === 0 ? { ...line, ...injected } : line) }
    await approve('journal.post', input, input.approvalId)
    await expect(repository.postJournal(actor, input as never)).rejects.toThrow(/unknown|protected/i)
    expect((await db.collection('journal_entries').get()).empty).toBe(true)
    expect((await db.collection('journal_lines').get()).empty).toBe(true)
  })

  test('treats book defaults as authoritative control accounts even when the account role is absent', async () => {
    const book = (await db.collection('accounting_books').where('id', '==', 'book-a').get()).docs[0]
    await book.ref.update({ defaultControlAccountIds: { cash: 'cash' } })
    const input = command('default-control'); await approve('journal.post', input, input.approvalId)
    await expect(repository.postJournal(actor, input)).rejects.toThrow('authoritative source')
    expect((await db.collection('journal_entries').get()).empty).toBe(true)
  })

  test('supports payload-bound idempotency and detects corrupted full-scope metadata', async () => {
    const input = command('journal-a'); await approve('journal.post', input, input.approvalId)
    const first = await repository.postJournal(actor, input)
    expect(await repository.postJournal(actor, input)).toEqual(first)
    await expect(repository.postJournal(actor, { ...input, description: 'changed' })).rejects.toThrow('payload mismatch')
    const claim = await db.collection('finance_idempotency_claims').where('idempotencyKey', '==', input.idempotencyKey).get()
    await claim.docs[0].ref.update({ scopeIdentity: 'corrupt-scope' })
    await expect(repository.postJournal(actor, input)).rejects.toThrow('Idempotency metadata')
  })

  test('serializes concurrent source/sequence claims and overlapping calendars', async () => {
    const left = command('journal-a', 'same-source'); const right = command('journal-b', 'same-source')
    await approve('journal.post', left, left.approvalId); await approve('journal.post', right, right.approvalId)
    const results = await Promise.allSettled([repository.postJournal(actor, left), repository.postJournal(actor, right)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await db.collection('journal_entries').get()).size).toBe(1)
    const periodResults = await Promise.allSettled([
      repository.createPeriod(actor, { id: 'period-b', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
        fiscalYear: 2027, periodNumber: 6, startsAt: '2026-08-01', endsAt: '2026-08-31', status: 'open',
        expectedVersion: 0, ...request('period-b') }),
      repository.createPeriod(actor, { id: 'period-c', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
        fiscalYear: 2027, periodNumber: 7, startsAt: '2026-08-15', endsAt: '2026-09-15', status: 'open',
        expectedVersion: 0, ...request('period-c') }),
    ])
    expect(periodResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  test('serializes concurrent overlapping approved policy calendars', async () => {
    const left = { id: 'policy-a-v2', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', versionNumber: 2,
      accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
      roundingMode: 'half_up' as const, effectiveFrom: '2026-08-01', effectiveTo: '2026-08-31',
      expectedVersion: 0 as const, ...request('policy-v2') }
    const right = { ...left, id: 'policy-a-v3', versionNumber: 3, effectiveFrom: '2026-08-15', effectiveTo: '2026-09-15',
      requestId: 'request-policy-v3', idempotencyKey: 'idem-policy-v3' }
    await approve('book-policy.approve', left, 'policy-v2-approval')
    await approve('book-policy.approve', right, 'policy-v3-approval')
    const results = await Promise.allSettled([
      repository.createBookPolicyVersion(actor, { ...left, approvalId: 'policy-v2-approval' }),
      repository.createBookPolicyVersion(actor, { ...right, approvalId: 'policy-v3-approval' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await db.collection('book_policy_versions').get()).size).toBe(2)
  })

  test('enforces runtime create version and timezone-aware approval expiry', async () => {
    await expect(repository.createBranch(actor, {
      id: 'branch-invalid-version', orgId: 'org-a', legalEntityId: 'entity-a', code: 'INVALID', name: 'Invalid',
      status: 'active', reportingOnly: true, expectedVersion: 1, ...request('branch-invalid-version'),
    } as never)).rejects.toThrow('expectedVersion must be 0')
    await expect(repository.createFinanceApproval(approver, {
      id: 'expired-offset', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post',
      subjectDigest: financeApprovalSubjectDigest('journal.post', command('offset-subject')),
      reason: 'Offset expiry', expiresAt: '2026-07-30T13:30:00+02:00', expectedVersion: 0,
      ...request('expired-offset'),
    })).rejects.toThrow('future ISO timestamp')
  })

  test('does not persist future approver assignment provenance when a current accountant authorizes', async () => {
    const mixed: FinanceActorContext = {
      ...approver, uid: 'mixed-approver',
      assignments: [
        { ...approver.assignments[0], id: 'a-future-approver', userId: 'mixed-approver', effectiveFrom: '2026-07-31T00:00:00Z' },
        { ...approver.assignments[0], id: 'z-current-accountant', userId: 'mixed-approver', role: 'accountant' },
      ],
    }
    await seedAuthorization(mixed)
    await expect(repository.createFinanceApproval(mixed, {
      id: 'bad-provenance', orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', action: 'journal.post',
      subjectDigest: financeApprovalSubjectDigest('journal.post', command('bad-provenance')),
      reason: 'Must not use future assignment', expectedVersion: 0, ...request('bad-provenance'),
    })).rejects.toThrow('effective finance approver assignment')
  })

  test('period status idempotency replays matching close/reopen and records request metadata', async () => {
    const close = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a',
      status: 'soft_closed' as const, expectedVersion: 1, reason: 'Month end', approvalId: 'close-approval',
      requestId: 'close-request', idempotencyKey: 'close-idem' }
    await approve('period.close', close, close.approvalId)
    const closed = await repository.changePeriodStatus(actor, close)
    await expect(repository.changePeriodStatus(actor, close)).resolves.toEqual(closed)
    await expect(repository.changePeriodStatus(actor, { ...close, reason: 'Different close' }))
      .rejects.toThrow('payload mismatch')
    const reopen = { ...close, status: 'open' as const, expectedVersion: 2, reason: 'Approved correction',
      approvalId: 'reopen-approval', requestId: 'reopen-request', idempotencyKey: 'reopen-idem' }
    await approve('period.reopen', reopen, reopen.approvalId)
    const reopened = await repository.changePeriodStatus(actor, reopen)
    await expect(repository.changePeriodStatus(actor, reopen)).resolves.toEqual(reopened)
    const event = (await db.collection('finance_audit_events').where('aggregateId', '==', 'period-a').get()).docs
      .map((item) => item.data() as FinanceAuditEvent).find((item) => item.aggregateVersion === reopened.version)
    expect(event).toEqual(expect.objectContaining({ requestId: reopen.requestId, idempotencyKey: reopen.idempotencyKey }))
  })

  test('stores identical logical entity/book IDs independently across tenants', async () => {
    const actorB: FinanceActorContext = {
      ...actor, uid: 'poster-b', orgId: 'org-b',
      assignments: [{ ...actor.assignments[0], id: 'poster-b-assignment', userId: 'poster-b', orgId: 'org-b' }],
    }
    await seedAuthorization(actorB)
    await repository.createLegalEntity(actorB, {
      id: 'entity-a', orgId: 'org-b', code: 'PIB', legalName: 'Tenant B', jurisdictionCode: 'ZA',
      functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
      timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('b-entity'),
    })
    await repository.createBook(actorB, {
      id: 'book-a', orgId: 'org-b', legalEntityId: 'entity-a', code: 'MAIN', name: 'Tenant B book', bookType: 'primary',
      functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA', taxPointPolicyId: 'za-invoice',
      defaultControlAccountIds: {}, status: 'active', cutoverAt: '2026-07-01', expectedVersion: 0, ...request('b-book'),
    })
    expect((await db.collection('legal_entities').where('id', '==', 'entity-a').get()).size).toBe(2)
    expect((await db.collection('accounting_books').where('id', '==', 'book-a').get()).size).toBe(2)
  })

  test.each([
    ['2026-7-01', '2026-07-31'],
    ['2026-02-30', '2026-03-31'],
  ])('rejects malformed canonical period date %s', async (startsAt, endsAt) => {
    await expect(repository.createPeriod(actor, {
      id: `bad-${startsAt}`, orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a',
      fiscalYear: 2027, periodNumber: 9, startsAt, endsAt, status: 'open', expectedVersion: 0,
      ...request(`bad-${startsAt}`),
    })).rejects.toThrow('canonical YYYY-MM-DD')
  })

  test('verifies the audit chain and detects aggregate/line tampering', async () => {
    const input = command('journal-a'); await approve('journal.post', input, input.approvalId)
    const posted = await repository.postJournal(actor, input)
    const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }
    const eventDocs = await db.collection('finance_audit_events').where('orgId', '==', scope.orgId)
      .where('legalEntityId', '==', scope.legalEntityId).where('bookId', '==', scope.bookId).get()
    const events = eventDocs.docs.map((item) => item.data() as FinanceAuditEvent)
    const headDoc = (await db.collection('finance_audit_heads').where('bookId', '==', scope.bookId).get()).docs[0]
    const journalDoc = (await db.collection('journal_entries').where('id', '==', posted.id).get()).docs[0]
    const lineDocs = await db.collection('journal_lines').where('journalEntryId', '==', posted.id).get()
    const lines = lineDocs.docs.map((item) => item.data() as JournalLine).sort((a, b) => a.sequence - b.sequence)
    const journal = { ...journalDoc.data(), lines } as PostedJournalEntry
    expect(() => verifyFinanceAuditChain({ scope, events, head: headDoc.data() as never, journals: [journal] })).not.toThrow()
    await lineDocs.docs[0].ref.update({ debitMinor: 999 })
    const tamperedLines = (await db.collection('journal_lines').where('journalEntryId', '==', posted.id).get()).docs
      .map((item) => item.data() as JournalLine).sort((a, b) => a.sequence - b.sequence)
    expect(() => verifyFinanceAuditChain({ scope, events, head: headDoc.data() as never,
      journals: [{ ...journal, lines: tamperedLines }] })).toThrow('line digest')
  })

  test('loads the exact scoped original and derives equal-opposite reversal lines transactionally', async () => {
    const input = command('journal-a'); await approve('journal.post', input, input.approvalId)
    const original = await repository.postJournal(actor, input)
    const reverseCommand = {
      originalJournalId: original.id, reversalJournalId: 'journal-r', orgId: 'org-a', legalEntityId: 'entity-a',
      bookId: 'book-a', periodId: 'period-a', postingDate: '2026-07-20', reason: 'Correction',
      requestId: 'request-r', idempotencyKey: 'idem-r', expectedVersion: 0 as const,
    }
    await approve('journal.reverse', reverseCommand, 'reverse-approval')
    const reversal = await repository.reverseJournal(actor, { ...reverseCommand, approvalId: 'reverse-approval' })
    expect(reversal.lines.map((line) => [line.debitMinor, line.creditMinor])).toEqual([[0, 1000], [1000, 0]])
    expect((await db.collection('journal_entries').where('id', '==', original.id).get()).docs[0].data().contentHash)
      .toBe(original.contentHash)
  })

  test('rejects reversal when the stored original aggregate no longer matches its full content hash', async () => {
    const input = command('journal-a'); await approve('journal.post', input, input.approvalId)
    const original = await repository.postJournal(actor, input)
    const originalDoc = (await db.collection('journal_entries').where('id', '==', original.id).get()).docs[0]
    await originalDoc.ref.update({ description: 'tampered original' })
    const reverse = { originalJournalId: original.id, reversalJournalId: 'journal-r', orgId: 'org-a',
      legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a', postingDate: '2026-07-20',
      reason: 'Correction', requestId: 'request-r', idempotencyKey: 'idem-r', expectedVersion: 0 as const }
    await approve('journal.reverse', reverse, 'reverse-approval')
    await expect(repository.reverseJournal(actor, { ...reverse, approvalId: 'reverse-approval' }))
      .rejects.toThrow('content hash')
    expect((await db.collection('journal_entries').where('id', '==', 'journal-r').get()).empty).toBe(true)
  })

  test('rules deny authenticated direct-client access to immutable finance collections', async () => {
    const client = environment.authenticatedContext('attacker').firestore()
    await assertFails(setDoc(doc(client, 'journal_entries/forged'), { orgId: 'org-a' }))
    await assertFails(getDoc(doc(client, 'journal_entries/forged')))
    await assertFails(setDoc(doc(client, 'book_policy_versions/forged'), { immutable: false }))
    await assertFails(setDoc(doc(client, 'finance_approvals/forged'), { status: 'approved' }))
  })
})
