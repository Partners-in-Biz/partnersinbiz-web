import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestorePersonalFinanceGateway } from '@/lib/finance/personal/firestore-gateway'
import { PersonalFinanceValidationError } from '@/lib/finance/personal/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePersonalFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/personal/queries',
    execute: async (resource, actor, _params, orgId) => {
      if (resource !== 'bundle') {
        throw new PersonalFinanceValidationError('Unsupported personal finance query resource')
      }
      // Owner-private bundle only — never returns other members' books.
      return gateway.getOwnerBundle(actor, orgId)
    },
  })
})
