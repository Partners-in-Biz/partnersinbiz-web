import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreMultiCurrencyFinanceGateway } from '@/lib/finance/multi-currency/firestore-gateway'
import { MultiCurrencyFinanceValidationError } from '@/lib/finance/multi-currency/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreMultiCurrencyFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/multi-currency/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') {
        throw new MultiCurrencyFinanceValidationError('Unsupported multi-currency finance query resource')
      }
      const bookId = params.get('bookId') || undefined
      const rateSetId = params.get('rateSetId') || undefined
      return gateway.listForOrg(actor, orgId, { bookId, rateSetId })
    },
  })
})
