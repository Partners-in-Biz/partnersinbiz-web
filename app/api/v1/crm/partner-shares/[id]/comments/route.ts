import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { addShareComment, listShareComments } from '@/lib/partner-links/shares'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Conversation on a shared record. Readable by both sides of the share. */
export const GET = withCrmAuth<RouteContext>('viewer', async (_req, ctx, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const result = await listShareComments({ shareId: id, viewerOrgId: ctx.orgId })
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/** Post a comment. The receiving org needs permission === 'comment'. */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const text = typeof body.body === 'string' ? body.body : ''
    if (!text.trim()) return apiError('body is required', 400)

    const comment = await addShareComment({
      shareId: id,
      viewerOrgId: ctx.orgId,
      body: text,
      actor: ctx.actor,
    })
    return apiSuccess({ comment }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
