import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceReportingGateway } from '@/lib/accounting/firestore-reporting-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['trial-balance', 'income-statement', 'balance-sheet'] as const

function required(params: URLSearchParams, key: string): string {
  const value = params.get(key)
  if (!value) throw new FinanceValidationError(`${key} is required`)
  return value
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceReportingGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/reports/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = required(params, 'legalEntityId')
      const bookId = required(params, 'bookId')
      const accountingBasis = (params.get('accountingBasis') || 'accrual') as 'cash' | 'accrual'
      if (accountingBasis !== 'cash' && accountingBasis !== 'accrual') {
        throw new FinanceValidationError('accountingBasis must be cash or accrual')
      }
      switch (resource) {
        case 'trial-balance':
          return gateway.trialBalance(actor, {
            orgId,
            legalEntityId,
            bookId,
            asOfDate: required(params, 'asOfDate'),
            accountingBasis,
            periodId: params.get('periodId') ?? undefined,
          })
        case 'income-statement':
          return gateway.incomeStatement(actor, {
            orgId,
            legalEntityId,
            bookId,
            fromDate: required(params, 'fromDate'),
            toDate: required(params, 'toDate'),
            accountingBasis,
          })
        case 'balance-sheet':
          return gateway.balanceSheet(actor, {
            orgId,
            legalEntityId,
            bookId,
            asOfDate: required(params, 'asOfDate'),
            accountingBasis,
            retainedEarningsAccountId: params.get('retainedEarningsAccountId') ?? undefined,
          })
        default:
          throw new FinanceValidationError('Unsupported finance report resource')
      }
    },
  })
})
