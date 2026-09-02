import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'
import { addSharedRecordComment, listSharedRecordComments } from '@/lib/company-work/write-back'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ module: string; id: string }> }

function parseModule(raw: string): SharedBusinessCapability | null {
  const value = raw.trim() as SharedBusinessCapability
  return (COMPANY_WORKSPACE_MODULES as string[]).includes(value) ? value : null
}

/**
 * GET /api/v1/company-work/shared/[module]/[id]/comments
 * Comments on a record projected into the viewer's org.
 */
export const GET = withCrmAuth<RouteContext>('viewer', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { module: moduleParam, id } = await routeCtx!.params
    const module = parseModule(moduleParam)
    if (!module) return apiError('Unknown module', 400)
    const uid = ctx.uid ?? ctx.actor.uid

    const result = await listSharedRecordComments({
      viewerUid: uid,
      viewerOrgId: ctx.orgId,
      module,
      recordId: id,
    })
    if (!result.ok) return apiError(result.reason, result.status)
    return apiSuccess({ module, recordId: id, comments: result.comments })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

/**
 * POST /api/v1/company-work/shared/[module]/[id]/comments
 * Body: { body, parentCommentId? }
 * Requires the company_workspace grant to carry the `comment` action.
 */
export const POST = withCrmAuth<RouteContext>('viewer', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { module: moduleParam, id } = await routeCtx!.params
    const module = parseModule(moduleParam)
    if (!module) return apiError('Unknown module', 400)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const uid = ctx.uid ?? ctx.actor.uid

    const result = await addSharedRecordComment({
      viewerUid: uid,
      viewerOrgId: ctx.orgId,
      viewerName: ctx.actor.displayName,
      module,
      recordId: id,
      body: typeof body.body === 'string' ? body.body : typeof body.text === 'string' ? body.text : '',
      parentCommentId: typeof body.parentCommentId === 'string' ? body.parentCommentId.trim() || null : null,
    })
    if (!result.ok) return apiError(result.reason, result.status)
    return apiSuccess({ id: result.id }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
