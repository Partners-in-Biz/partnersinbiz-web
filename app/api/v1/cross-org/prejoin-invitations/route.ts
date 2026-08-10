import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { loadPrejoinResourceOwner } from '@/lib/cross-org/prejoin-resource-owner'
import {
  actorRefFromCtx,
  cleanString,
  cleanStringArray,
  hashEmail,
  hashOpaqueValue,
  isIssuablePrejoinResourceType,
  mapPrejoinServiceError,
  mintDeliveryToken,
  normalizeEmail,
  projectPrejoinInvitation,
} from '@/lib/cross-org/prejoin-resource-http'
import { createPrejoinResourceService } from '@/lib/cross-org/prejoin-resource-store'
import type { PartnerResourceType } from '@/lib/cross-org/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/cross-org/prejoin-invitations
 *
 * Issue an exact-resource pre-join invitation for the authenticated owner org.
 * Owner org is derived from the immutable resource record — never from the body.
 * The raw delivery token is returned once; only its hash is persisted.
 */
export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const resourceTypeRaw = cleanString(body.resourceType)
    const resourceId = cleanString(body.resourceId)
    const recipientEmail = normalizeEmail(body.recipientEmail)
    const requestedActions = cleanStringArray(body.requestedActions)
    const fields = cleanStringArray(body.fields)
    const items = cleanStringArray(body.items)
    const expiresAtRaw = cleanString(body.expiresAt)

    if (!resourceTypeRaw) return apiError('resourceType is required', 400)
    if (!isIssuablePrejoinResourceType(resourceTypeRaw)) {
      return apiError('resourceType is not issuable for pre-join invitations', 400)
    }
    if (!resourceId) return apiError('resourceId is required', 400)
    if (!recipientEmail || !recipientEmail.includes('@')) return apiError('A valid recipientEmail is required', 400)
    if (requestedActions.length === 0) return apiError('requestedActions must include at least one allowed action', 400)

    const ownerOrgId = await loadPrejoinResourceOwner(resourceTypeRaw as PartnerResourceType, resourceId)
    if (!ownerOrgId) return apiError('Resource not found', 404)
    if (ownerOrgId !== ctx.orgId) return apiError('Only the owning organisation can issue this invitation', 403)

    const expiresAt = expiresAtRaw
      ? new Date(expiresAtRaw)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(expiresAt.getTime())) return apiError('expiresAt must be a valid timestamp', 400)

    const deliveryToken = mintDeliveryToken()
    const service = createPrejoinResourceService()
    const invitation = await service.issueInvitation({
      id: randomUUID(),
      tokenHash: hashOpaqueValue(deliveryToken),
      ownerOrgId: ctx.orgId,
      recipientEmailHash: hashEmail(recipientEmail),
      resourceType: resourceTypeRaw as PartnerResourceType,
      resourceId,
      requestedActions,
      ...(fields.length ? { fields } : {}),
      ...(items.length ? { items } : {}),
      issuedByRef: actorRefFromCtx(ctx.actor),
      expiresAt,
    })

    // Reused pending invites keep their original hash; do not re-expose a token we no longer hold.
    const reused = invitation.tokenHash !== hashOpaqueValue(deliveryToken)
    return apiSuccess({
      invitation: projectPrejoinInvitation(invitation),
      reused,
      ...(reused ? {} : { deliveryToken }),
    }, reused ? 200 : 201)
  } catch (err) {
    try {
      return mapPrejoinServiceError(err)
    } catch {
      return apiErrorFromException(err)
    }
  }
})
