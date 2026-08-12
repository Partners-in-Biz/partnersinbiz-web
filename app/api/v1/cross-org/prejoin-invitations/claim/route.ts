import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import {
  actorRefFromCtx,
  cleanString,
  hashOpaqueValue,
  loadActorEmailHash,
  mapPrejoinServiceError,
  projectPrejoinInvitation,
} from '@/lib/cross-org/prejoin-resource-http'
import { createPrejoinResourceService } from '@/lib/cross-org/prejoin-resource-store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/cross-org/prejoin-invitations/claim
 *
 * Claim a pre-join invitation by the raw delivery token. The authenticated
 * actor's email hash must match the invitation recipient. Identity mismatches
 * never consume the invitation.
 */
export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    if (ctx.isAgent) return apiError('Only a verified human recipient can claim a pre-join invitation', 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const token = cleanString(body.token)
    if (!token || token.length < 12) return apiError('token is required', 400)

    const emailHash = await loadActorEmailHash(ctx.uid || ctx.actor.uid)
    if (!emailHash) return apiError('Verified recipient email is required', 403)

    const service = createPrejoinResourceService()
    const result = await service.claimInvitationByTokenHash({
      tokenHash: hashOpaqueValue(token),
      actor: {
        ...actorRefFromCtx(ctx.actor),
        emailHash,
        identityVerified: true,
      },
    })

    if (result.kind === 'identity_mismatch') {
      return apiError('Recipient identity does not match this invitation', 403, {
        kind: result.kind,
        invitation: projectPrejoinInvitation(result.invitation),
      })
    }
    if (result.kind === 'unavailable') {
      return apiError('Invitation is unavailable', 409, {
        kind: result.kind,
        invitation: projectPrejoinInvitation(result.invitation),
      })
    }

    return apiSuccess({
      kind: result.kind,
      invitation: projectPrejoinInvitation(result.invitation),
    })
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
