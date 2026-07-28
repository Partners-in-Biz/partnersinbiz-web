/**
 * GET /api/v1/orgs/[orgId]/people
 *
 * Auth: admin or client
 * Returns users the caller may start or add to a conversation.
 *
 * Prefer this path over /contacts — privacy filters often block URLs that
 * contain the word "contacts".
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listConversationPeople } from '@/lib/orgs/conversation-people'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const result = await listConversationPeople(scope.orgId, user)
    if (!result.ok) return apiError(result.error, result.status)
    return apiSuccess(result.people)
  },
)
