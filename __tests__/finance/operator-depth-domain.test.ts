import {
  applyAdvancedOperatorFilters,
  buildBulkSelectionPlan,
  buildPeriodCloseCommandCentre,
  normalizeOperatorFilters,
  planMultiDocumentAllocation,
  planPartialAllocation,
  selectAllFilteredIds,
} from '@/lib/accounting/operator-depth'
import {
  OperatorDepthFinanceService,
  createEmptyOperatorDepthStore,
  cloneOperatorDepthStore,
  type OperatorDepthStore,
} from '@/lib/finance/operator-depth/service'
import type { FinanceActorContext } from '@/lib/finance/types'

function actor(overrides: Partial<FinanceActorContext> = {}): FinanceActorContext {
  return {
    uid: 'user-1',
    orgId: 'org-a',
    membershipActive: true,
    membershipRole: 'admin',
    financeModuleEnabled: true,
    assignments: [
      {
        id: 'asg-1',
        orgId: 'org-a',
        userId: 'user-1',
        role: 'finance_admin',
        status: 'active',
        legalEntityId: 'entity-a',
        scopeMode: 'entity',
      } as any,
    ],
    ...overrides,
  }
}

describe('operator depth domain helpers', () => {
  test('advanced filters support multi-status, query, unallocated and outstanding bands', () => {
    const rows = [
      { id: '1', status: 'issued', documentNumber: 'INV-000001', outstandingMinor: 11500, customerCompanyId: 'c1', issueDate: '2026-07-10' },
      { id: '2', status: 'draft', documentNumber: 'INV-000002', outstandingMinor: 0, customerCompanyId: 'c1', issueDate: '2026-07-11' },
      { id: '3', status: 'issued', documentNumber: 'INV-000003', outstandingMinor: 2000, customerCompanyId: 'c2', issueDate: '2026-07-12', description: 'retainer work' },
      { id: '4', status: 'verified', direction: 'receipt', unallocatedMinor: 5000, amountMinor: 5000, idRef: 'pay' },
    ]
    const filtered = applyAdvancedOperatorFilters(rows as any, {
      statuses: ['issued'],
      query: 'retainer',
      minOutstandingMinor: 1,
    })
    expect(filtered.map((r) => r.id)).toEqual(['3'])

    const unalloc = applyAdvancedOperatorFilters(rows as any, { unallocatedOnly: true })
    expect(unalloc.map((r) => r.id)).toEqual(['4'])

    expect(() => normalizeOperatorFilters({ minOutstandingMinor: 10, maxOutstandingMinor: 5 })).toThrow(/minOutstandingMinor/)
  })

  test('select all filtered caps at 50 and records bulk selection plan', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `inv-${i}`, status: 'draft' }))
    const plan = selectAllFilteredIds(rows, { status: 'draft' })
    expect(plan.filteredCount).toBe(60)
    expect(plan.selectedIds).toHaveLength(50)
    expect(plan.capped).toBe(true)
    expect(plan.selectAllFiltered).toBe(true)

    const explicit = buildBulkSelectionPlan({
      action: 'bulk_void',
      resourceKind: 'ar_documents',
      rows,
      explicitIds: ['inv-1', 'inv-2'],
    })
    expect(explicit.selectedIds).toEqual(['inv-1', 'inv-2'])
    expect(() =>
      buildBulkSelectionPlan({
        action: 'bulk_issue',
        resourceKind: 'ar_documents',
        rows,
        explicitIds: ['missing'],
      }),
    ).toThrow(/not in list scope/)
  })

  test('partial allocation leaves remainder unallocated', () => {
    const plan = planPartialAllocation({
      paymentId: 'pay-1',
      paymentUnallocatedMinor: 10000,
      targetType: 'customer_invoice',
      targetId: 'inv-1',
      outstandingMinor: 15000,
      allocatedMinor: 4000,
    })
    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]?.allocatedMinor).toBe(4000)
    expect(plan.remainderMinor).toBe(6000)
    expect(plan.externalPaymentInitiated).toBe(false)
  })

  test('multi-invoice allocate + overpay on_account consumes full payment', () => {
    const plan = planMultiDocumentAllocation({
      paymentId: 'pay-1',
      paymentUnallocatedMinor: 10000,
      overpayMode: 'on_account',
      targets: [
        { targetType: 'customer_invoice', targetId: 'inv-1', outstandingMinor: 3000 },
        { targetType: 'customer_invoice', targetId: 'inv-2', outstandingMinor: 4000 },
      ],
    })
    expect(plan.lines).toHaveLength(3)
    expect(plan.lines[0]?.allocatedMinor).toBe(3000)
    expect(plan.lines[1]?.allocatedMinor).toBe(4000)
    expect(plan.lines[2]).toMatchObject({ targetType: 'on_account', allocatedMinor: 3000 })
    expect(plan.remainderMinor).toBe(0)
    expect(plan.allocatedTotalMinor).toBe(10000)
    expect(plan.externalPaymentInitiated).toBe(false)
  })

  test('overpay reject mode throws when surplus remains', () => {
    expect(() =>
      planMultiDocumentAllocation({
        paymentId: 'pay-1',
        paymentUnallocatedMinor: 5000,
        overpayMode: 'reject',
        targets: [{ targetType: 'customer_invoice', targetId: 'inv-1', outstandingMinor: 2000 }],
      }),
    ).toThrow(/overpay remainder/)
  })

  test('period-close command centre lists blockers with deep links', () => {
    const centre = buildPeriodCloseCommandCentre({
      orgId: 'org-a',
      legalEntityId: 'entity-a',
      bookId: 'book-a',
      asOfDate: '2026-08-31',
      periodId: 'p-2026-08',
      periodLabel: '2026-P8',
      reconciliations: [
        { id: 'rec-1', status: 'open' },
        { id: 'rec-2', status: 'approved' },
      ],
      journals: [
        { id: 'j-1', status: 'draft' },
        { id: 'j-2', status: 'posted' },
      ],
      payRuns: [
        { id: 'pr-1', status: 'in_review' },
        { id: 'pr-2', status: 'approved_locked' },
      ],
      fxRevaluationRuns: [],
      cutoverPackages: [{ id: 'cut-1', status: 'draft' }],
      requireFxReval: true,
      requireCutoverComplete: true,
    })
    expect(centre.readyToClose).toBe(false)
    expect(centre.blockerCount).toBeGreaterThanOrEqual(4)
    const codes = centre.blockers.map((b) => b.code)
    expect(codes).toEqual(
      expect.arrayContaining(['unreconciled_bank', 'unapproved_journals', 'open_pay_runs', 'missing_fx_reval', 'incomplete_cutover']),
    )
    for (const blocker of centre.blockers) {
      expect(blocker.href).toContain('orgId=org-a')
      expect(blocker.href).toContain('/portal/finance/')
    }
    expect(centre.externalPaymentInitiated).toBe(false)
    expect(centre.sarsSubmissionInitiated).toBe(false)
    expect(centre.externalEgressAllowed).toBe(false)

    const clean = buildPeriodCloseCommandCentre({
      orgId: 'org-a',
      legalEntityId: 'entity-a',
      bookId: 'book-a',
      asOfDate: '2026-08-31',
      reconciliations: [{ id: 'rec-2', status: 'approved' }],
      journals: [{ id: 'j-2', status: 'posted' }],
      payRuns: [{ id: 'pr-2', status: 'approved_locked' }],
      requireFxReval: false,
      requireCutoverComplete: false,
    })
    expect(clean.readyToClose).toBe(true)
    expect(clean.blockers).toHaveLength(0)
  })
})

