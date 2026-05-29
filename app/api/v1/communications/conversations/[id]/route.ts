import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getConversationBundle, updateConversation } from '@/lib/communications/store'
import type { ConversationPriority, ConversationStatus } from '@/lib/communications/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const STATUSES: ConversationStatus[] = ['new', 'open', 'pending', 'resolved', 'snoozed']
const PRIORITIES: ConversationPriority[] = ['low', 'normal', 'high', 'urgent']

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context: RouteContext) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { id } = await context.params
  const bundle = await getConversationBundle(scope.orgId, id)
  if (!bundle) return apiError('Conversation not found', 404)
  return apiSuccess(bundle)
})

export const PATCH = withAuth('client', async (req: NextRequest, user: ApiUser, context: RouteContext) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { id } = await context.params

  const updated = await updateConversation(scope.orgId, id, {
    status: STATUSES.includes(body.status) ? body.status : undefined,
    priority: PRIORITIES.includes(body.priority) ? body.priority : undefined,
    queueId: cleanOptionalOrUndefined(body.queueId),
    assigneeAgentId: cleanOptionalOrUndefined(body.assigneeAgentId),
    assigneeUserId: cleanOptionalOrUndefined(body.assigneeUserId),
    labels: Array.isArray(body.labels) ? body.labels : undefined,
    snoozedUntil: body.snoozedUntil ?? undefined,
  })
  if (!updated) return apiError('Conversation not found', 404)
  return apiSuccess(updated)
})

function cleanOptionalOrUndefined(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
