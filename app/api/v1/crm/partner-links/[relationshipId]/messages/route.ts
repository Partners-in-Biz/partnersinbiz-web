import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { listPartnerMessages, postPartnerMessage } from '@/lib/partner-links/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ relationshipId: string }> }

/** Conversation on the relationship itself, separate from per-record comments. */
export const GET = withCrmAuth<RouteContext>('viewer', async (_req, ctx, routeCtx) => {
  try {
    const { relationshipId } = await routeCtx!.params
    return apiSuccess(await listPartnerMessages({ relationshipId, orgId: ctx.orgId }))
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { relationshipId } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const text = typeof body.body === 'string' ? body.body : ''
    if (!text.trim()) return apiError('body is required', 400)

    const message = await postPartnerMessage({
      relationshipId,
      orgId: ctx.orgId,
      body: text,
      actor: ctx.actor,
    })
    return apiSuccess({ message }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
