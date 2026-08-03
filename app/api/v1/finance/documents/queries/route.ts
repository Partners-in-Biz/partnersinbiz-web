import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreFinanceDocumentsGateway } from '@/lib/accounting/firestore-documents-gateway'
import { FinanceValidationError } from '@/lib/accounting/foundation'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'aging'] as const

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
        const role = params.get('role') === 'supplier' ? 'supplier' : 'customer'
        const asOfDate = params.get('asOfDate') || new Date().toISOString().slice(0, 10)
        const currency = params.get('currency') || 'ZAR'
        return gateway.buildAgingReport(actor, { ...scope, role, asOfDate, currency })
      }
      if (resource !== 'bundle') throw new FinanceValidationError('Unsupported documents query resource')
      const filters = {
        ...(params.get('status') ? { status: params.get('status') as string } : {}),
        ...(params.get('counterpartyCompanyId') ? { counterpartyCompanyId: params.get('counterpartyCompanyId')! } : {}),
        ...(params.get('fromDate') ? { fromDate: params.get('fromDate')! } : {}),
        ...(params.get('toDate') ? { toDate: params.get('toDate')! } : {}),
        ...(params.get('documentNumberContains') ? { documentNumberContains: params.get('documentNumberContains')! } : {}),
        ...(params.get('minOutstandingMinor') ? { minOutstandingMinor: Number(params.get('minOutstandingMinor')) } : {}),
        ...(params.get('maxOutstandingMinor') ? { maxOutstandingMinor: Number(params.get('maxOutstandingMinor')) } : {}),
      }
      return gateway.listBundle(actor, scope, filters)
    },
  })
})
