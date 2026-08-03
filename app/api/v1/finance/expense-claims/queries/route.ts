import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreExpenseClaimFinanceGateway } from '@/lib/finance/expense-claims/firestore-gateway'
import { ExpenseClaimValidationError } from '@/lib/finance/expense-claims/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreExpenseClaimFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/expense-claims/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId') || ''
      const bookId = params.get('bookId') || ''
      if (!legalEntityId || !bookId) {
        throw new ExpenseClaimValidationError('legalEntityId and bookId are required')
      }

      if (resource === 'bundle') {
        const status = params.get('status') || undefined
        const filters = {
          status: status ? (status.includes(',') ? status.split(',') : status) : undefined,
          employeeId: params.get('employeeId') || undefined,
          payeeUserId: params.get('payeeUserId') || undefined,
          employeeLinkedUserId: params.get('employeeLinkedUserId') || undefined,
          vendorContains: params.get('vendorContains') || undefined,
          fromDate: params.get('fromDate') || undefined,
          toDate: params.get('toDate') || undefined,
          minGrossMinor: params.get('minGrossMinor') ? Number(params.get('minGrossMinor')) : undefined,
          maxGrossMinor: params.get('maxGrossMinor') ? Number(params.get('maxGrossMinor')) : undefined,
          hasReceipt:
            params.get('hasReceipt') === 'true' ? true : params.get('hasReceipt') === 'false' ? false : undefined,
        }
        return gateway.getBundle(actor, orgId, legalEntityId, bookId, filters as any)
      }

      throw new ExpenseClaimValidationError('Unsupported expense-claims query resource')
    },
  })
})
