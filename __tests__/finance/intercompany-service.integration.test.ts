import { canonicalDigest, HASH_ALGORITHM_VERSION } from '@/lib/finance/integrity'
import type { FinanceActorContext, FinanceApprovalRecord } from '@/lib/finance/types'
import { FinanceIntercompanyService, InMemoryIntercompanyStore } from '@/lib/accounting/intercompany-service'

const now = '2026-07-30T14:00:00.000Z'
const request = (key: string) => ({ requestId: `request-${key}`, idempotencyKey: `idem-${key}` })
const orgId = 'org-a'

function actorFor(uid: string, entities: Array<{ legalEntityId: string; bookId?: string; role: FinanceActorContext['assignments'][number]['role'] }>): FinanceActorContext {
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
      ...(entity.bookId ? { bookId: entity.bookId, scopeMode: 'book' as const } : { scopeMode: 'entity' as const }),
      role: entity.role,
      status: 'active' as const,
    })),
  }
}

const groupAdmin = actorFor('group-admin', [
  { legalEntityId: 'entity-a', role: 'finance_admin' },
  { legalEntityId: 'entity-b', role: 'finance_admin' },
  { legalEntityId: 'entity-group', role: 'finance_admin' },
])
const sourceAccountant = actorFor('source-accountant', [
  { legalEntityId: 'entity-a', role: 'accountant' },
])
const receivingAccountant = actorFor('receiving-accountant', [
  { legalEntityId: 'entity-b', role: 'accountant' },
])
const receivingApprover = actorFor('receiving-approver', [
  { legalEntityId: 'entity-b', role: 'finance_approver' },
])
const consolidationApprover = actorFor('consol-approver', [
  { legalEntityId: 'entity-group', role: 'finance_approver' },
])

function approval(partial: Pick<FinanceApprovalRecord, 'id' | 'action' | 'reason'> & {
  legalEntityId: string
  bookId: string
  approvedBy: string
  approverAssignmentId: string
}): FinanceApprovalRecord {
  const base = {
    orgId,
    legalEntityId: partial.legalEntityId,
    bookId: partial.bookId,
    id: partial.id,
    schemaVersion: 1 as const,
    action: partial.action,
    status: 'approved' as const,
    approvedBy: partial.approvedBy,
    approverRole: 'finance_approver' as const,
    approverAssignmentId: partial.approverAssignmentId,
    approvedAt: now,
    reason: partial.reason,
    subjectDigest: canonicalDigest({ id: partial.id, action: partial.action }),
    immutable: true as const,
    canonicalPayloadVersion: 1 as const,
    hashAlgorithmVersion: HASH_ALGORITHM_VERSION,
  }
  return { ...base, contentHash: canonicalDigest(base) }
}

async function seedPair(service: FinanceIntercompanyService) {
  service.registerBookType('book-a', 'primary')
  service.registerBookType('book-b', 'primary')
  service.registerBookType('book-consol', 'consolidation')
  const pair = await service.createPair(groupAdmin, {
    id: 'pair-1', orgId, groupOrgId: orgId,
    sourceLegalEntityId: 'entity-a', sourceBookId: 'book-a',
    receivingLegalEntityId: 'entity-b', receivingBookId: 'book-b',
    sourceDueFromAccountId: 'a-due-from', sourceDueToAccountId: 'a-due-to',
    receivingDueFromAccountId: 'b-due-from', receivingDueToAccountId: 'b-due-to',
    enabledTransactionTypes: ['charge'],
    requireReceiveApproval: true,
    currency: 'ZAR',
    expectedVersion: 0,
    ...request('pair-create'),
  })
  return service.activatePair(groupAdmin, {
    orgId, pairId: pair.id, expectedVersion: pair.version, ...request('pair-activate'),
  })
}

