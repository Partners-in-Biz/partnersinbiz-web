import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorLabel } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { recordDesignAuditWaiver } from '@/lib/design-audit/audit-runs'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/**
 * POST /api/v1/design-audit/runs/[runId]/waivers
 * Records an "Ignore + reason" waiver on an org-scoped design audit run so
 * the finding stays visible but is explicitly waived (auditable record).
 * OrgId is resolved from auth + validated (body orgId must pass
 * canAccessOrg); X-Agent-Actor is forwarded into the waiver's createdBy.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const params = await (ctx as { params: Promise<{ runId: string }> }).params
    const runId = params.runId.trim()
    if (!runId) return apiError('runId is required', 400)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const rule = cleanString(body.rule, 120)
    const ref = cleanString(body.ref, 400)
    const reason = cleanString(body.reason, 2_000)
    if (!rule) return apiError('rule is required', 400)
    if (!ref) return apiError('ref is required', 400)
    if (!reason) return apiError('reason is required', 400)

    const run = await recordDesignAuditWaiver({
      orgId,
      runId,
      rule,
      ref,
      reason,
      createdBy: routeActorLabel(req.headers.get('x-agent-actor'), user),
    })
    if (!run) return apiError('Design audit run not found', 404)
    return apiSuccess({ run }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
