/**
 * Development/staging verification for optional intercompany accounting:
 * pairs, approval-controlled entries, due-to/due-from balances,
 * elimination rules, and consolidated reporting boundaries.
 * No external payments, SARS, egress, or production deploy.
 */
import { FinanceIntercompanyService, InMemoryIntercompanyStore } from '../../lib/accounting/intercompany-service'
import { canonicalDigest, HASH_ALGORITHM_VERSION } from '../../lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '../../lib/finance/types'

const now = '2026-07-30T15:00:00.000Z'
const request = (key: string) => ({ requestId: `verify-${key}`, idempotencyKey: `verify-idem-${key}` })
const orgId = 'org-verify'

function actorFor(uid: string, entities: Array<{ legalEntityId: string; role: FinanceActorContext['assignments'][number]['role'] }>): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'owner',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: entities.map((entity, index) => ({
      id: `${uid}-a${index}`,
      orgId,
      userId: uid,
      legalEntityId: entity.legalEntityId,
      scopeMode: 'entity',
      role: entity.role,
      status: 'active',
    })),
  }
}

const admin = actorFor('verify-admin', [
  { legalEntityId: 'entity-a', role: 'finance_admin' },
  { legalEntityId: 'entity-b', role: 'finance_admin' },
  { legalEntityId: 'entity-group', role: 'finance_admin' },
])
const sourceAccountant = actorFor('verify-src-acct', [{ legalEntityId: 'entity-a', role: 'accountant' }])
const receivingAccountant = actorFor('verify-rcv-acct', [{ legalEntityId: 'entity-b', role: 'accountant' }])

