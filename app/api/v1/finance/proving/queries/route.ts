import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { ProvingFinanceGateway } from '@/lib/finance/proving/firestore-gateway'
import { ProvingFinanceValidationError } from '@/lib/finance/proving/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new ProvingFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/proving/queries',
    execute: async (resource, actor, _params, orgId) => {
      if (resource !== 'bundle') {
        throw new ProvingFinanceValidationError('Unsupported proving finance query resource')
      }
      return gateway.getBundle(actor, orgId)
    },
  })
})
