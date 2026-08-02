import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreJobCostingGateway,
  type ApplyTimeCostCommand,
} from '@/lib/accounting/firestore-job-costing-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = ['job_costing.time_cost.apply'] as const

type JobCostingOperation = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreJobCostingGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/job-costing/commands',
    execute: async (operation, actor, command) => {
      switch (operation as JobCostingOperation) {
        case 'job_costing.time_cost.apply':
          return gateway.applyTimeCost(actor, command as unknown as ApplyTimeCostCommand)
      }
    },
  })
})
