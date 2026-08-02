/**
 * POST /api/v1/workflow-runs/triggers/domain-event
 * Domain event adapter: task.completed | document.approved | deal.stage_changed | social.post_failed
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { withIdempotency } from '@/lib/api/idempotency'
import { handleDomainEventTrigger, listSupportedDomainEvents } from '@/lib/workflow-graph'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = withAuth('admin', async () => {
  return apiSuccess({ supportedEventTypes: listSupportedDomainEvents() })
})

export const POST = withAuth('admin', withIdempotency(async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const orgId = cleanString(body.orgId) || cleanString(req.headers.get('x-org-id'))
  if (!orgId) return apiError('orgId is required', 400)
  if (user.role !== 'ai' && !canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const eventType = cleanString(body.eventType)
  const eventId = cleanString(body.eventId) || cleanString(body.id)
  const projectId = cleanString(body.projectId) || undefined
  const payload = body.payload && typeof body.payload === 'object'
    ? body.payload as Record<string, unknown>
    : undefined

  const result = await handleDomainEventTrigger({
    orgId,
    eventType,
    eventId,
    projectId,
    actorUid: user.uid,
    payload,
  })
  if (!result.ok) return apiError(result.error, result.status)
  return apiSuccess(result, result.started.some((s) => !s.deduplicated) ? 201 : 200)
}))
