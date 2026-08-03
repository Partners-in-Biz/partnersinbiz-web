import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceInventoryGateway } from '@/lib/accounting/firestore-inventory-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'stock-on-hand', 'item'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceInventoryGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/inventory/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      const scope = { orgId, legalEntityId, bookId }
      if (resource === 'bundle') return gateway.listBundle(actor, scope)
      if (resource === 'stock-on-hand') return gateway.stockOnHandReport(actor, scope)
      if (resource === 'item') {
        const itemId = params.get('itemId')
        if (!itemId) throw new FinanceValidationError('itemId is required')
        return gateway.getItem(actor, scope, itemId)
      }
      throw new FinanceValidationError('Unsupported inventory query resource')
    },
  })
})
