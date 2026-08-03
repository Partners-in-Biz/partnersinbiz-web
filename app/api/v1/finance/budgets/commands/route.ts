import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreBudgetsFinanceGateway,
  type AttachCashActualsCommand,
  type BuildCashflowPlanCommand,
  type CompareCashScenariosCommand,
  type SnapshotCashScenariosCommand,
  type UpsertBudgetCommand,
  type UpsertCashScenarioCommand,
  type UpsertForecastCommand,
} from '@/lib/finance/budgets/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'budget.upsert',
  'forecast.upsert',
  'cashflow.plan.build',
  'cashflow.scenario.upsert',
  'cashflow.actuals.attach',
  'cashflow.scenario.compare',
  'cashflow.scenario.snapshot',
] as const

type Op = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBudgetsFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/budgets/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'budget.upsert':
          return gateway.upsertBudget(actor, command as unknown as UpsertBudgetCommand)
        case 'forecast.upsert':
          return gateway.upsertForecast(actor, command as unknown as UpsertForecastCommand)
        case 'cashflow.plan.build':
          return gateway.buildCashflowPlan(actor, command as unknown as BuildCashflowPlanCommand)
        case 'cashflow.scenario.upsert':
          return gateway.upsertCashScenario(actor, command as unknown as UpsertCashScenarioCommand)
        case 'cashflow.actuals.attach':
          return gateway.attachCashActuals(actor, command as unknown as AttachCashActualsCommand)
        case 'cashflow.scenario.compare':
          return gateway.compareCashScenarios(actor, command as unknown as CompareCashScenariosCommand)
        case 'cashflow.scenario.snapshot':
          return gateway.snapshotCashScenarios(actor, command as unknown as SnapshotCashScenariosCommand)
      }
    },
  })
})
