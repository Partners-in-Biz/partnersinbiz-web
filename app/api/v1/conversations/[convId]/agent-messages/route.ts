/**
 * POST /api/v1/conversations/[convId]/agent-messages
 *
 * Append a completed assistant/agent message without dispatching a Hermes run.
 * This is for agent task outputs, QA reports, and rich approval cards that have
 * already been produced elsewhere and need to land in the CEO-readable chat.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import { getConversation, createMessage, touchConversation } from '@/lib/conversations/conversations'
import { normalizeRichParts } from '@/lib/hermes/rich-messages'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function cleanString(value: unknown, max = 20000): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function cleanAgentId(value: unknown): AgentId | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return AGENT_IDS.includes(trimmed as AgentId) ? trimmed as AgentId : null
}

function displayNameForAgent(conversation: Awaited<ReturnType<typeof getConversation>>, agentId: AgentId): string {
  const participant = conversation?.participants
    ?.find((item) => item.kind === 'agent' && item.agentId === agentId)
  return participant?.kind === 'agent' && participant.name ? participant.name : agentId
}

function canAppendForAgent(user: ApiUser, agentId: AgentId): boolean {
  if (user.role === 'admin') return true
  if (user.role !== 'ai') return false
  const apiAgentId = typeof user.agentId === 'string' ? user.agentId : null
  if (!apiAgentId) return user.uid === 'ai-agent'
  return apiAgentId === agentId || apiAgentId === 'pip'
}

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    if (user.role === 'client') return apiError('Forbidden', 403)

    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    if (!canAccessOrg(user, conversation.orgId)) return apiError('Forbidden', 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
    const raw = body as Record<string, unknown>

    const agentId = cleanAgentId(raw.agentId ?? raw.authorAgentId)
    if (!agentId) return apiError(`agentId is required; expected one of ${AGENT_IDS.join(' | ')}`, 400)
    if (!canAppendForAgent(user, agentId)) return apiError('Forbidden', 403)

    const participantAgentIds = Array.isArray(conversation.participantAgentIds)
      ? conversation.participantAgentIds
      : []
    if (!participantAgentIds.includes(agentId) && agentId !== 'pip') {
      return apiError('Agent is not a participant in this conversation', 403)
    }

    const content = cleanString(raw.content)
    const richParts = normalizeRichParts(raw.richParts ?? raw.rich_parts).slice(0, 10)
    if (!content && richParts.length === 0) return apiError('content or richParts are required', 400)

    const authorDisplayName = cleanString(raw.authorDisplayName, 120)
      || displayNameForAgent(conversation, agentId)

    const message = await createMessage(convId, {
      conversationId: convId,
      role: 'assistant',
      content,
      ...(richParts.length > 0 ? { richParts, rich_parts: richParts } : {}),
      authorKind: 'agent',
      authorId: `agent:${agentId}`,
      authorDisplayName,
      dispatchAgentId: agentId,
      status: 'completed',
    })

    const preview = content || richParts.map((part) => part.title || part.type).filter(Boolean).join(', ')
    await touchConversation(convId, preview, 'assistant', message.id)

    return apiSuccess({ message }, 201)
  },
)
