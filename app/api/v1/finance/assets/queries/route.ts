import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceAssetsGateway } from '@/lib/accounting/firestore-assets-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'register', 'depreciation-run'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceAssetsGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/assets/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      const scope = { orgId, legalEntityId, bookId }
      if (resource === 'bundle') return gateway.listBundle(actor, scope)
      if (resource === 'register') {
        const asOfDate = params.get('asOfDate') || new Date().toISOString().slice(0, 10)
        return gateway.registerReport(actor, scope, asOfDate)
      }
      if (resource === 'depreciation-run') {
        const runId = params.get('runId')
        if (!runId) throw new FinanceValidationError('runId is required')
        return gateway.depreciationRunReport(actor, scope, runId)
      }
      throw new FinanceValidationError('Unsupported assets query resource')
    },
  })
})
