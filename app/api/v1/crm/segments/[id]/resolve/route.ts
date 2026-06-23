/**
 * POST /api/v1/crm/segments/:id/resolve
 *
 * Resolves the contacts that match a segment's saved filters.
 * Returns:
 *   - count:    total matched (capped at MAX_RESULTS in the resolver)
 *   - ids:      every matched contact id (so callers can enroll en masse)
 *   - contacts: the first 50 full contact docs (for UI preview)
 *
 * Auth: admin (role matrix: POST → admin).
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  resolveSegmentContacts,
  resolveRuleGroup,
  resolveSegmentMembershipTag,
} from '@/lib/crm/segments'
import type { Contact } from '@/lib/crm/types'
import type { Segment } from '@/lib/crm/segments'

const PREVIEW_LIMIT = 50

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const doc = await adminDb.collection('segments').doc(id).get()
  if (!doc.exists) return apiError('Segment not found', 404)

  const segment = { id: doc.id, ...(doc.data() ?? {}) } as Segment
  if (segment.deleted === true) return apiError('Segment not found', 404)
  if (!segment.orgId) return apiError('Segment has no orgId', 422)

  // Tenant isolation: 404 if segment belongs to a different org
  if (segment.orgId !== ctx.orgId) return apiError('Segment not found', 404)

  // US-055: prefer the generic rule tree when present; else legacy filters.
  const [dynamicContacts, taggedContacts] = await Promise.all([
    segment.ruleGroup && Array.isArray(segment.ruleGroup.rules) && segment.ruleGroup.rules.length > 0
      ? resolveRuleGroup(ctx.orgId, segment.ruleGroup)
      : resolveSegmentContacts(ctx.orgId, segment.filters ?? {}),
    // US-074: contacts explicitly assigned to this segment via automation carry
    // the membership tag and are always members, OR'd with the dynamic rules.
    resolveSegmentMembershipTag(ctx.orgId, id),
  ])

  const seen = new Set<string>()
  const contacts: Contact[] = []
  for (const c of [...dynamicContacts, ...taggedContacts]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    contacts.push(c)
  }

  return apiSuccess({
    count: contacts.length,
    ids: contacts.map((c) => c.id),
    contacts: contacts.slice(0, PREVIEW_LIMIT),
  })
})
