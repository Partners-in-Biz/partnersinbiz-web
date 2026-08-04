import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import {
  FirestoreExpenseClaimFinanceGateway,
  type AttachReceiptCommand,
  type BulkApproveCommand,
  type ClaimLifecycleCommand,
  type CreateExpenseClaimCommand,
  type ExportPaymentInstructionCommand,
  type OcrAssistCommand,
  type OcrResolveCommand,
  type PostClaimCommand,
  type UpdateExpenseClaimCommand,
} from '@/lib/finance/expense-claims/firestore-gateway'
import { runFinanceCommandHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const OPERATIONS = [
  'expense-claim.create',
  'expense-claim.update',
  'expense-claim.submit',
  'expense-claim.approve',
  'expense-claim.reject',
  'expense-claim.bulk-approve',
  'expense-claim.post',
  'expense-claim.receipt.attach',
  'expense-claim.ocr.assist',
  'expense-claim.ocr.confirm',
  'expense-claim.ocr.dismiss',
  'expense-claim.payment-instruction.export',
] as const

type Op = (typeof OPERATIONS)[number]

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreExpenseClaimFinanceGateway()
  return runFinanceCommandHandler(req, user, {
    operations: OPERATIONS,
    logLabel: 'finance/expense-claims/commands',
    execute: async (operation, actor, command) => {
      switch (operation as Op) {
        case 'expense-claim.create':
          return gateway.createClaim(actor, command as unknown as CreateExpenseClaimCommand)
        case 'expense-claim.update':
          return gateway.updateClaim(actor, command as unknown as UpdateExpenseClaimCommand)
        case 'expense-claim.submit':
          return gateway.submitClaim(actor, command as unknown as ClaimLifecycleCommand)
        case 'expense-claim.approve':
          return gateway.approveClaim(actor, command as unknown as ClaimLifecycleCommand)
        case 'expense-claim.reject':
          return gateway.rejectClaim(actor, command as unknown as ClaimLifecycleCommand)
        case 'expense-claim.bulk-approve':
          return gateway.bulkApprove(actor, command as unknown as BulkApproveCommand)
        case 'expense-claim.post':
          return gateway.postClaim(actor, command as unknown as PostClaimCommand)
        case 'expense-claim.receipt.attach':
          return gateway.attachReceipt(actor, command as unknown as AttachReceiptCommand)
        case 'expense-claim.ocr.assist':
          return gateway.runOcrAssist(actor, command as unknown as OcrAssistCommand)
        case 'expense-claim.ocr.confirm':
          return gateway.confirmOcr(actor, command as unknown as OcrResolveCommand)
        case 'expense-claim.ocr.dismiss':
          return gateway.dismissOcr(actor, command as unknown as OcrResolveCommand)
        case 'expense-claim.payment-instruction.export':
          return gateway.exportPaymentInstruction(actor, command as unknown as ExportPaymentInstructionCommand)
      }
    },
  })
})
