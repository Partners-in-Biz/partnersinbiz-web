import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceRevenueRecognitionGateway } from '@/lib/accounting/firestore-revenue-recognition-gateway'
import type {
  ActivateRevenueScheduleCommand,
  CalculateRecognitionRunCommand,
  CancelRevenueScheduleCommand,
  CreateRecognitionRunCommand,
  CreateRevenueScheduleCommand,
  PostRecognitionRunCommand,
  ReverseRecognitionRunCommand,
} from '@/lib/accounting/revenue-recognition-service'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'schedule.create',
  'schedule.activate',
  'schedule.cancel',
  'recognition-run.create',
  'recognition-run.calculate',
  'recognition-run.post',
  'recognition-run.reverse',
] as const

type Op = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceRevenueRecognitionGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/revenue-recognition/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'schedule.create':
          return gateway.createSchedule(actor, command as unknown as CreateRevenueScheduleCommand)
        case 'schedule.activate':
          return gateway.activateSchedule(actor, command as unknown as ActivateRevenueScheduleCommand)
        case 'schedule.cancel':
          return gateway.cancelSchedule(actor, command as unknown as CancelRevenueScheduleCommand)
        case 'recognition-run.create':
          return gateway.createRecognitionRun(actor, command as unknown as CreateRecognitionRunCommand)
        case 'recognition-run.calculate':
          return gateway.calculateRecognitionRun(actor, command as unknown as CalculateRecognitionRunCommand)
        case 'recognition-run.post':
          return gateway.postRecognitionRun(actor, command as unknown as PostRecognitionRunCommand)
        case 'recognition-run.reverse':
          return gateway.reverseRecognitionRun(actor, command as unknown as ReverseRecognitionRunCommand)
      }
    },
  })
})
