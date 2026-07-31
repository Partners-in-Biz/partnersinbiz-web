import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getConversation } from '@/lib/conversations/conversations'
import {
  authorizeConversationProject,
  canAccessConversation,
} from '@/lib/conversations/access'
import {
  heartbeatConversationPresence,
  listConversationPresence,
  type ConversationPresence,
  type ConversationPresenceActorType,
} from '@/lib/conversations/presence'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ convId: string }> }
type PresenceRouteResult = { presence: ConversationPresence[] }

function resolveOrgId(req: NextRequest, user: ApiUser): string | null {
  const url = new URL(req.url)
  return url.searchParams.get('orgId') ?? req.headers.get('x-org-id') ?? user.orgId ?? user.orgIds?.[0] ?? null
}

function actorFromUser(user: ApiUser): { uid: string; type: ConversationPresenceActorType } {
  return {
    uid: user.uid,
    type: user.role === 'ai' ? 'agent' : 'user',
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (conversation.orgId !== orgId || !canAccessConversation(user, conversation)) {
    return apiError('Forbidden', 403)
  }

  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const presence = await listConversationPresence(convId, orgId)
  return apiSuccess<PresenceRouteResult>({ presence })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { convId } = await (context as RouteContext).params
  const orgId = resolveOrgId(req, user)
  if (!orgId) return apiError('orgId is required', 400)

  const conversation = await getConversation(convId)
  if (!conversation) return apiError('Conversation not found', 404)
  if (conversation.orgId !== orgId || !canAccessConversation(user, conversation)) {
    return apiError('Forbidden', 403)
  }

  const projectAuthorization = await authorizeConversationProject(user, conversation)
  if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

  const body = await req.json().catch(() => ({}))
  const presence = await heartbeatConversationPresence(convId, orgId, body, actorFromUser(user))
  return apiSuccess<PresenceRouteResult>({ presence: [presence] })
})
