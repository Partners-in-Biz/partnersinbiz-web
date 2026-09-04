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
import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import { appendAgentMessage, AppendAgentMessageError } from '@/lib/conversations/append-agent-message'
import { getConversation } from '@/lib/conversations/conversations'
import { authorizeConversationProject, canAppendAgentMessage } from '@/lib/conversations/access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ convId: string }> }

function cleanAgentId(value: unknown): AgentId | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return AGENT_IDS.includes(trimmed as AgentId) ? trimmed as AgentId : null
}

function canAppendForAgent(user: ApiUser, agentId: AgentId): boolean {
  if (user.role === 'admin') return true
  if (user.role !== 'ai') return false
  const apiAgentId = typeof user.agentId === 'string' ? user.agentId : null
  if (!apiAgentId) return false
  return apiAgentId === agentId || apiAgentId === 'pip'
}

function canRelaySpecialistOutput(
  user: ApiUser,
  agentId: AgentId,
  conversation: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
): boolean {
  if (user.role !== 'ai' || user.agentId !== 'pip' || agentId === 'pip') return false
  if (!conversation.participantAgentIds.includes('pip')) return false
  return conversation.orchestration?.requestedAgentIds?.includes(agentId) === true
}

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    if (user.role === 'client') return apiError('Forbidden', 403)

    const { convId } = await (context as Params).params
    const conversation = await getConversation(convId)
    if (!conversation) return apiError('Conversation not found', 404)
    if (!canAppendAgentMessage(user, conversation)) return apiError('Forbidden', 403)
    const projectAuthorization = await authorizeConversationProject(user, conversation)
    if (!projectAuthorization.ok) return apiError(projectAuthorization.error, projectAuthorization.status)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)
    const raw = body as Record<string, unknown>

    const agentId = cleanAgentId(raw.agentId ?? raw.authorAgentId)
    if (!agentId) return apiError(`agentId is required; expected one of ${AGENT_IDS.join(' | ')}`, 400)
    if (!canAppendForAgent(user, agentId)) return apiError('Forbidden', 403)

    const participantAgentIds = Array.isArray(conversation.participantAgentIds)
      ? conversation.participantAgentIds
      : []
    const allowNonParticipant = canRelaySpecialistOutput(user, agentId, conversation)
    if (!participantAgentIds.includes(agentId) && !allowNonParticipant) {
      return apiError('Agent is not a participant in this conversation', 403)
    }

    try {
      const message = await appendAgentMessage({
        convId,
        agentId,
        content: typeof raw.content === 'string' ? raw.content : '',
        richParts: raw.richParts ?? raw.rich_parts ?? raw.parts,
        uiActions: raw.uiActions ?? raw.ui_actions,
        runId: typeof (raw.runId ?? raw.run_id) === 'string' ? String(raw.runId ?? raw.run_id) : undefined,
        authorDisplayName: typeof raw.authorDisplayName === 'string' ? raw.authorDisplayName : undefined,
        allowNonParticipant,
      })
      return apiSuccess({ message }, 201)
    } catch (error) {
      if (error instanceof AppendAgentMessageError) return apiError(error.message, error.status)
      throw error
    }
  },
)
