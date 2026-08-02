import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreBudgetsFinanceGateway } from '@/lib/finance/budgets/firestore-gateway'
import { BudgetsValidationError } from '@/lib/finance/budgets/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreBudgetsFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/budgets/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') throw new BudgetsValidationError('Unsupported budgets query resource')
      const legalEntityId = params.get('legalEntityId') || ''
      const bookId = params.get('bookId') || ''
      if (!legalEntityId || !bookId) throw new BudgetsValidationError('legalEntityId and bookId are required')
      return gateway.getBundle(actor, orgId, legalEntityId, bookId)
    },
  })
})