function makeApproval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason'> & {
  legalEntityId: string
  bookId: string
}): FinanceApprovalRecord {
  const base = {
    orgId,
    legalEntityId: partial.legalEntityId,
    bookId: partial.bookId,
    id: partial.id,
    schemaVersion: 1 as const,
    action: partial.action,
    status: 'approved' as const,
    approvedBy: 'verify-approver',
    approverRole: 'finance_approver' as const,
    approverAssignmentId: 'verify-approver-a0',
    approvedAt: now,
    reason: partial.reason,
    subjectDigest: canonicalDigest({ id: partial.id, action: partial.action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function main() {
  const store = new InMemoryIntercompanyStore()
  const service = new FinanceIntercompanyService(store, () => now)
  service.registerBookType('book-a', 'primary')
  service.registerBookType('book-b', 'primary')
  service.registerBookType('book-consol', 'consolidation')

  const pair = await service.createPair(admin, {
    id: 'pair-verify', orgId, groupOrgId: orgId,
    sourceLegalEntityId: 'entity-a', sourceBookId: 'book-a',
    receivingLegalEntityId: 'entity-b', receivingBookId: 'book-b',
    sourceDueFromAccountId: 'a-due-from', sourceDueToAccountId: 'a-due-to',
    receivingDueFromAccountId: 'b-due-from', receivingDueToAccountId: 'b-due-to',
    enabledTransactionTypes: ['charge'], requireReceiveApproval: true, currency: 'ZAR',
    expectedVersion: 0, ...request('pair'),
  })
  const active = await service.activatePair(admin, {
    orgId, pairId: pair.id, expectedVersion: pair.version, ...request('pair-activate'),
  })
  if (active.status !== 'active') throw new Error('pair not active')

  const proposed = await service.proposeTransaction(sourceAccountant, {
    id: 'tx-verify', orgId, pairId: pair.id, transactionType: 'charge',
    transactionDate: '2026-07-20', amountMinor: 25_000, currency: 'ZAR',
    description: 'Verify IC charge',
    sourcePnlAccountId: 'a-revenue', receivingPnlAccountId: 'b-expense',
    expectedVersion: 0, ...request('tx-propose'),
  })
  const sourcePosted = await service.postSource(sourceAccountant, {
    orgId, transactionId: proposed.id, expectedVersion: proposed.version,
    sourceJournalEntryId: 'j-src-verify', ...request('tx-source'),
  })
  service.registerApproval(makeApproval({
    id: 'ap-receive-verify', action: 'intercompany.receive', reason: 'Receive OK',
    legalEntityId: 'entity-b', bookId: 'book-b',
  }))
  const receiveApproved = await service.approveReceive(admin, {
    orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version,
    approvalId: 'ap-receive-verify', reason: 'Book receive', ...request('tx-approve'),
  })
  const matched = await service.postReceiving(receivingAccountant, {
    orgId, transactionId: receiveApproved.id, expectedVersion: receiveApproved.version,
    receivingJournalEntryId: 'j-rcv-verify', ...request('tx-rcv'),
  })
  if (matched.status !== 'matched') throw new Error('transaction not matched')

  const balances = service.reconcilePairBalances(sourceAccountant, orgId, pair.id)
  if (!balances.reconciled || balances.differenceMinor !== 0) {
    throw new Error(`due-to/due-from not reconciled: ${balances.differenceMinor}`)
  }
  if (balances.sourceDueFromMinor !== 25_000 || balances.receivingDueToMinor !== 25_000) {
    throw new Error('control balances incorrect')
  }

  const rule = await service.createEliminationRule(admin, {
    id: 'rule-verify', orgId, groupOrgId: orgId, code: 'IC-ELIM', name: 'IC elimination',
    dimension: 'due_to_due_from', pairId: pair.id,
    consolidationLegalEntityId: 'entity-group', consolidationBookId: 'book-consol',
    debitAccountId: 'c-due-to', creditAccountId: 'c-due-from',
    expectedVersion: 0, ...request('rule'),
  })
  service.registerApproval(makeApproval({
    id: 'ap-rule-verify', action: 'elimination.rule.approve', reason: 'Rule OK',
    legalEntityId: 'entity-group', bookId: 'book-consol',
  }))
  const approvedRule = await service.approveEliminationRule(admin, {
    orgId, ruleId: rule.id, expectedVersion: rule.version,
    approvalId: 'ap-rule-verify', reason: 'Approve', ...request('rule-approve'),
  })

  const run = await service.createConsolidationRun(admin, {
    id: 'run-verify', orgId, groupOrgId: orgId,
    consolidationLegalEntityId: 'entity-group', consolidationBookId: 'book-consol',
    consolidationPeriodId: 'period-c', asOfDate: '2026-07-31',
    memberBooks: [
      { legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a' },
      { legalEntityId: 'entity-b', bookId: 'book-b', periodId: 'period-b' },
    ],
    eliminationRuleIds: [approvedRule.id],
    expectedVersion: 0, ...request('run'),
  })
  const pinned = await service.pinConsolidationRun(admin, {
    orgId, runId: run.id, expectedVersion: run.version,
    sourceCutoffDigest: 'verify-cutoff', ...request('run-pin'),
  })
  const posted = await service.postEliminations(admin, {
    orgId, runId: pinned.id, expectedVersion: pinned.version,
    pairId: pair.id, amountMinor: 25_000, currency: 'ZAR',
    description: 'Eliminate verify IC',
    sourceTransactionIds: [matched.id],
    consolidationJournalEntryId: 'j-elim-verify',
    ...request('run-post'),
  })
  if (posted.entry.bookId !== 'book-consol') throw new Error('elimination not in consolidation book')
  if (posted.entry.lines[0].debitMinor !== posted.entry.lines[1].creditMinor) throw new Error('elimination unbalanced')

  // Entity attribution preserved after elimination
  const afterElim = service.reconcilePairBalances(sourceAccountant, orgId, pair.id)
  if (afterElim.sourceDueFromMinor !== 25_000) throw new Error('entity book mutated by elimination')

  const boundary = service.reportingBoundary(admin, orgId, posted.run.id)
  if (!boundary.eliminationsOnlyInConsolidationBook || !boundary.entityBooksImmutableUnderElimination) {
    throw new Error('reporting boundary violated')
  }

  service.registerApproval(makeApproval({
    id: 'ap-run-verify', action: 'consolidation.run.approve', reason: 'Run OK',
    legalEntityId: 'entity-group', bookId: 'book-consol',
  }))
  const approvedRun = await service.approveConsolidationRun(admin, {
    orgId, runId: posted.run.id, expectedVersion: posted.run.version,
    approvalId: 'ap-run-verify', reason: 'Lock', ...request('run-approve'),
  })
  if (approvedRun.status !== 'approved') throw new Error('run not approved')
  if (store.auditEvents.some((event) => event.externalEgressAllowed !== false)) {
    throw new Error('audit egress must be false')
  }
  if (store.auditEvents.length < 10) throw new Error(`expected audit trail, got ${store.auditEvents.length}`)

  console.log(JSON.stringify({
    ok: true,
    pairId: pair.id,
    pairStatus: active.status,
    transactionId: matched.id,
    transactionStatus: matched.status,
    sourceDueFromMinor: balances.sourceDueFromMinor,
    receivingDueToMinor: balances.receivingDueToMinor,
    reconciled: balances.reconciled,
    differenceMinor: balances.differenceMinor,
    eliminationEntryId: posted.entry.id,
    eliminationBookId: posted.entry.bookId,
    consolidationRunStatus: approvedRun.status,
    entityBooksImmutableUnderElimination: boundary.entityBooksImmutableUnderElimination,
    eliminationsOnlyInConsolidationBook: boundary.eliminationsOnlyInConsolidationBook,
    auditEvents: store.auditEvents.length,
    noEgress: true,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
