import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreOperatorDepthGateway } from '@/lib/finance/operator-depth/firestore-gateway'
import { OperatorDepthValidationError } from '@/lib/finance/operator-depth/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreOperatorDepthGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/operator-depth/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') throw new OperatorDepthValidationError('Unsupported operator-depth query resource')
      const legalEntityId = params.get('legalEntityId') || ''
      const bookId = params.get('bookId') || ''
      if (!legalEntityId || !bookId) throw new OperatorDepthValidationError('legalEntityId and bookId are required')
      return gateway.getBundle(actor, orgId, legalEntityId, bookId, params.get('resourceKind') || undefined)
    },
  })
})
