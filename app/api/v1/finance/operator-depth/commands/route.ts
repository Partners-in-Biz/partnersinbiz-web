import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreOperatorDepthGateway,
  type AllocationPlanCommand,
  type BulkSelectionCommand,
  type DeleteSavedViewCommand,
  type PeriodCloseQuery,
  type UpsertSavedViewCommand,
} from '@/lib/finance/operator-depth/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'operator-view.upsert',
  'operator-view.delete',
  'operator-bulk.plan-selection',
  'operator-allocate.plan',
  'period-close.evaluate',
] as const

type Op = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreOperatorDepthGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/operator-depth/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'operator-view.upsert':
          return gateway.upsertSavedView(actor, command as unknown as UpsertSavedViewCommand)
        case 'operator-view.delete':
          return gateway.deleteSavedView(actor, command as unknown as DeleteSavedViewCommand)
        case 'operator-bulk.plan-selection':
          return gateway.planBulkSelection(actor, command as unknown as BulkSelectionCommand)
        case 'operator-allocate.plan':
          return gateway.planAllocation(actor, command as unknown as AllocationPlanCommand)
        case 'period-close.evaluate':
          return gateway.getPeriodCloseCentre(actor, command as unknown as PeriodCloseQuery)
      }
    },
  })
})
