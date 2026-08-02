/**
 * POST /api/v1/crm/contacts/[id]/facts/[factId]/decide
 * Body: { decision: 'accept' | 'dismiss' }
 * Human accept applies the fact and marks the field human-owned.
 * Dismiss prevents re-proposal of the same field+value.
 *
 * Auth: member+
 */
import { NextRequest } from 'next/server'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { decideContactFact, loadAccessibleFactContact } from '@/lib/crm/facts'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string; factId: string }> }

export const POST = withCrmAuth<RouteCtx>('member', async (req: NextRequest, ctx, routeCtx) => {
  const { id: contactId, factId } = await routeCtx!.params
  if (!contactId || !factId) return apiError('Contact ID and fact ID are required', 400)

  const access = await loadAccessibleFactContact(ctx, contactId)
  if (!access.ok) return access.res

  const body = await req.json().catch(() => null)
  const decision = body && typeof body === 'object' ? (body as { decision?: unknown }).decision : null
  if (decision !== 'accept' && decision !== 'dismiss') {
    return apiError("decision must be 'accept' or 'dismiss'", 400)
  }

  const result = await decideContactFact(
    {
      orgId: ctx.orgId,
      contactId,
      factId,
      decision,
      decidedByRef: ctx.actor,
    },
    access.contact,
  )

  if (!result.ok) {
    if (result.reason === 'not_found') return apiError('Fact not found', 404)
    if (result.reason === 'superseded') return apiError('Fact was superseded', 409)
    return apiError(result.reason || 'Decision failed', 400)
  }

  await safeTouchCrmLiveUpdate(ctx.orgId, 'contacts', `contact.fact_${decision}`)
  return apiSuccess({ result, contactId, factId })
})
