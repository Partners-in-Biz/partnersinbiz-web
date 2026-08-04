import type { FinanceActorContext } from '@/lib/finance/types'
import {
  BudgetsFinanceService,
  addMonths,
  applyCashScenarioToMonths,
  buildCashflowMonths,
  compareCashScenarioMonths,
  createEmptyBudgetsStore,
  type BudgetsStore,
} from '@/lib/finance/budgets/service'

function actor(uid: string, orgId: string, role: 'finance_admin' | 'bookkeeper' = 'finance_admin'): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: role === 'finance_admin' ? 'admin' : 'member',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      { id: 'asg1', orgId, userId: uid, legalEntityId: 'le_1', scopeMode: 'entity', role, status: 'active' },
    ],
  }
}

function serviceWith(storeRef: { current: BudgetsStore }) {
  return new BudgetsFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-03T18:00:00.000Z',
  )
}

async function seedBudget(svc: BudgetsFinanceService, admin: FinanceActorContext) {
  return svc.upsertBudget(admin, {
    id: 'bud1',
    orgId: 'org_pib',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    name: 'FY26',
    fiscalYear: 2026,
    status: 'active',
    lines: [
      { id: 'l1', accountId: 'inc', accountCode: '4000', periodKey: '2026-08', amountMinor: 40_000 },
      { id: 'l2', accountId: 'exp', accountCode: '6000', periodKey: '2026-08', amountMinor: 10_000 },
      { id: 'l3', accountId: 'inc', accountCode: '4000', periodKey: '2026-09', amountMinor: 40_000 },
      { id: 'l4', accountId: 'exp', accountCode: '6000', periodKey: '2026-09', amountMinor: 10_000 },
    ],
    requestId: 'r1',
    idempotencyKey: 'idem-b',
  })
}

describe('cashflow math', () => {
  test('addMonths rolls year', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
  })

  test('buildCashflowMonths applies forecast bps and AR/AP', () => {
    const months = buildCashflowMonths({
      startPeriodKey: '2026-08',
      horizonMonths: 2,
      openingCashMinor: 100_000,
      budgetLines: [
        { id: '1', accountId: 'inc', accountCode: '4000', periodKey: '2026-08', amountMinor: 50_000 },
        { id: '2', accountId: 'exp', accountCode: '6000', periodKey: '2026-08', amountMinor: 20_000 },
        { id: '3', accountId: 'inc', accountCode: '4000', periodKey: '2026-09', amountMinor: 50_000 },
        { id: '4', accountId: 'exp', accountCode: '6000', periodKey: '2026-09', amountMinor: 20_000 },
      ],
      lineDirection: { inc: 'in', exp: 'out' },
      revenueBps: 10000,
      expenseBps: 10000,
      arByPeriod: { '2026-08': 5_000 },
      apByPeriod: { '2026-08': 2_000 },
    })
    expect(months).toHaveLength(2)
    expect(months[0].inflowsMinor).toBe(55_000)
    expect(months[0].outflowsMinor).toBe(22_000)
    expect(months[0].closingCashMinor).toBe(100_000 + 55_000 - 22_000)
    expect(months[0].netMinor).toBe(33_000)
  })

  test('applyCashScenarioToMonths scales and adds period deltas', () => {
    const base = buildCashflowMonths({
      startPeriodKey: '2026-08',
      horizonMonths: 1,
      openingCashMinor: 0,
      budgetLines: [
        { id: '1', accountId: 'inc', accountCode: '4000', periodKey: '2026-08', amountMinor: 100_000 },
        { id: '2', accountId: 'exp', accountCode: '6000', periodKey: '2026-08', amountMinor: 40_000 },
      ],
      lineDirection: { inc: 'in', exp: 'out' },
    })
    const down = applyCashScenarioToMonths({
      baseMonths: base,
      openingCashMinor: 0,
      inflowBps: 8000,
      outflowBps: 11000,
      adjustments: [{ periodKey: '2026-08', inflowDeltaMinor: -5_000 }],
    })
    // budget in 80k, out 44k, delta -5k in => inflows 75k, outflows 44k
    expect(down[0].budgetInflowsMinor).toBe(80_000)
    expect(down[0].budgetOutflowsMinor).toBe(44_000)
    expect(down[0].inflowsMinor).toBe(75_000)
    expect(down[0].outflowsMinor).toBe(44_000)
    expect(down[0].closingCashMinor).toBe(31_000)
  })
})

