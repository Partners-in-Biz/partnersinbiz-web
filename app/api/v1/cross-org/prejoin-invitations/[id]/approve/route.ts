import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import {
  actorRefFromCtx,
  cleanString,
  mapPrejoinServiceError,
  projectPrejoinInvitation,
} from '@/lib/cross-org/prejoin-resource-http'
import { createPrejoinResourceService, getPrejoinInvitationById } from '@/lib/cross-org/prejoin-resource-store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/cross-org/prejoin-invitations/[id]/approve
 *
 * Owner-org approval step. Approver identity is recorded separately from the
 * verified recipient identity and never replaces it.
 */
export const POST = withCrmAuth<RouteContext>('member', async (_req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invitationId = cleanString(id)
    if (!invitationId) return apiError('invitation id is required', 400)

    const invitation = await getPrejoinInvitationById(invitationId)
    if (!invitation) return apiError('pre-join invitation not found', 404)
    if (invitation.ownerOrgId !== ctx.orgId) {
      return apiError('Only the owning organisation can approve this invitation', 403)
    }

    const service = createPrejoinResourceService()
    const approved = await service.recordOwnerApproval({
      invitationId,
      approvedByRef: actorRefFromCtx(ctx.actor),
      ownerAuthorized: true,
    })
    return apiSuccess({ invitation: projectPrejoinInvitation(approved) })
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
