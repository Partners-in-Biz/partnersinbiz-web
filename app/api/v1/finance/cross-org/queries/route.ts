import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestoreCrossOrgFinanceGateway } from '@/lib/finance/cross-org/firestore-gateway'
import { CrossOrgFinanceValidationError } from '@/lib/finance/cross-org/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['notices'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestoreCrossOrgFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/cross-org/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource !== 'notices') {
        throw new CrossOrgFinanceValidationError('Unsupported cross-org finance query resource')
      }
      const viewRaw = params.get('view') || 'all'
      const view = viewRaw === 'inbox' || viewRaw === 'sent' || viewRaw === 'all' ? viewRaw : null
      if (!view) throw new CrossOrgFinanceValidationError('view must be inbox, sent, or all')
      return gateway.listForOrg(actor, orgId, view)
    },
  })
})
