import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { cleanString } from '@/lib/partner-links/identity'
import {
  isPartnerShareResourceType,
  listIncomingShares,
  listOutgoingShares,
  sharePartnerRecord,
} from '@/lib/partner-links/shares'

export const dynamic = 'force-dynamic'

/**
 * GET  ?direction=outgoing|incoming|both (default both)
 * POST { relationshipId, resourceType, resourceId, permission? }
 */
export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const direction = cleanString(req.nextUrl.searchParams.get('direction')) || 'both'
    const relationshipId = cleanString(req.nextUrl.searchParams.get('relationshipId')) || undefined
    const includeRevoked = req.nextUrl.searchParams.get('includeRevoked') === 'true'

    const [outgoing, incoming] = await Promise.all([
      direction === 'incoming'
        ? Promise.resolve([])
        : listOutgoingShares(ctx.orgId, { relationshipId, includeRevoked }),
      direction === 'outgoing'
        ? Promise.resolve([])
        : listIncomingShares(ctx.orgId),
    ])

    return apiSuccess({ outgoing, incoming })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const relationshipId = cleanString(body.relationshipId)
    const resourceType = cleanString(body.resourceType)
    const resourceId = cleanString(body.resourceId)

    if (!relationshipId) return apiError('relationshipId is required', 400)
    if (!isPartnerShareResourceType(resourceType)) {
      return apiError('resourceType must be one of deal, project, invoice, quote, client_document', 400)
    }
    if (!resourceId) return apiError('resourceId is required', 400)

    const share = await sharePartnerRecord({
      ownerOrgId: ctx.orgId,
      relationshipId,
      resourceType,
      resourceId,
      permission: cleanString(body.permission) === 'comment' ? 'comment' : 'view',
      actor: ctx.actor,
    })

    return apiSuccess({ share }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
