import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreMultiCurrencyFinanceGateway,
  type AddRateCommand,
  type ApproveRateSetCommand,
  type ApproveRevaluationCommand,
  type BuildFunctionalReportCommand,
  type ConfigureFxPolicyCommand,
  type CreateRateSetCommand,
  type CreateRevaluationCommand,
  type RecordFxDocumentCommand,
  type RecordFxSettlementCommand,
} from '@/lib/finance/multi-currency/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'fx.policy.configure',
  'fx.rate_set.create',
  'fx.rate_set.add_rate',
  'fx.rate_set.approve',
  'fx.document.record',
  'fx.settlement.record',
  'fx.revaluation.create',
  'fx.revaluation.approve',
  'fx.report.generate',
] as const

type FxOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreMultiCurrencyFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/multi-currency/commands',
    execute: async (operation, actor, command) => {
      switch (operation as FxOperation) {
        case 'fx.policy.configure':
          return gateway.configurePolicy(actor, command as unknown as ConfigureFxPolicyCommand)
        case 'fx.rate_set.create':
          return gateway.createRateSet(actor, command as unknown as CreateRateSetCommand)
        case 'fx.rate_set.add_rate':
          return gateway.addRate(actor, command as unknown as AddRateCommand)
        case 'fx.rate_set.approve':
          return gateway.approveRateSet(actor, command as unknown as ApproveRateSetCommand)
        case 'fx.document.record':
          return gateway.recordDocument(actor, command as unknown as RecordFxDocumentCommand)
        case 'fx.settlement.record':
          return gateway.recordSettlement(actor, command as unknown as RecordFxSettlementCommand)
        case 'fx.revaluation.create':
          return gateway.createRevaluation(actor, command as unknown as CreateRevaluationCommand)
        case 'fx.revaluation.approve':
          return gateway.approveRevaluation(actor, command as unknown as ApproveRevaluationCommand)
        case 'fx.report.generate':
          return gateway.buildFunctionalReport(actor, command as unknown as BuildFunctionalReportCommand)
      }
    },
  })
})
