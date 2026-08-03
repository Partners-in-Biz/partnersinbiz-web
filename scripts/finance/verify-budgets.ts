/**
 * verify:finance:budgets — cashflow + named scenarios golden path.
 * development/staging only. No SARS submit. No external payment / bank movement.
 */
import assert from 'node:assert/strict'
import {
  BudgetsFinanceService,
  applyCashScenarioToMonths,
  buildCashflowMonths,
  compareCashScenarioMonths,
  createEmptyBudgetsStore,
} from '../../lib/finance/budgets/service'
import type { FinanceActorContext } from '../../lib/finance/types'

const actor: FinanceActorContext = {
  uid: 'u1',
  orgId: 'org_1',
  membershipRole: 'admin',
  membershipActive: true,
  financeModuleEnabled: true,
  assignments: [
    {
      id: 'a1',
      orgId: 'org_1',
      userId: 'u1',
      legalEntityId: 'le_1',
      scopeMode: 'entity',
      role: 'finance_admin',
      status: 'active',
    },
  ],
}

async function main() {
  const baseMonths = buildCashflowMonths({
    startPeriodKey: '2026-08',
    horizonMonths: 2,
    openingCashMinor: 50_000,
    budgetLines: [
      { id: '1', accountId: 'inc', accountCode: '4000', periodKey: '2026-08', amountMinor: 20_000 },
      { id: '2', accountId: 'exp', accountCode: '6000', periodKey: '2026-08', amountMinor: 5_000 },
      { id: '3', accountId: 'inc', accountCode: '4000', periodKey: '2026-09', amountMinor: 20_000 },
      { id: '4', accountId: 'exp', accountCode: '6000', periodKey: '2026-09', amountMinor: 5_000 },
    ],
    lineDirection: { inc: 'in', exp: 'out' },
  })
  const down = applyCashScenarioToMonths({
    baseMonths,
    openingCashMinor: 50_000,
    inflowBps: 9000,
    outflowBps: 11000,
  })
  assert.equal(down[0].budgetInflowsMinor, 18_000)
  assert.equal(down[0].budgetOutflowsMinor, 5_500)

  let store = createEmptyBudgetsStore()
  const svc = new BudgetsFinanceService(
    async () => store,
    async (_b, after) => {
      store = after
    },
    () => '2026-08-03T19:00:00.000Z',
  )

  await svc.upsertBudget(actor, {
    id: 'bud_v',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    name: 'FY26',
    fiscalYear: 2026,
    status: 'active',
    lines: [
      { id: 'l1', accountId: 'inc', accountCode: '4000', periodKey: '2026-08', amountMinor: 30_000 },
      { id: 'l2', accountId: 'exp', accountCode: '6000', periodKey: '2026-08', amountMinor: 10_000 },
      { id: 'l3', accountId: 'inc', accountCode: '4000', periodKey: '2026-09', amountMinor: 30_000 },
      { id: 'l4', accountId: 'exp', accountCode: '6000', periodKey: '2026-09', amountMinor: 10_000 },
    ],
    requestId: 'r1',
    idempotencyKey: 'k-b',
  })

  const base = await svc.upsertCashScenario(actor, {
    id: 'scn_base',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    budgetId: 'bud_v',
    name: 'Base',
    kind: 'base',
    openingCashMinor: 10_000,
    startPeriodKey: '2026-08',
    horizonMonths: 2,
    lineDirection: { inc: 'in', exp: 'out' },
    requestId: 'r2',
    idempotencyKey: 'k-base',
  })
  const downS = await svc.upsertCashScenario(actor, {
    id: 'scn_down',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    budgetId: 'bud_v',
    name: 'Downside',
    kind: 'downside',
    openingCashMinor: 10_000,
    startPeriodKey: '2026-08',
    horizonMonths: 2,
    inflowBps: 7000,
    outflowBps: 13000,
    lineDirection: { inc: 'in', exp: 'out' },
    requestId: 'r3',
    idempotencyKey: 'k-down',
  })
  const upS = await svc.upsertCashScenario(actor, {
    id: 'scn_up',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    budgetId: 'bud_v',
    name: 'Upside',
    kind: 'upside',
    openingCashMinor: 10_000,
    startPeriodKey: '2026-08',
    horizonMonths: 2,
    inflowBps: 13000,
    outflowBps: 8000,
    lineDirection: { inc: 'in', exp: 'out' },
    requestId: 'r4',
    idempotencyKey: 'k-up',
  })

  const cmp = compareCashScenarioMonths([base, downS, upS])
  assert.ok(cmp.rows[0].spreadClosingMinor > 0)

  const comparison = await svc.compareCashScenarios(actor, {
    id: 'cmp_v',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    name: 'Compare',
    scenarioIds: ['scn_base', 'scn_down', 'scn_up'],
    requestId: 'r5',
    idempotencyKey: 'k-cmp',
  })
  assert.equal(comparison.lowestEndingScenarioId, 'scn_down')
  assert.equal(comparison.highestEndingScenarioId, 'scn_up')
  assert.equal(comparison.bankMovementInitiated, false)
  assert.equal(comparison.permanentDashboard, false)

  const actuals = await svc.attachCashActuals(actor, {
    scenarioId: 'scn_base',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    actuals: {
      source: 'reconciled_cash_accounts',
      asOf: '2026-08-03T00:00:00.000Z',
      accountIds: ['cash_1'],
      totalCashMinor: 77_000,
      readOnly: true,
      bankMovementInitiated: false,
    },
    applyAsOpening: true,
    requestId: 'r6',
    idempotencyKey: 'k-act',
  })
  assert.equal(actuals.openingCashMinor, 77_000)
  assert.equal(actuals.actuals?.readOnly, true)
  assert.equal(actuals.bankMovementInitiated, false)

  const snap = await svc.snapshotCashScenarios(actor, {
    id: 'snap_v',
    orgId: 'org_1',
    legalEntityId: 'le_1',
    bookId: 'book_1',
    name: 'Snap',
    scenarioIds: ['scn_base', 'scn_down', 'scn_up'],
    includeComparison: true,
    requestId: 'r7',
    idempotencyKey: 'k-snap',
  })
  assert.equal(snap.scenarios.length, 3)
  assert.equal(snap.temporaryAnalysis, true)
  assert.equal(snap.permanentDashboard, false)
  assert.equal(snap.externalPaymentInitiated, false)
  assert.equal(snap.sarsSubmissionInitiated, false)
  assert.equal(snap.externalEgressAllowed, false)
  assert.equal(snap.bankMovementInitiated, false)

  const bundle = await svc.getBundle(actor, 'org_1', 'le_1', 'book_1')
  assert.equal(bundle.analysisMode.temporaryAnalysis, true)
  assert.equal(bundle.analysisMode.permanentDashboard, false)
  assert.ok(bundle.cashScenarios.length >= 3)

  console.log(
    JSON.stringify({
      ok: true,
      scenarios: bundle.cashScenarios.length,
      spread: comparison.rows[comparison.rows.length - 1].spreadClosingMinor,
      actualsOpening: actuals.openingCashMinor,
      snapshotFrozen: snap.scenarios.length,
      hardGates: {
        externalPaymentInitiated: snap.externalPaymentInitiated,
        sarsSubmissionInitiated: snap.sarsSubmissionInitiated,
        externalEgressAllowed: snap.externalEgressAllowed,
        bankMovementInitiated: snap.bankMovementInitiated,
        permanentDashboard: snap.permanentDashboard,
        temporaryAnalysis: snap.temporaryAnalysis,
      },
    }),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
