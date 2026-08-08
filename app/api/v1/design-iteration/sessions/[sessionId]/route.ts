import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorKind } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { getDesignIterationSession } from '@/lib/design-iteration/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/design-iteration/sessions/[sessionId]
 * Reads an org-scoped design-iteration session (variant deck) for canvas
 * preview and re-render. The caller's org is resolved from auth (X-Org-Id),
 * never from the path; X-Agent-Actor is read for the audit trail.
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const actorKind = routeActorKind(req.headers.get('x-agent-actor'))
    const params = await (ctx as { params: Promise<{ sessionId: string }> }).params
    const sessionId = params.sessionId.trim()
    const url = new URL(req.url)
    const requestedOrgId = url.searchParams.get('orgId') ?? user.activeOrgId ?? user.orgId ?? null
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    if (!sessionId) return apiError('sessionId is required', 400)
    const session = await getDesignIterationSession(scope.orgId, sessionId)
    if (!session) return apiError('Design iteration session not found', 404)
    return apiSuccess({ session, actor: actorKind ?? 'user' })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
