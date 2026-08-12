import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import {
  actorRefFromCtx,
  cleanString,
  hashOpaqueValue,
  mapPrejoinServiceError,
  mintDeliveryToken,
  projectPrejoinInvitation,
} from '@/lib/cross-org/prejoin-resource-http'
import { createPrejoinResourceService, getPrejoinInvitationById } from '@/lib/cross-org/prejoin-resource-store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/cross-org/prejoin-invitations/[id]/recover
 *
 * Idempotent recovery of an expired/revoked invitation. Creates one replacement
 * and returns a fresh delivery token only when a new replacement is minted.
 */
export const POST = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { id } = await routeCtx!.params
    const invitationId = cleanString(id)
    if (!invitationId) return apiError('invitation id is required', 400)

    const invitation = await getPrejoinInvitationById(invitationId)
    if (!invitation) return apiError('pre-join invitation not found', 404)
    if (invitation.ownerOrgId !== ctx.orgId) {
      return apiError('Only the owning organisation can recover this invitation', 403)
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const expiresAtRaw = cleanString(body.expiresAt)
    const expiresAt = expiresAtRaw
      ? new Date(expiresAtRaw)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(expiresAt.getTime())) return apiError('expiresAt must be a valid timestamp', 400)

    const deliveryToken = mintDeliveryToken()
    const service = createPrejoinResourceService()
    const result = await service.recoverInvitation({
      invitationId,
      replacementId: randomUUID(),
      replacementTokenHash: hashOpaqueValue(deliveryToken),
      issuedByRef: actorRefFromCtx(ctx.actor),
      expiresAt,
    })

    const mintedFresh = result.replacement.tokenHash === hashOpaqueValue(deliveryToken)
    return apiSuccess({
      source: projectPrejoinInvitation(result.source),
      replacement: projectPrejoinInvitation(result.replacement),
      ...(mintedFresh ? { deliveryToken } : {}),
    })
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
