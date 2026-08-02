import type { FinanceActorContext } from '@/lib/finance/types'
import {
  BudgetsFinanceService,
  addMonths,
  buildCashflowMonths,
  createEmptyBudgetsStore,
  type BudgetsStore,
} from '@/lib/finance/budgets/service'

function actor(uid: string, orgId: string): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [
      { id: 'asg1', orgId, userId: uid, legalEntityId: 'le_1', scopeMode: 'entity', role: 'finance_admin', status: 'active' },
    ],
  }
}

function serviceWith(storeRef: { current: BudgetsStore }) {
  return new BudgetsFinanceService(
    async () => storeRef.current,
    async (_b, after) => {
      storeRef.current = after
    },
    () => '2026-08-02T18:00:00.000Z',
  )
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
})

describe('budgets lifecycle', () => {
  test('budget + forecast + cashflow plan keep hard gates false', async () => {
    const storeRef = { current: createEmptyBudgetsStore() }
    const svc = serviceWith(storeRef)
    const admin = actor('u1', 'org_pib')

    const budget = await svc.upsertBudget(admin, {
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
      ],
      requestId: 'r1',
      idempotencyKey: 'idem-b',
    })
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
