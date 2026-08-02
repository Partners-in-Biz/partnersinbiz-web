import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreBudgetsFinanceGateway,
  type BuildCashflowPlanCommand,
  type UpsertBudgetCommand,
  type UpsertForecastCommand,
} from '@/lib/finance/budgets/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'budget.upsert',
  'forecast.upsert',
  'cashflow.plan.build',
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
      }
    },
  })
})