describe('finance intercompany service', () => {
  test('posts matched due-to/due-from charge with receive approval and balanced reconciliation', async () => {
    const store = new InMemoryIntercompanyStore()
    const service = new FinanceIntercompanyService(store, () => now)
    const pair = await seedPair(service)

    const proposed = await service.proposeTransaction(sourceAccountant, {
      id: 'tx-1', orgId, pairId: pair.id, transactionType: 'charge',
      transactionDate: '2026-07-15', amountMinor: 10_000, currency: 'ZAR',
      description: 'Management fee',
      sourcePnlAccountId: 'a-revenue', receivingPnlAccountId: 'b-expense',
      expectedVersion: 0, ...request('tx-propose'),
    })
    expect(proposed.status).toBe('proposed')
    expect(proposed.source.journalLines).toHaveLength(2)
    expect(proposed.receiving.journalLines).toHaveLength(2)

    const sourcePosted = await service.postSource(sourceAccountant, {
      orgId, transactionId: proposed.id, expectedVersion: proposed.version,
      sourceJournalEntryId: 'j-src-1', ...request('tx-source'),
    })
    expect(sourcePosted.status).toBe('pending_receive')
    expect(sourcePosted.source.journalEntryId).toBe('j-src-1')

    await expect(service.postReceiving(receivingAccountant, {
      orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version, ...request('tx-rcv-early'),
    })).rejects.toThrow('receive approval')

    service.registerApproval(approval({
      id: 'ap-receive', action: 'intercompany.receive', reason: 'OK to book',
      legalEntityId: 'entity-b', bookId: 'book-b',
      approvedBy: receivingApprover.uid, approverAssignmentId: 'receiving-approver-a0',
    }))
    const approved = await service.approveReceive(groupAdmin, {
      orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version,
      approvalId: 'ap-receive', reason: 'Receiver accepted', ...request('tx-approve'),
    })
    // groupAdmin has finance_admin on entity-b so can call receive_approve; approval evidence is by receivingApprover
    expect(approved.receiveApprovalId).toBe('ap-receive')

    const matched = await service.postReceiving(receivingAccountant, {
      orgId, transactionId: approved.id, expectedVersion: approved.version,
      receivingJournalEntryId: 'j-rcv-1', ...request('tx-rcv'),
    })
    expect(matched.status).toBe('matched')
    expect(matched.immutable).toBe(true)
    expect(matched.receiving.journalEntryId).toBe('j-rcv-1')

    const balances = service.reconcilePairBalances(sourceAccountant, orgId, pair.id)
    expect(balances.sourceDueFromMinor).toBe(10_000)
    expect(balances.receivingDueToMinor).toBe(10_000)
    expect(balances.reconciled).toBe(true)
    expect(balances.differenceMinor).toBe(0)
    expect(balances.matchedTransactionIds).toEqual(['tx-1'])
    expect(store.auditEvents.every((event) => event.externalEgressAllowed === false)).toBe(true)
    expect(store.auditEvents.length).toBeGreaterThanOrEqual(5)
  })

  test('rejects same-entity pair, self receive approval, and entity-book elimination mutation', async () => {
    const store = new InMemoryIntercompanyStore()
    const service = new FinanceIntercompanyService(store, () => now)
    service.registerBookType('book-a', 'primary')
    service.registerBookType('book-b', 'primary')
    service.registerBookType('book-consol', 'consolidation')

    await expect(service.createPair(groupAdmin, {
      id: 'pair-bad', orgId, groupOrgId: orgId,
      sourceLegalEntityId: 'entity-a', sourceBookId: 'book-a',
      receivingLegalEntityId: 'entity-a', receivingBookId: 'book-a2',
      sourceDueFromAccountId: 'a-due-from', sourceDueToAccountId: 'a-due-to',
      receivingDueFromAccountId: 'a-due-from-2', receivingDueToAccountId: 'a-due-to-2',
      enabledTransactionTypes: ['charge'], currency: 'ZAR', expectedVersion: 0, ...request('pair-bad'),
    })).rejects.toThrow('must differ')

    const pair = await seedPair(service)
    const proposed = await service.proposeTransaction(sourceAccountant, {
      id: 'tx-2', orgId, pairId: pair.id, transactionType: 'charge',
      transactionDate: '2026-07-16', amountMinor: 5_000, currency: 'ZAR',
      description: 'Charge',
      sourcePnlAccountId: 'a-revenue', receivingPnlAccountId: 'b-expense',
      expectedVersion: 0, ...request('tx2-propose'),
    })
    const sourcePosted = await service.postSource(sourceAccountant, {
      orgId, transactionId: proposed.id, expectedVersion: proposed.version, ...request('tx2-source'),
    })
    service.registerApproval(approval({
      id: 'ap-self', action: 'intercompany.receive', reason: 'self',
      legalEntityId: 'entity-b', bookId: 'book-b',
      approvedBy: 'someone-else', approverAssignmentId: 'x',
    }))
    await expect(service.approveReceive(sourceAccountant, {
      orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version,
      approvalId: 'ap-self', reason: 'nope', ...request('tx2-self'),
    })).rejects.toThrow(/assignment|separation|Finance role/i)

    await expect(service.createEliminationRule(groupAdmin, {
      id: 'rule-entity', orgId, groupOrgId: orgId, code: 'BAD', name: 'Bad',
      dimension: 'due_to_due_from', consolidationLegalEntityId: 'entity-a', consolidationBookId: 'book-a',
      debitAccountId: 'x', creditAccountId: 'y', expectedVersion: 0, ...request('rule-bad'),
    })).rejects.toThrow('consolidation book')
  })

  test('posts eliminations only into consolidation book and preserves reporting boundary', async () => {
    const store = new InMemoryIntercompanyStore()
    const service = new FinanceIntercompanyService(store, () => now)
    const pair = await seedPair(service)

    const proposed = await service.proposeTransaction(sourceAccountant, {
      id: 'tx-3', orgId, pairId: pair.id, transactionType: 'charge',
      transactionDate: '2026-07-18', amountMinor: 10_000, currency: 'ZAR',
      description: 'IC fee',
      sourcePnlAccountId: 'a-revenue', receivingPnlAccountId: 'b-expense',
      expectedVersion: 0, ...request('tx3-propose'),
    })
    const sourcePosted = await service.postSource(sourceAccountant, {
      orgId, transactionId: proposed.id, expectedVersion: proposed.version, ...request('tx3-source'),
    })
    service.registerApproval(approval({
      id: 'ap-receive-3', action: 'intercompany.receive', reason: 'OK',
      legalEntityId: 'entity-b', bookId: 'book-b',
      approvedBy: receivingApprover.uid, approverAssignmentId: 'receiving-approver-a0',
    }))
    const receiveApproved = await service.approveReceive(groupAdmin, {
      orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version,
      approvalId: 'ap-receive-3', reason: 'Accept', ...request('tx3-approve'),
    })
    const matched = await service.postReceiving(receivingAccountant, {
      orgId, transactionId: receiveApproved.id, expectedVersion: receiveApproved.version, ...request('tx3-rcv'),
    })

    const rule = await service.createEliminationRule(groupAdmin, {
      id: 'rule-1', orgId, groupOrgId: orgId, code: 'IC-DTDF', name: 'Eliminate due-to/due-from',
      dimension: 'due_to_due_from', pairId: pair.id,
      consolidationLegalEntityId: 'entity-group', consolidationBookId: 'book-consol',
      debitAccountId: 'c-due-to', creditAccountId: 'c-due-from',
      expectedVersion: 0, ...request('rule-create'),
    })
    service.registerApproval(approval({
      id: 'ap-rule', action: 'elimination.rule.approve', reason: 'Rule OK',
      legalEntityId: 'entity-group', bookId: 'book-consol',
      approvedBy: consolidationApprover.uid, approverAssignmentId: 'consol-approver-a0',
    }))
    const approvedRule = await service.approveEliminationRule(groupAdmin, {
      orgId, ruleId: rule.id, expectedVersion: rule.version,
      approvalId: 'ap-rule', reason: 'Approve rule', ...request('rule-approve'),
    })
    expect(approvedRule.status).toBe('approved')
    expect(approvedRule.immutable).toBe(true)

    const run = await service.createConsolidationRun(groupAdmin, {
      id: 'run-1', orgId, groupOrgId: orgId,
      consolidationLegalEntityId: 'entity-group', consolidationBookId: 'book-consol',
      consolidationPeriodId: 'period-c-1', asOfDate: '2026-07-31',
      memberBooks: [
        { legalEntityId: 'entity-a', bookId: 'book-a', periodId: 'period-a-1' },
        { legalEntityId: 'entity-b', bookId: 'book-b', periodId: 'period-b-1' },
      ],
      eliminationRuleIds: [approvedRule.id],
      expectedVersion: 0, ...request('run-create'),
    })
    const pinned = await service.pinConsolidationRun(groupAdmin, {
      orgId, runId: run.id, expectedVersion: run.version,
      sourceCutoffDigest: 'cutoff-abc', ...request('run-pin'),
    })
    const posted = await service.postEliminations(groupAdmin, {
      orgId, runId: pinned.id, expectedVersion: pinned.version,
      pairId: pair.id, amountMinor: matched.amountMinor, currency: 'ZAR',
      description: 'Eliminate IC balances',
      sourceTransactionIds: [matched.id],
      consolidationJournalEntryId: 'j-elim-1',
      ...request('run-post'),
    })
    expect(posted.entry.bookId).toBe('book-consol')
    expect(posted.entry.status).toBe('posted')
    expect(posted.entry.lines[0].debitMinor).toBe(10_000)
    expect(posted.entry.lines[1].creditMinor).toBe(10_000)
    expect(posted.run.status).toBe('posted')
    // Entity books still hold original IC control balances; elimination did not clear them.
    const balances = service.reconcilePairBalances(sourceAccountant, orgId, pair.id)
    expect(balances.reconciled).toBe(true)
    expect(balances.sourceDueFromMinor).toBe(10_000)

    const boundary = service.reportingBoundary(groupAdmin, orgId, posted.run.id)
    expect(boundary.eliminationsOnlyInConsolidationBook).toBe(true)
    expect(boundary.entityBooksImmutableUnderElimination).toBe(true)
    expect(boundary.memberBookIds).toEqual(['book-a', 'book-b'])
    expect(boundary.composition).toBe('member_entity_books_plus_consolidation_eliminations')

    service.registerApproval(approval({
      id: 'ap-run', action: 'consolidation.run.approve', reason: 'Consol OK',
      legalEntityId: 'entity-group', bookId: 'book-consol',
      approvedBy: consolidationApprover.uid, approverAssignmentId: 'consol-approver-a0',
    }))
    const approvedRun = await service.approveConsolidationRun(groupAdmin, {
      orgId, runId: posted.run.id, expectedVersion: posted.run.version,
      approvalId: 'ap-run', reason: 'Lock consol', ...request('run-approve'),
    })
    expect(approvedRun.status).toBe('approved')
    expect(approvedRun.immutable).toBe(true)
  })

  test('preserves rejected proposal history without receive posting', async () => {
    const store = new InMemoryIntercompanyStore()
    const service = new FinanceIntercompanyService(store, () => now)
    const pair = await seedPair(service)
    const proposed = await service.proposeTransaction(sourceAccountant, {
      id: 'tx-reject', orgId, pairId: pair.id, transactionType: 'charge',
      transactionDate: '2026-07-19', amountMinor: 2_000, currency: 'ZAR',
      description: 'Disputed',
      sourcePnlAccountId: 'a-revenue', receivingPnlAccountId: 'b-expense',
      expectedVersion: 0, ...request('txr-propose'),
    })
    const sourcePosted = await service.postSource(sourceAccountant, {
      orgId, transactionId: proposed.id, expectedVersion: proposed.version, ...request('txr-source'),
    })
    const rejected = await service.rejectTransaction(groupAdmin, {
      orgId, transactionId: sourcePosted.id, expectedVersion: sourcePosted.version,
      reason: 'Not authorised recharge', ...request('txr-reject'),
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedReason).toContain('Not authorised')
    expect(store.transactions.get(proposed.id)?.status).toBe('rejected')
    const balances = service.reconcilePairBalances(sourceAccountant, orgId, pair.id)
    expect(balances.sourceDueFromMinor).toBe(2_000)
    expect(balances.receivingDueToMinor).toBe(0)
    expect(balances.reconciled).toBe(false)
  })
})
