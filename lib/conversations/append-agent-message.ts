import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import { getAgentRoom } from '@/lib/agent-rooms/store'
import { getOrgTeam } from '@/lib/org-teams/store'
import { normalizeRichParts, normalizeUiActions } from '@/lib/hermes/rich-messages'
import { createMessage, getConversation, touchConversation } from './conversations'
import { messageHasUserEscalation } from './dispatch-agent'
import type { Conversation, ConversationMessage } from './types'

export class AppendAgentMessageError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'AppendAgentMessageError'
  }
}

export interface AppendAgentMessageInput {
  convId: string
  agentId: AgentId
  content?: string
  richParts?: unknown
  uiActions?: unknown
  runId?: string
  authorDisplayName?: string
  deviceBadge?: { deviceId: string; label: string }
  allowNonParticipant?: boolean
}

function cleanString(value: unknown, max = 20000): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function displayNameForAgent(conversation: Conversation, agentId: AgentId): string {
  const participant = conversation.participants
    ?.find((item) => item.kind === 'agent' && item.agentId === agentId)
  return participant?.kind === 'agent' && participant.name ? participant.name : agentId
}

export async function resolveHumanTeamUserIds(
  orgId: string,
  humanTeamIds: string[],
): Promise<string[]> {
  const uids = new Set<string>()
  for (const teamId of humanTeamIds) {
    const team = await getOrgTeam(orgId, teamId)
    if (!team || team.status !== 'active') continue
    for (const uid of team.memberUserIds) {
      if (uid.trim()) uids.add(uid.trim())
    }
  }
  return [...uids]
}

export async function appendAgentMessage(input: AppendAgentMessageInput): Promise<ConversationMessage> {
  const conversation = await getConversation(input.convId)
  if (!conversation) throw new AppendAgentMessageError('Conversation not found', 404)

  const agentId = input.agentId
  if (!AGENT_IDS.includes(agentId)) {
    throw new AppendAgentMessageError(`agentId is required; expected one of ${AGENT_IDS.join(' | ')}`, 400)
  }

  const participantAgentIds = Array.isArray(conversation.participantAgentIds)
    ? conversation.participantAgentIds
    : []
  if (!participantAgentIds.includes(agentId) && !input.allowNonParticipant) {
    throw new AppendAgentMessageError('Agent is not a participant in this conversation', 403)
  }

  const content = cleanString(input.content)
  const richParts = normalizeRichParts(input.richParts).slice(0, 10)
  const uiActions = normalizeUiActions(input.uiActions).slice(0, 10)
  const runId = cleanString(input.runId, 200)
  if (!content && richParts.length === 0 && uiActions.length === 0) {
    throw new AppendAgentMessageError('content, richParts, or uiActions are required', 400)
  }

  const authorDisplayName = cleanString(input.authorDisplayName, 120)
    || displayNameForAgent(conversation, agentId)
  const deviceBadge = input.deviceBadge
    && input.deviceBadge.deviceId.trim()
    && input.deviceBadge.label.trim()
    ? { deviceId: input.deviceBadge.deviceId.trim(), label: input.deviceBadge.label.trim().slice(0, 80) }
    : undefined

  const message = await createMessage(input.convId, {
    conversationId: input.convId,
    role: 'assistant',
    content,
    ...(richParts.length > 0 ? { richParts, rich_parts: richParts } : {}),
    ...(uiActions.length > 0 ? { uiActions, ui_actions: uiActions } : {}),
    ...(runId ? { runId } : {}),
    ...(deviceBadge ? { deviceBadge } : {}),
    authorKind: 'agent',
    authorId: `agent:${agentId}`,
    authorDisplayName,
    dispatchAgentId: agentId,
    status: 'completed',
  })

  const preview = content || richParts.map((part) => part.title || part.type).filter(Boolean).join(', ')
  const escalate = Boolean(conversation.agentRoom && messageHasUserEscalation(content))
  if (escalate && conversation.agentRoom) {
    const room = await getAgentRoom(conversation.orgId, conversation.agentRoom.roomId)
    const extraUnreadUserIds = room ? await resolveHumanTeamUserIds(room.orgId, room.humanTeamIds) : []
    await touchConversation(input.convId, preview, 'assistant', message.id, undefined, {
      extraUnreadUserIds,
      needsYou: true,
    })
  } else {
    await touchConversation(input.convId, preview, 'assistant', message.id)
  }

  return message
}
