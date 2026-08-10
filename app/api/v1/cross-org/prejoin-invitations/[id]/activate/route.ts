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
 * POST /api/v1/cross-org/prejoin-invitations/[id]/activate
 *
 * Materialise the exact requested PartnerResourceGrant after claim + owner
 * approval. Recipient user identity comes from the invitation record, never
 * the request body. Activation hydrates live link/scope/membership evidence.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invitationId = cleanString(id)
    if (!invitationId) return apiError('invitation id is required', 400)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const partnerLinkId = cleanString(body.partnerLinkId)
    const recipientOrgId = cleanString(body.recipientOrgId)
    if (!partnerLinkId) return apiError('partnerLinkId is required', 400)
    if (!recipientOrgId) return apiError('recipientOrgId is required', 400)

    const invitation = await getPrejoinInvitationById(invitationId)
    if (!invitation) return apiError('pre-join invitation not found', 404)
    if (invitation.ownerOrgId !== ctx.orgId) {
      return apiError('Only the owning organisation can activate this invitation', 403)
    }
    if (!invitation.recipientUserId || !invitation.recipientIdentityMatched) {
      return apiError('Verified recipient identity is required before activation', 400)
    }

    const service = createPrejoinResourceService()
    const result = await service.activateInvitation({
      invitationId,
      partnerLinkId,
      recipientOrgId,
      recipientUserId: invitation.recipientUserId,
      ownerVerifiedByRef: actorRefFromCtx(ctx.actor),
      ownerVerifierAuthorized: true,
    })

    return apiSuccess({
      invitation: projectPrejoinInvitation(result.invitation),
      grant: result.grant,
    })
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
