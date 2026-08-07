import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { cleanString } from '@/lib/partner-links/identity'
import { isPartnerShareResourceType, listShareableRecords } from '@/lib/partner-links/shares'
import type { BusinessRelationship } from '@/lib/business-relationships/types'

export const dynamic = 'force-dynamic'

/**
 * GET ?type=project&q=roll&relationshipId=…
 * Records this org could share, for the picker. `relationshipId` is optional
 * and only used to flag rows already shared with that partner.
 */
export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const resourceType = cleanString(req.nextUrl.searchParams.get('type'))
    if (!isPartnerShareResourceType(resourceType)) {
      return apiError('type must be one of deal, project, invoice, quote, client_document', 400)
    }

    let partnerOrgId: string | undefined
    const relationshipId = cleanString(req.nextUrl.searchParams.get('relationshipId'))
    if (relationshipId) {
      const snap = await adminDb.collection('businessRelationships').doc(relationshipId).get()
      const link = snap.exists ? snap.data() as BusinessRelationship : null
      // Silently ignore a link that isn't ours — the flagging is cosmetic.
      if (link && link.sourceOrgId === ctx.orgId) partnerOrgId = cleanString(link.targetOrgId) || undefined
    }

    const { records, truncated } = await listShareableRecords({
      orgId: ctx.orgId,
      resourceType,
      query: cleanString(req.nextUrl.searchParams.get('q')) || undefined,
      partnerOrgId,
    })

    return apiSuccess({ records, truncated })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
