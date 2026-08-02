import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreCutoverFinanceGateway } from '@/lib/finance/cutover/firestore-gateway'
import { CutoverFinanceValidationError } from '@/lib/finance/cutover/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreCutoverFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/cutover/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'bundle') {
        throw new CutoverFinanceValidationError('Unsupported cutover finance query resource')
      }
      const bookId = params.get('bookId') || undefined
      const packageId = params.get('packageId') || undefined
      return gateway.listForOrg(actor, orgId, { bookId, packageId })
    },
  })
})
