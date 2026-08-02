import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreCrossOrgFinanceGateway,
  type NotifyCrossOrgPaymentCommand,
  type ResolveCrossOrgPaymentCommand,
} from '@/lib/finance/cross-org/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'cross_org.payment.notify',
  'cross_org.payment.confirm',
  'cross_org.payment.dispute',
  'cross_org.payment.dismiss',
] as const

type CrossOrgOperation = typeof OPERATIONS[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreCrossOrgFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/cross-org/commands',
    execute: async (operation, actor, command) => {
      switch (operation as CrossOrgOperation) {
        case 'cross_org.payment.notify':
          return gateway.notifyPayment(actor, command as unknown as NotifyCrossOrgPaymentCommand)
        case 'cross_org.payment.confirm':
          return gateway.confirmPayment(actor, command as unknown as ResolveCrossOrgPaymentCommand)
        case 'cross_org.payment.dispute':
          return gateway.disputePayment(actor, command as unknown as ResolveCrossOrgPaymentCommand)
        case 'cross_org.payment.dismiss':
          return gateway.dismissPayment(actor, command as unknown as ResolveCrossOrgPaymentCommand)
      }
    },
  })
})
