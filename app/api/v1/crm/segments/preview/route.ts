/**
 * POST /api/v1/crm/segments/preview
 *
 * Live-resolves a SegmentFilters payload without persisting anything. Used by
 * the segment rule builder UI to show "matches N contacts" on debounce.
 *
 * Body: { filters: SegmentFilters }
 * Returns: { count: number, sample: Contact[] (first 10) }
 *
 * Auth: admin (role matrix: POST → admin).
 */
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  resolveSegmentContacts,
  sanitizeSegmentFilters,
  sanitizeRuleGroup,
  resolveRuleGroup,
} from '@/lib/crm/segments'

const SAMPLE_SIZE = 10

export const POST = withCrmAuth('admin', async (req, ctx) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  // US-055: a generic rule tree takes precedence when supplied.
  if (body.ruleGroup !== undefined) {
    const ruleGroup = sanitizeRuleGroup(body.ruleGroup)
    if (ruleGroup) {
      const matched = await resolveRuleGroup(ctx.orgId, ruleGroup)
      return apiSuccess({
        count: matched.length,
        sample: matched.slice(0, SAMPLE_SIZE),
      })
    }
  }

  const filters = sanitizeSegmentFilters(body.filters)
  if ((filters.tags?.length ?? 0) > 10) {
    return apiError('tags filter supports up to 10 values', 400)
  }

  const contacts = await resolveSegmentContacts(ctx.orgId, filters)
  return apiSuccess({
    count: contacts.length,
    sample: contacts.slice(0, SAMPLE_SIZE),
  })
})
