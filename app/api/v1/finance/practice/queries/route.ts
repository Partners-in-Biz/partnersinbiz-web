import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { FirestorePracticeFinanceGateway } from '@/lib/finance/practice/firestore-gateway'
import { PracticeFinanceValidationError } from '@/lib/finance/practice/service'
import { runFinanceQueryHandler } from '@/lib/finance/http-command'

export const dynamic = 'force-dynamic'

const RESOURCES = ['bundle', 'audit', 'matrix'] as const

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const gateway = new FirestorePracticeFinanceGateway()
  return runFinanceQueryHandler(req, user, {
    resources: RESOURCES,
    logLabel: 'finance/practice/queries',
    execute: async (resource, actor, params, orgId) => {
      if (resource === 'matrix') {
        const { buildFinanceRoleMatrix } = await import('@/lib/finance/practice/service')
        return { matrix: buildFinanceRoleMatrix() }
      }
      if (resource === 'audit') {
        return gateway.listAudit(actor, {
          orgId,
          legalEntityId: params.get('legalEntityId') || undefined,
          bookId: params.get('bookId') || undefined,
          actorId: params.get('actorId') || undefined,
          eventType: params.get('eventType') || undefined,
          from: params.get('from') || undefined,
          to: params.get('to') || undefined,
          limit: Number(params.get('limit') ?? '50') || 50,
        })
      }
      if (resource !== 'bundle') {
        throw new PracticeFinanceValidationError('Unsupported practice finance query resource')
      }
      return gateway.getBundle(actor, orgId, {
        legalEntityId: params.get('legalEntityId') || undefined,
        bookId: params.get('bookId') || undefined,
        actorId: params.get('actorId') || undefined,
        eventType: params.get('eventType') || undefined,
        from: params.get('from') || undefined,
        to: params.get('to') || undefined,
        limit: Number(params.get('limit') ?? '50') || 50,
      })
    },
  })
})
