import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'
import {
  CLIENT_APPROVAL_STATES,
  setSharedRecordApproval,
  type ClientApprovalState,
} from '@/lib/company-work/write-back'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ module: string; id: string }> }

/**
 * POST /api/v1/company-work/shared/[module]/[id]/approve
 * Body: { state: 'approved' | 'changes_requested', note? }
 * Writes a clientApproval envelope onto the serving org's record. Requires the
 * company_workspace grant to carry the `approve` action. Approvals are
 * signals only — the serving org's own approvalState/status stays theirs.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { module: moduleParam, id } = await routeCtx!.params
    const module = moduleParam.trim() as SharedBusinessCapability
    if (!(COMPANY_WORKSPACE_MODULES as string[]).includes(module)) {
      return apiError('Unknown module', 400)
    }
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const rawState = typeof body.state === 'string' ? body.state.trim() : body.approved === true ? 'approved' : ''
    if (!CLIENT_APPROVAL_STATES.includes(rawState as ClientApprovalState)) {
      return apiError(`state must be one of ${CLIENT_APPROVAL_STATES.join(', ')}`, 400)
    }
    const uid = ctx.uid ?? ctx.actor.uid

    const result = await setSharedRecordApproval({
      viewerUid: uid,
      viewerOrgId: ctx.orgId,
      module,
      recordId: id,
      state: rawState as ClientApprovalState,
      note: typeof body.note === 'string' ? body.note : undefined,
    })
    if (!result.ok) return apiError(result.reason, result.status)
    return apiSuccess({ module, recordId: id, approval: { ...result.approval, at: new Date().toISOString() } })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
