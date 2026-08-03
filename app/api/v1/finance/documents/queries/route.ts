import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceDocumentsGateway } from '@/lib/accounting/firestore-documents-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

/** Bundle only until AR/AP depth Firestore adapter exposes aging + filtered list. */
const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreFinanceDocumentsGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/documents/queries',
    execute: async (resource, actor, params, orgId) => {
      const legalEntityId = params.get('legalEntityId')
      const bookId = params.get('bookId')
      if (!legalEntityId || !bookId) throw new FinanceValidationError('legalEntityId and bookId are required')
      const scope = { orgId, legalEntityId, bookId }
      if (resource === 'aging') {
        throw new FinanceValidationError(
          'Documents aging query is not available until the AR/AP depth Firestore adapter is wired',
        )
      }
      if (resource !== 'bundle') throw new FinanceValidationError('Unsupported documents query resource')
      return gateway.listBundle(actor, scope)
    },
  })
})
