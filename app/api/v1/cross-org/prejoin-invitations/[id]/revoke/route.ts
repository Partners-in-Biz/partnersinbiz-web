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
 * POST /api/v1/cross-org/prejoin-invitations/[id]/revoke
 *
 * Pending invites revoke on the invitation record. Activated invites revoke the
 * canonical PartnerResourceGrant by source invitation id.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invitationId = cleanString(id)
    if (!invitationId) return apiError('invitation id is required', 400)

    const invitation = await getPrejoinInvitationById(invitationId)
    if (!invitation) return apiError('pre-join invitation not found', 404)
    if (invitation.ownerOrgId !== ctx.orgId) {
      return apiError('Only the owning organisation can revoke this invitation', 403)
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const reason = cleanString(body.reason) || 'revoked'
    const service = createPrejoinResourceService()

    if (invitation.status === 'activated') {
      const grant = await service.revokeGrantByInvitationId({
        invitationId,
        revokedByRef: {
          uid: ctx.actor.uid,
          displayName: ctx.actor.displayName || ctx.actor.uid,
          kind: ctx.actor.kind === 'agent' ? 'agent' : ctx.actor.kind === 'system' ? 'system' : 'human',
        },
        actorOrgId: ctx.orgId,
        reason,
      })
      return apiSuccess({
        invitation: projectPrejoinInvitation(invitation),
        grant,
      })
    }

    const revoked = await service.revokeInvitation({
      invitationId,
      revokedByRef: actorRefFromCtx(ctx.actor),
      reason,
    })
    return apiSuccess({ invitation: projectPrejoinInvitation(revoked) })
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
