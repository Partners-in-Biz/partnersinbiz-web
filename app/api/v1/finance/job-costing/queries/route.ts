import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreJobCostingGateway } from '@/lib/accounting/firestore-job-costing-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'
import type { AccountingBasis } from '@/lib/finance/types'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'project-pnl', 'project-wip', 'closed-loop'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreJobCostingGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/job-costing/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource === 'bundle') {
        return {
          applications: await gateway.listApplications(actor, orgId, {
            bookId: params.get('bookId') || undefined,
            projectId: params.get('projectId') || undefined,
            applicationId: params.get('applicationId') || undefined,
          }),
          externalEgressAllowed: false,
          externalPaymentInitiated: false,
          sarsSubmissionInitiated: false,
        }
      }

      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      const projectId = params.get('projectId')
      if (!legalEntityId || !bookId || !projectId) {
        throw new FinanceValidationError('legalEntityId, bookId, and projectId are required')
      }
      const basis = (params.get('accountingBasis') || 'accrual') as AccountingBasis
      if (basis !== 'cash' && basis !== 'accrual') {
        throw new FinanceValidationError('accountingBasis must be cash|accrual')
      }

      if (resource === 'project-pnl') {
        const fromDate = params.get('fromDate')
        const toDate = params.get('toDate')
        if (!fromDate || !toDate) throw new FinanceValidationError('fromDate and toDate are required')
        return gateway.projectProfitAndLoss(actor, {
          orgId,
          legalEntityId,
          bookId,
          projectId,
          fromDate,
          toDate,
          accountingBasis: basis,
        })
      }

      if (resource === 'project-wip') {
        const asOfDate = params.get('asOfDate')
        if (!asOfDate) throw new FinanceValidationError('asOfDate is required')
        return gateway.projectWip(actor, {
          orgId,
          legalEntityId,
          bookId,
          projectId,
          asOfDate,
          accountingBasis: basis,
          fromDate: params.get('fromDate') || undefined,
        })
      }

      if (resource === 'closed-loop') {
        const asOfDate = params.get('asOfDate')
        if (!asOfDate) throw new FinanceValidationError('asOfDate is required')
        return gateway.closedLoop(actor, {
          orgId,
          legalEntityId,
          bookId,
          projectId,
          asOfDate,
          accountingBasis: basis,
          fromDate: params.get('fromDate') || undefined,
          quoteId: params.get('quoteId') || undefined,
        })
      }

      throw new FinanceValidationError('Unsupported job-costing query resource')
    },
  })
})
