import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorKind } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { getDesignAuditRun } from '@/lib/design-audit/audit-runs'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/design-audit/runs/[runId]
 * Reads an org-scoped audit run (for canvas preview + re-render). OrgId is
 * resolved from auth + validated; X-Agent-Actor is read for the audit trail.
 */
export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const actorKind = routeActorKind(req.headers.get('x-agent-actor'))
    const params = await (ctx as { params: Promise<{ runId: string }> }).params
    const runId = params.runId.trim()
    const url = new URL(req.url)
    const requestedOrgId = url.searchParams.get('orgId') ?? user.activeOrgId ?? user.orgId ?? null
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    if (!runId) return apiError('runId is required', 400)
    const run = await getDesignAuditRun(scope.orgId, runId)
    if (!run) return apiError('Design audit run not found', 404)
    return apiSuccess({ run, actor: actorKind ?? 'user' })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
