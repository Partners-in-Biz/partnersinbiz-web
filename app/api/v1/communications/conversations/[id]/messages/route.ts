import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { actorFrom } from '@/lib/api/actor'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { addConversationMessage, getConversationBundle } from '@/lib/communications/store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context: RouteContext) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { id } = await context.params
  const bundle = await getConversationBundle(scope.orgId, id)
  if (!bundle) return apiError('Conversation not found', 404)
  return apiSuccess({ items: bundle.messages, total: bundle.messages.length })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context: RouteContext) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const scope = resolveOrgScope(user, typeof body.orgId === 'string' ? body.orgId.trim() : null)
  if (!scope.ok) return apiError(scope.error, scope.status)

  if (body.sendNow === true && body.humanApproved !== true) {
    return apiError('Human approval is required before sending customer-facing replies in V1', 400)
  }

  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return apiError('body is required', 400)
  const { id } = await context.params
  const result = await addConversationMessage(scope.orgId, id, {
    body: text,
    direction: body.direction === 'inbound' ? 'inbound' : 'outbound',
    status: body.sendNow === true ? 'queued' : body.status === 'received' ? 'received' : 'draft',
    subject: typeof body.subject === 'string' ? body.subject : '',
    templateId: typeof body.templateId === 'string' ? body.templateId : null,
    campaignId: typeof body.campaignId === 'string' ? body.campaignId : null,
    ...actorFrom(user),
  })

  return apiSuccess(result, 201)
})
