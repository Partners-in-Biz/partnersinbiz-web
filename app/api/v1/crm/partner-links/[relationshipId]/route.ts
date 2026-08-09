import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { updateBusinessRelationship } from '@/lib/business-relationships/store'
import { adminDb } from '@/lib/firebase/admin'
import { cleanString } from '@/lib/partner-links/identity'
import type {
  BusinessRelationship,
  FieldSharingPolicy,
  SharedBusinessCapability,
} from '@/lib/business-relationships/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ relationshipId: string }> }

const VALID_CAPABILITIES: SharedBusinessCapability[] = [
  'crm', 'projects', 'documents', 'orders', 'shipments',
  'inventory', 'invoices', 'analytics', 'research', 'properties', 'support', 'services',
]

const POLICY_KEYS: Array<keyof FieldSharingPolicy> = [
  'companyProfile', 'contacts', 'projects', 'documents', 'commerce', 'analytics', 'research', 'properties',
]

/**
 * PATCH — edit what THIS side shares.
 *
 * Deliberately one-sided: an org may only change its own relationship row.
 * Sharing is not symmetric by decree — each workspace decides what it exposes,
 * so this never writes the counterpart row.
 */
export const PATCH = withCrmAuth<RouteContext>('member', async (req: NextRequest, ctx: CrmAuthContext, routeCtx) => {
  try {
    const { relationshipId } = await routeCtx!.params
    const snap = await adminDb.collection('businessRelationships').doc(relationshipId).get()
    if (!snap.exists) return apiError('Partner link not found', 404)
    const link = snap.data() as BusinessRelationship
    if (link.sourceOrgId !== ctx.orgId || link.deleted === true) {
      return apiError('Partner link not found', 404)
    }
    if (!cleanString(link.partnerLinkId)) {
      return apiError('That relationship is not an accepted partner link', 400)
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, unknown> = {}

    if (Array.isArray(body.sharedCapabilities)) {
      const caps = body.sharedCapabilities
        .map((c) => cleanString(c))
        .filter((c): c is SharedBusinessCapability => (VALID_CAPABILITIES as string[]).includes(c))
      // sanitizeRelationship drops empty arrays, so an explicit "share nothing"
      // has to be written directly rather than through the shared sanitiser.
      if (caps.length === 0) {
        await snap.ref.set({ sharedCapabilities: [], updatedByRef: ctx.actor }, { merge: true })
      } else {
        patch.sharedCapabilities = caps
      }
    }

    if (body.fieldSharingPolicy && typeof body.fieldSharingPolicy === 'object') {
      const incoming = body.fieldSharingPolicy as Record<string, unknown>
      const policy: FieldSharingPolicy = {}
      for (const key of POLICY_KEYS) {
        if (typeof incoming[key] === 'boolean') policy[key] = incoming[key] as boolean
      }
      patch.fieldSharingPolicy = policy
    }

    if (typeof body.portalVisible === 'boolean') patch.portalVisible = body.portalVisible

    const relationshipType = cleanString(body.relationshipType)
    if (relationshipType) patch.relationshipType = relationshipType

    if (Object.keys(patch).length > 0) {
      const updated = await updateBusinessRelationship(ctx.orgId, relationshipId, patch, ctx.actor)
      return apiSuccess({ link: updated })
    }

    const fresh = await snap.ref.get()
    return apiSuccess({ link: { id: relationshipId, ...fresh.data() } })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
