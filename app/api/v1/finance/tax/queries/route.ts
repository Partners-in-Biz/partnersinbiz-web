import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceTaxGateway } from '@/lib/accounting/firestore-tax-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceTaxGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/tax/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      if (resource !== 'bundle') throw new FinanceValidationError('Unsupported tax query resource')
      return gateway.listBundle(actor, { orgId, legalEntityId, bookId })
    },
  })
})