describe('operator depth service', () => {
  function memoryService() {
    let store = createEmptyOperatorDepthStore()
    return new OperatorDepthFinanceService(
      async () => cloneOperatorDepthStore(store),
      async (_before, after) => {
        store = cloneOperatorDepthStore(after)
      },
      () => '2026-08-03T12:00:00.000Z',
    )
  }

  test('saved views + bulk selection + allocation plans write audit events', async () => {
    const service = memoryService()
    const a = actor()
    const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

    const view = await service.upsertSavedView(a, {
      ...scope,
      resourceKind: 'ar_documents',
      name: 'Open AR',
      filters: { status: 'issued', minOutstandingMinor: 1 },
    })
    expect(view.version).toBe(1)

    const bulk = await service.planBulkSelection(a, {
      ...scope,
      action: 'bulk_issue',
      resourceKind: 'ar_documents',
      rows: [
        { id: 'inv-1', status: 'draft' },
        { id: 'inv-2', status: 'draft' },
        { id: 'inv-3', status: 'issued' },
      ],
      filters: { status: 'draft' },
      selectAllFiltered: true,
    })
    expect(bulk.selectedIds).toEqual(['inv-1', 'inv-2'])
    expect(bulk.auditId).toBeTruthy()

    const alloc = await service.planAllocation(a, {
      ...scope,
      mode: 'multi',
      paymentId: 'pay-1',
      paymentUnallocatedMinor: 5000,
      overpayMode: 'leave_unallocated',
      targets: [
        { targetType: 'customer_invoice', targetId: 'inv-1', outstandingMinor: 2000 },
        { targetType: 'customer_invoice', targetId: 'inv-2', outstandingMinor: 2000 },
      ],
    })
    expect(alloc.lines).toHaveLength(2)
    expect(alloc.remainderMinor).toBe(1000)
    expect(alloc.externalPaymentInitiated).toBe(false)
    expect(alloc.auditId).toBeTruthy()

    const bundle = await service.getBundle(a, scope.orgId, scope.legalEntityId, scope.bookId)
    expect(bundle.savedViews).toHaveLength(1)
    expect(bundle.recentAudit.length).toBeGreaterThanOrEqual(3)
    expect(bundle.externalPaymentInitiated).toBe(false)
    expect(bundle.externalEgressAllowed).toBe(false)

    const centre = await service.getPeriodCloseCentre(a, {
      ...scope,
      asOfDate: '2026-08-31',
      reconciliations: [{ id: 'r1', status: 'open' }],
      journals: [],
      payRuns: [],
    })
    expect(centre.blockers.some((b) => b.code === 'unreconciled_bank')).toBe(true)
  })
})
