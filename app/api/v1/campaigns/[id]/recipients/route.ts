/**
 * GET /api/v1/campaigns/[id]/recipients — resolve the computed recipient count
 * for an email campaign's configured audience (segment OR explicit contacts OR
 * tag), minus any excluded contacts.
 *
 * Returns: { count, source: 'segment'|'contacts'|'tag'|'none', excluded }
 *
 * Auth: client (scoped to the campaign's org). Read-only — resolves the
 * audience without enrolling or sending anything.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveSegmentContacts } from '@/lib/crm/segments'
import type { Contact } from '@/lib/crm/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = snap.data() as any
  const access = await assertMarketingHandlerAccess({
    user,
    module: 'campaigns',
    resourceId: id,
    resourceOwnerOrgId: (campaign.orgId as string | undefined) ?? null,
    operation: 'read',
    partnerLinkId: extractPartnerLinkId(req),
  })
  if (!access.ok) return apiError(access.error, access.status)
  const scope = { ok: true as const, orgId: access.orgId }
  const orgId = scope.orgId

  const exclusion = new Set<string>(
    Array.isArray(campaign.exclusionContactIds)
      ? campaign.exclusionContactIds.filter((v: unknown): v is string => typeof v === 'string')
      : [],
  )

  let source: 'segment' | 'contacts' | 'tag' | 'none' = 'none'
  let contactIds: string[] = []

  const segmentId = typeof campaign.segmentId === 'string' ? campaign.segmentId : ''
  const tagId = typeof campaign.tagId === 'string' ? campaign.tagId : ''
  const explicitIds: string[] = Array.isArray(campaign.contactIds)
    ? campaign.contactIds.filter((v: unknown): v is string => typeof v === 'string')
    : []

  if (segmentId) {
    source = 'segment'
    const segSnap = await adminDb.collection('segments').doc(segmentId).get()
    if (segSnap.exists && segSnap.data()?.orgId === orgId && segSnap.data()?.deleted !== true) {
      const filters = segSnap.data()?.filters ?? {}
      const contacts = await resolveSegmentContacts(orgId, filters)
      contactIds = contacts.map((c: Contact) => c.id)
    }
  } else if (tagId) {
    source = 'tag'
    const contacts = await resolveSegmentContacts(orgId, { tags: [tagId] })
    contactIds = contacts.map((c: Contact) => c.id)
  } else if (explicitIds.length > 0) {
    source = 'contacts'
    contactIds = explicitIds
  }

  const beforeExclusions = contactIds.length
  const finalIds = contactIds.filter((cid) => !exclusion.has(cid))

  return apiSuccess({
    count: finalIds.length,
    beforeExclusions,
    excluded: beforeExclusions - finalIds.length,
    source,
  })
})
