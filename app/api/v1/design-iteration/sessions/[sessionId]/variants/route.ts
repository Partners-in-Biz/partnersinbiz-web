import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorKind } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { addDesignIterationVariants } from '@/lib/design-iteration/store'
import { cleanDesignIterationVariant } from '@/lib/design-iteration/types'

export const dynamic = 'force-dynamic'

const MAX_VARIANTS_PER_CALL = 5

/**
 * POST /api/v1/design-iteration/sessions/[sessionId]/variants
 * Appends archetype-distinct variants to the deck (agent adds 1-3 after
 * generating them). Returns the refreshed session. OrgId is resolved from
 * auth + validated; X-Agent-Actor is read for the audit trail.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const params = await (ctx as { params: Promise<{ sessionId: string }> }).params
    const sessionId = params.sessionId.trim()
    if (!sessionId) return apiError('sessionId is required', 400)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId
    const actorKind = routeActorKind(req.headers.get('x-agent-actor'))

    if (!Array.isArray(body.variants) || body.variants.length === 0) {
      return apiError('variants must be a non-empty array', 400)
    }
    const nowMs = Date.now()
    const variants = body.variants
      .map((variant, index) => cleanDesignIterationVariant(variant, nowMs, index))
      .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
      .slice(0, MAX_VARIANTS_PER_CALL)
    if (variants.length === 0) return apiError('variants must contain valid archetype + description entries', 400)

    const session = await addDesignIterationVariants(orgId, sessionId, variants, { nowMs })
    if (!session) return apiError('Design iteration session not found', 404)
    return apiSuccess({ session, actor: actorKind ?? 'user' }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