describe('budgets lifecycle', () => {
  test('budget + forecast + cashflow plan keep hard gates false', async () => {
    const storeRef = { current: createEmptyBudgetsStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const budget = await seedBudget(svc, admin)
    expect(budget.externalPaymentInitiated).toBe(false)
    expect(budget.sarsSubmissionInitiated).toBe(false)

    const fc = await svc.upsertForecast(admin, {
      id: 'fc1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Conservative',
      revenueBps: 9000,
      expenseBps: 10000,
      requestId: 'r2',
      idempotencyKey: 'idem-f',
    })
    expect(fc.externalPaymentInitiated).toBe(false)

    const plan = await svc.buildCashflowPlan(admin, {
      id: 'cfp1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      forecastId: 'fc1',
      name: 'Plan',
      openingCashMinor: 0,
      startPeriodKey: '2026-08',
      horizonMonths: 1,
      lineDirection: { inc: 'in', exp: 'out' },
      requestId: 'r3',
      idempotencyKey: 'idem-c',
    })
    expect(plan.status).toBe('ready')
    expect(plan.months[0].inflowsMinor).toBe(36_000)
    expect(plan.months[0].outflowsMinor).toBe(10_000)
    expect(plan.externalPaymentInitiated).toBe(false)
    expect(plan.sarsSubmissionInitiated).toBe(false)
    expect(plan.externalEgressAllowed).toBe(false)
  })
})

describe('cash forecast scenarios', () => {
  test('named base/downside/upside compare + snapshot + actuals stay planning-only', async () => {
    const storeRef = { current: createEmptyBudgetsStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    const bookkeeper = actor('u2', 'org_pib', 'bookkeeper')
    await seedBudget(svc, admin)

    const base = await svc.upsertCashScenario(admin, {
      id: 'scn_base',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Base',
      kind: 'base',
      openingCashMinor: 100_000,
      startPeriodKey: '2026-08',
      horizonMonths: 2,
      inflowBps: 10000,
      outflowBps: 10000,
      lineDirection: { inc: 'in', exp: 'out' },
      requestId: 's1',
      idempotencyKey: 'idem-scn-base',
    })
    const down = await svc.upsertCashScenario(admin, {
      id: 'scn_down',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Downside',
      kind: 'downside',
      openingCashMinor: 100_000,
      startPeriodKey: '2026-08',
      horizonMonths: 2,
      inflowBps: 8000,
      outflowBps: 12000,
      adjustments: [{ periodKey: '2026-08', inflowDeltaMinor: -2_000 }],
      lineDirection: { inc: 'in', exp: 'out' },
      requestId: 's2',
      idempotencyKey: 'idem-scn-down',
    })
    const up = await svc.upsertCashScenario(admin, {
      id: 'scn_up',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Upside',
      kind: 'upside',
      openingCashMinor: 100_000,
      startPeriodKey: '2026-08',
      horizonMonths: 2,
      inflowBps: 12000,
      outflowBps: 9000,
      adjustments: [{ periodKey: '2026-08', inflowDeltaMinor: 3_000 }],
      lineDirection: { inc: 'in', exp: 'out' },
      requestId: 's3',
      idempotencyKey: 'idem-scn-up',
    })

    expect(base.temporaryAnalysis).toBe(true)
    expect(base.permanentDashboard).toBe(false)
    expect(base.bankMovementInitiated).toBe(false)
    expect(base.externalPaymentInitiated).toBe(false)
    expect(down.months[0].inflowsMinor).toBeLessThan(base.months[0].inflowsMinor)
    expect(up.months[0].inflowsMinor).toBeGreaterThan(base.months[0].inflowsMinor)

    const pure = compareCashScenarioMonths([base, down, up])
    expect(pure.rows).toHaveLength(2)
    expect(pure.rows[0].spreadClosingMinor).toBeGreaterThan(0)

    const comparison = await svc.compareCashScenarios(admin, {
      id: 'cmp1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      name: 'Trio',
      scenarioIds: ['scn_base', 'scn_down', 'scn_up'],
      requestId: 'c1',
      idempotencyKey: 'idem-cmp',
    })
    expect(comparison.temporaryAnalysis).toBe(true)
    expect(comparison.permanentDashboard).toBe(false)
    expect(comparison.bankMovementInitiated).toBe(false)
    expect(comparison.lowestEndingScenarioId).toBe('scn_down')
    expect(comparison.highestEndingScenarioId).toBe('scn_up')

    const withActuals = await svc.attachCashActuals(bookkeeper, {
      scenarioId: 'scn_base',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      actuals: {
        source: 'reconciled_cash_accounts',
        asOf: '2026-08-03T12:00:00.000Z',
        accountIds: ['cash_cheque', 'cash_savings'],
        totalCashMinor: 150_000,
        readOnly: true,
        bankMovementInitiated: false,
      },
      applyAsOpening: true,
      requestId: 'a1',
      idempotencyKey: 'idem-act',
    })
    expect(withActuals.openingCashMinor).toBe(150_000)
    expect(withActuals.actuals?.readOnly).toBe(true)
    expect(withActuals.actuals?.bankMovementInitiated).toBe(false)
    expect(withActuals.bankMovementInitiated).toBe(false)
    expect(withActuals.months[0].openingCashMinor).toBe(150_000)

    const snap = await svc.snapshotCashScenarios(admin, {
      id: 'snap1',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      name: 'Board pack snapshot',
      scenarioIds: ['scn_base', 'scn_down', 'scn_up'],
      includeComparison: true,
      requestId: 'snap-r',
      idempotencyKey: 'idem-snap',
    })
    expect(snap.scenarios).toHaveLength(3)
    expect(snap.comparison?.rows.length).toBe(2)
    expect(snap.temporaryAnalysis).toBe(true)
    expect(snap.permanentDashboard).toBe(false)
    expect(snap.bankMovementInitiated).toBe(false)
    expect(snap.externalPaymentInitiated).toBe(false)
    expect(snap.externalEgressAllowed).toBe(false)
    expect(snap.sarsSubmissionInitiated).toBe(false)

    // mutating live scenario after snapshot must not rewrite frozen copy
    await svc.upsertCashScenario(admin, {
      id: 'scn_base',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Base mutated',
      kind: 'base',
      openingCashMinor: 1,
      startPeriodKey: '2026-08',
      horizonMonths: 2,
      inflowBps: 10000,
      outflowBps: 10000,
      lineDirection: { inc: 'in', exp: 'out' },
      expectedVersion: withActuals.version,
      requestId: 's1b',
      idempotencyKey: 'idem-scn-base-2',
    })
    const frozen = storeRef.current.cashSnapshots.get('snap1')!
    expect(frozen.scenarios.find((s) => s.id === 'scn_base')?.name).toBe('Base')
    expect(frozen.scenarios.find((s) => s.id === 'scn_base')?.openingCashMinor).toBe(150_000)

    const bundle = await svc.getBundle(admin, 'org_pib', 'le_1', 'book_1')
    expect(bundle.cashScenarios.length).toBe(3)
    expect(bundle.cashComparisons.length).toBe(1)
    expect(bundle.cashSnapshots.length).toBe(1)
    expect(bundle.analysisMode).toEqual({ temporaryAnalysis: true, permanentDashboard: false })
  })

  test('cross-tenant scenario load is not found', async () => {
    const storeRef = { current: createEmptyBudgetsStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')
    await seedBudget(svc, admin)
    await svc.upsertCashScenario(admin, {
      id: 'scn_base',
      orgId: 'org_pib',
      legalEntityId: 'le_1',
      bookId: 'book_1',
      budgetId: 'bud1',
      name: 'Base',
      kind: 'base',
      openingCashMinor: 0,
      startPeriodKey: '2026-08',
      horizonMonths: 1,
      lineDirection: { inc: 'in', exp: 'out' },
      requestId: 'x1',
      idempotencyKey: 'idem-x',
    })
    const other = actor('u9', 'org_other')
    await expect(
      svc.compareCashScenarios(other, {
        id: 'cmpx',
        orgId: 'org_other',
        legalEntityId: 'le_1',
        bookId: 'book_1',
        name: 'x',
        scenarioIds: ['scn_base', 'scn_base'],
        requestId: 'rx',
        idempotencyKey: 'idem-ox',
      }),
    ).rejects.toThrow(/not found/i)
  })
})
