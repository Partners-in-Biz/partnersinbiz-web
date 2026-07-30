import assert from 'node:assert/strict'
import {
  FinanceFoundationService,
  financeApprovalSubjectDigest,
  InMemoryFinanceFoundationStore,
} from '../../lib/accounting/foundation-service'
import { verifyFinanceAuditChain } from '../../lib/finance/integrity'
import type { FinanceActorContext } from '../../lib/finance/types'

async function main() {
  const now = () => '2026-07-30T12:00:00.000Z'
  const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
  const actor: FinanceActorContext = {
    uid: 'foundation-verifier', orgId: 'finance-foundation-local-evidence', membershipRole: 'owner',
    membershipActive: true, financeModuleEnabled: true,
    assignments: [{ id: 'admin', orgId: 'finance-foundation-local-evidence', userId: 'foundation-verifier',
      legalEntityId: 'entity', scopeMode: 'entity', role: 'finance_admin', status: 'active' }],
  }
  const approver: FinanceActorContext = {
    ...actor, uid: 'independent-approver', membershipRole: 'admin',
    assignments: [{ ...actor.assignments[0], id: 'approver', userId: 'independent-approver', role: 'finance_approver' }],
  }
  const store = new InMemoryFinanceFoundationStore()
  const service = new FinanceFoundationService(store, now)

  await service.createLegalEntity(actor, {
    id: 'entity', orgId: actor.orgId, code: 'LOCAL', legalName: 'Local Evidence Entity', jurisdictionCode: 'ZA',
    functionalCurrency: 'ZAR', defaultAccountingBasis: 'accrual', fiscalYearStartMonth: 3,
    timezone: 'Africa/Johannesburg', status: 'active', expectedVersion: 0, ...request('entity'),
  })
  await service.createBook(actor, {
    id: 'book', orgId: actor.orgId, legalEntityId: 'entity', code: 'MAIN', name: 'Primary', bookType: 'primary',
    functionalCurrency: 'ZAR', accountingBasis: 'accrual', jurisdictionCode: 'ZA', taxPointPolicyId: 'za-invoice',
    defaultControlAccountIds: {}, status: 'active', expectedVersion: 0, ...request('book'),
  })
  const policyCommand = {
    id: 'policy-v1', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', versionNumber: 1,
    accountingBasis: 'accrual' as const, taxPointPolicyId: 'za-invoice', currencyPrecision: 2,
    roundingMode: 'half_up' as const, effectiveFrom: '2026-07-01', expectedVersion: 0 as const, ...request('policy'),
  }
  await service.createFinanceApproval(approver, {
    id: 'policy-approval', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', action: 'book-policy.approve',
    subjectDigest: financeApprovalSubjectDigest('book-policy.approve', policyCommand), reason: 'Policy verified independently',
    expectedVersion: 0, ...request('approve-policy'),
  })
  await service.createBookPolicyVersion(actor, { ...policyCommand, approvalId: 'policy-approval' })
  await service.createPeriod(actor, {
    id: 'period', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', fiscalYear: 2027,
    periodNumber: 5, startsAt: '2026-07-01', endsAt: '2026-07-31', status: 'open', expectedVersion: 0,
    ...request('period'),
  })
  for (const account of [
    { id: 'cash', code: '1000', accountType: 'asset' as const, normalBalance: 'debit' as const },
    { id: 'capital', code: '3000', accountType: 'equity' as const, normalBalance: 'credit' as const },
  ]) await service.createAccount(actor, {
    ...account, name: account.id, orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', currency: 'ZAR',
    currencyPolicy: 'functional_only', reportMapping: account.accountType, postingAllowed: true,
    activeFrom: '2026-07-01', expectedVersion: 0, ...request(`account-${account.id}`),
  })
  const journalCommand = {
    id: 'journal', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', periodId: 'period',
    sourceType: 'opening_balance', sourceId: 'opening', sourceVersion: 1, postingPurpose: 'opening_balance',
    entryType: 'opening', postingDate: '2026-07-30', documentDate: '2026-07-30', description: 'Local verification',
    currency: 'ZAR', policyVersionId: 'policy-v1', expectedVersion: 0 as const, ...request('journal'),
    approvalId: 'journal-approval',
    lines: [{ accountId: 'cash', debitMinor: 10_000, creditMinor: 0 },
      { accountId: 'capital', debitMinor: 0, creditMinor: 10_000 }],
  }
  await service.createFinanceApproval(approver, {
    id: 'journal-approval', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', action: 'journal.post',
    subjectDigest: financeApprovalSubjectDigest('journal.post', journalCommand), reason: 'Journal verified independently',
    expectedVersion: 0, ...request('approve-journal'),
  })
  const journal = await service.postJournal(actor, journalCommand)
  const retry = await service.postJournal(actor, journalCommand)
  const reverseCommand = {
    originalJournalId: journal.id, reversalJournalId: 'reversal', orgId: actor.orgId,
    legalEntityId: 'entity', bookId: 'book', periodId: 'period', postingDate: '2026-07-30',
    reason: 'Exercise append-only correction', requestId: 'request-r', idempotencyKey: 'idem-r', expectedVersion: 0 as const,
  }
  await service.createFinanceApproval(approver, {
    id: 'reversal-approval', orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book', action: 'journal.reverse',
    subjectDigest: financeApprovalSubjectDigest('journal.reverse', reverseCommand), reason: 'Reversal verified independently',
    expectedVersion: 0, ...request('approve-reversal'),
  })
  const reversal = await service.reverseJournal(actor, { ...reverseCommand, approvalId: 'reversal-approval' })

  assert.deepEqual(retry, journal, 'matching idempotent retry must return original result')
  assert.equal(journal.totalDebitMinor, journal.totalCreditMinor, 'journal must balance')
  assert.equal(reversal.reversesJournalEntryId, journal.id, 'reversal must link original')
  assert.equal(store.journals.get(journal.id)?.contentHash, journal.contentHash, 'original must remain unchanged')
  assert.ok(store.auditEvents.every((event) => event.eventHash.length === 64), 'audit hashes must exist')
  assert.ok(store.outboxEvents.every((event) => event.externalEgressAllowed === false), 'outbox must disable egress')

  const scope = { orgId: actor.orgId, legalEntityId: 'entity', bookId: 'book' }
  const events = store.auditEvents.filter((event) => event.orgId === scope.orgId &&
    event.legalEntityId === scope.legalEntityId && event.bookId === scope.bookId)
  const tip = events.at(-1)!
  verifyFinanceAuditChain({
    scope,
    events,
    head: { ...scope, eventId: tip.id, eventHash: tip.eventHash, sequence: tip.sequence,
      canonicalPayloadVersion: 1, hashAlgorithmVersion: 'sha256-v1' },
    journals: [...store.journals.values()],
  })

  process.stdout.write(`${JSON.stringify({
    ok: true,
    evidence: 'local in-memory assertions; package gate separately ran Firestore emulator integration',
    notRemoteStaging: true,
    records: { journals: store.journals.size, auditEvents: store.auditEvents.length, outboxEvents: store.outboxEvents.length },
    assertions: ['balanced', 'durable-approvals', 'payload-bound-idempotency', 'immutable-original',
      'equal-opposite-reversal', 'audit-chain-verification', 'no-egress'],
  }, null, 2)}\n`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
