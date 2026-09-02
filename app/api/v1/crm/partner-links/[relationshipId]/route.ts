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
import { COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'
import { updateCompanyWorkspaceGrantItems } from '@/lib/company-work/grants'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ relationshipId: string }> }

const VALID_CAPABILITIES: SharedBusinessCapability[] = [...COMPANY_WORKSPACE_MODULES]

const POLICY_KEYS: Array<keyof FieldSharingPolicy> = [
  'companyProfile', 'contacts', 'projects', 'documents', 'commerce', 'analytics', 'research', 'properties',
]

/**
 * PATCH — edit what THIS side shares.
 *
 * Deliberately one-sided: an org may only change its own relationship row.
 * When sharedCapabilities change, company_workspace grant items[] match.
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
    let nextCapabilities: SharedBusinessCapability[] | null = null

    if (Array.isArray(body.sharedCapabilities)) {
      const caps = body.sharedCapabilities
        .map((c) => cleanString(c))
        .filter((c): c is SharedBusinessCapability => (VALID_CAPABILITIES as string[]).includes(c))
      nextCapabilities = caps
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

    let updated: BusinessRelationship = { ...link, id: relationshipId }
    if (Object.keys(patch).length > 0) {
      updated = await updateBusinessRelationship(ctx.orgId, relationshipId, patch, ctx.actor)
    } else if (nextCapabilities && nextCapabilities.length === 0) {
      const fresh = await snap.ref.get()
      updated = { ...(fresh.data() as BusinessRelationship), id: relationshipId }
    }

    if (nextCapabilities) {
      const companyId = cleanString(link.sourceCompanyId)
      const partnerLinkId = cleanString(link.partnerLinkId)
      if (companyId && partnerLinkId) {
        await updateCompanyWorkspaceGrantItems({
          partnerLinkId,
          ownerOrgId: ctx.orgId,
          companyId,
          modules: nextCapabilities,
        })
      }
    }

    return apiSuccess({ link: updated })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
