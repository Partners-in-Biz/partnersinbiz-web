import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { listChannelAccounts, listQueues, listRoutingRules } from '@/lib/communications/store'
import { communicationProviders } from '@/lib/communications/providers'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const [accounts, queues, routingRules] = await Promise.all([
    listChannelAccounts(scope.orgId),
    listQueues(scope.orgId),
    listRoutingRules(scope.orgId),
  ])
  return apiSuccess({
    accounts: accounts.items,
    queues: queues.items,
    routingRules: routingRules.items,
    providers: communicationProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      supports: provider.supports,
      readiness: provider.getReadiness(),
    })),
  })
})
