import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { routeActorLabel } from '@/lib/api/route-actor'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { resolveRouteOrgId } from '@/lib/api/org-scope-route'
import { decideDesignIterationVariant } from '@/lib/design-iteration/store'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

/**
 * POST /api/v1/design-iteration/sessions/[sessionId]/variants/[variantId]/decision
 * Accepts or rejects a single variant. Called by the agent after the user
 * taps Accept/Reject on the card (the card action dispatches to the agent
 * run; the agent records the decision here and, on Accept, performs the repo
 * write — development branch, approved repo only — runs the T1 detector, and
 * reports the diff via the apply route). OrgId is resolved from auth +
 * validated; X-Agent-Actor is forwarded into the variant's decidedBy.
 */
export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx?: unknown) => {
  try {
    const params = await (ctx as { params: Promise<{ sessionId: string; variantId: string }> }).params
    const sessionId = params.sessionId.trim()
    const variantId = params.variantId.trim()
    if (!sessionId || !variantId) return apiError('sessionId and variantId are required', 400)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim()
      ? body.orgId.trim()
      : (user.activeOrgId ?? user.orgId ?? null)
    const scope = resolveRouteOrgId(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const decision = body.decision === 'reject' ? 'reject' : body.decision === 'accept' ? 'accept' : null
    if (!decision) return apiError('decision must be "accept" or "reject"', 400)

    const decisionNote = body.decisionNote !== undefined ? cleanString(body.decisionNote, 2_000) : null
    if (body.decisionNote !== undefined && !decisionNote) return apiError('decisionNote must be a non-empty string', 400)

    const result = await decideDesignIterationVariant({
      orgId,
      sessionId,
      variantId,
      decision,
      ...(decisionNote ? { decisionNote } : {}),
      decidedBy: routeActorLabel(req.headers.get('x-agent-actor'), user),
    })
    if (!result.session) return apiError('Design iteration session not found', 404)
    if (!result.variant) return apiError('Design iteration variant not found', 404)
    return apiSuccess({ session: result.session, variant: result.variant }, 200)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
