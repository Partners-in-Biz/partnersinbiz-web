import {
  assertDistinctLegalEntities,
  assertEliminationLinesBalanced,
  assertPairedAmountsReconcile,
  assertReceiveApproverIsNotSourceActor,
  buildChargeSourceLines,
  buildChargeReceivingLines,
  buildDueToDueFromEliminationLines,
  computeDueToDueFromBalance,
  normalizeIntercompanyPairKey,
  projectConsolidatedReportingBoundary,
  projectIntercompanyStatusAfterSourcePost,
  projectIntercompanyStatusAfterReceivePost,
} from '@/lib/accounting/intercompany'

describe('intercompany domain', () => {
  test('normalizes pair keys and rejects same-entity pairs', () => {
    expect(normalizeIntercompanyPairKey('entity-b', 'book-b', 'entity-a', 'book-a'))
      .toBe('entity-a|book-a|entity-b|book-b')
    expect(normalizeIntercompanyPairKey('entity-a', 'book-a', 'entity-b', 'book-b'))
      .toBe('entity-a|book-a|entity-b|book-b')
    expect(() => assertDistinctLegalEntities('entity-a', 'entity-a')).toThrow('must differ')
    assertDistinctLegalEntities('entity-a', 'entity-b')
  })

  test('builds balanced charge lines on source and receiving books', () => {
    const source = buildChargeSourceLines({
      amountMinor: 10_000,
      dueFromAccountId: 'a-due-from',
      revenueAccountId: 'a-revenue',
      description: 'IC charge',
    })
    expect(source).toEqual([
      { accountId: 'a-due-from', debitMinor: 10_000, creditMinor: 0, description: 'IC charge' },
      { accountId: 'a-revenue', debitMinor: 0, creditMinor: 10_000, description: 'IC charge' },
    ])
    const receiving = buildChargeReceivingLines({
      amountMinor: 10_000,
      dueToAccountId: 'b-due-to',
      expenseAccountId: 'b-expense',
      description: 'IC charge',
    })
    expect(receiving).toEqual([
      { accountId: 'b-expense', debitMinor: 10_000, creditMinor: 0, description: 'IC charge' },
      { accountId: 'b-due-to', debitMinor: 0, creditMinor: 10_000, description: 'IC charge' },
    ])
    assertPairedAmountsReconcile(10_000, 10_000, 'ZAR', 'ZAR')
    expect(() => assertPairedAmountsReconcile(10_000, 9_999, 'ZAR', 'ZAR')).toThrow('Paired amounts')
    expect(() => assertPairedAmountsReconcile(10_000, 10_000, 'ZAR', 'USD')).toThrow('currency')
  })

  test('projects lifecycle statuses and enforces receive separation of duties', () => {
    expect(projectIntercompanyStatusAfterSourcePost(true)).toBe('pending_receive')
    expect(projectIntercompanyStatusAfterSourcePost(false)).toBe('source_posted')
    expect(projectIntercompanyStatusAfterReceivePost()).toBe('matched')
    expect(() => assertReceiveApproverIsNotSourceActor('alice', 'alice')).toThrow('separation of duties')
    assertReceiveApproverIsNotSourceActor('alice', 'bob')
  })

  test('reconciles due-to/due-from control balances across the pair', () => {
    const balance = computeDueToDueFromBalance({
      pairId: 'pair-1',
      orgId: 'org-a',
      currency: 'ZAR',
      sourceLegalEntityId: 'entity-a',
      sourceBookId: 'book-a',
      receivingLegalEntityId: 'entity-b',
      receivingBookId: 'book-b',
      sourceDueFromMinor: 10_000,
      sourceDueToMinor: 0,
      receivingDueFromMinor: 0,
      receivingDueToMinor: 10_000,
      matchedTransactionIds: ['tx-1'],
      openTransactionIds: [],
    })
    expect(balance.sourceNetClaimMinor).toBe(10_000)
    expect(balance.receivingNetClaimMinor).toBe(-10_000)
    expect(balance.reconciled).toBe(true)
    expect(balance.differenceMinor).toBe(0)

    const open = computeDueToDueFromBalance({
      pairId: 'pair-1',
      orgId: 'org-a',
      currency: 'ZAR',
      sourceLegalEntityId: 'entity-a',
      sourceBookId: 'book-a',
      receivingLegalEntityId: 'entity-b',
      receivingBookId: 'book-b',
      sourceDueFromMinor: 10_000,
      sourceDueToMinor: 0,
      receivingDueFromMinor: 0,
      receivingDueToMinor: 0,
      matchedTransactionIds: [],
      openTransactionIds: ['tx-open'],
    })
    expect(open.reconciled).toBe(false)
    expect(open.differenceMinor).toBe(10_000)
  })

  test('builds balanced elimination lines and consolidated reporting boundary', () => {
    const lines = buildDueToDueFromEliminationLines({
      amountMinor: 10_000,
      dueToAccountId: 'c-due-to',
      dueFromAccountId: 'c-due-from',
      description: 'Eliminate IC',
    })
    assertEliminationLinesBalanced(lines)
    expect(lines).toEqual([
      { accountId: 'c-due-to', debitMinor: 10_000, creditMinor: 0, description: 'Eliminate IC' },
      { accountId: 'c-due-from', debitMinor: 0, creditMinor: 10_000, description: 'Eliminate IC' },
    ])
    expect(() => assertEliminationLinesBalanced([
      { accountId: 'x', debitMinor: 1, creditMinor: 0 },
      { accountId: 'y', debitMinor: 0, creditMinor: 2 },
    ])).toThrow('balanced')

    const boundary = projectConsolidatedReportingBoundary({
      groupOrgId: 'org-a',
      consolidationLegalEntityId: 'entity-group',
      consolidationBookId: 'book-consol',
      memberBookIds: ['book-a', 'book-b'],
    })
    expect(boundary.entityBooksImmutableUnderElimination).toBe(true)
    expect(boundary.eliminationsOnlyInConsolidationBook).toBe(true)
    expect(boundary.composition).toBe('member_entity_books_plus_consolidation_eliminations')
    expect(boundary.memberBookIds).not.toContain('book-consol')
  })
})
