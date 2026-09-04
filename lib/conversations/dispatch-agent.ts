import { adminDb } from '@/lib/firebase/admin'
import { memberHandle } from '@/lib/agent-rooms/projection'
import type { AgentRoom } from '@/lib/agent-rooms/types'
import type { AgentId, Conversation } from './types'

export interface ConversationDispatchSelection {
  participantAgentIds: AgentId[]
  orchestration?: Conversation['orchestration']
  agentRoom?: Conversation['agentRoom']
}

interface DispatchAgentResolutionOptions {
  isAgentEnabled?: (agentId: AgentId) => Promise<boolean>
  /** Latest human turn; used to route `@maya` mentions in an agent-room mirror. */
  messageContent?: string
}

/**
 * `@user` is a Desktop/PiB text mention, not a Hermes WebSocket event.
 * `\b@user` does not match because `@` is not a word character; require a
 * non-word prefix (or start of string) instead.
 */
export const USER_ESCALATION_RE = /(^|[^\w])@user\b/i

const AGENT_MENTION_RE = /@([a-z][a-z0-9._-]{0,39})\b/gi

async function isAgentEnabled(agentId: AgentId): Promise<boolean> {
  const snapshot = await adminDb.collection('agent_team').doc(agentId).get()
  return snapshot.exists && snapshot.data()?.enabled === true
}

export function messageHasUserEscalation(content: string): boolean {
  return USER_ESCALATION_RE.test(content)
}

/** First @handle in `content` that names a room/conversation member. `@user` is ignored. */
export function mentionedRoomAgentId(content: string, memberAgentIds: AgentId[]): AgentId | null {
  const allowed = [...new Set(memberAgentIds.filter((id) => id.trim()))]
  if (!content || allowed.length === 0) return null
  for (const match of content.matchAll(AGENT_MENTION_RE)) {
    const handle = (match[1] ?? '').toLowerCase()
    if (!handle || handle === 'user') continue
    if (allowed.includes(handle)) return handle
    const prefixed = allowed.find((agentId) => handle.startsWith(`${agentId}-`))
    if (prefixed) return prefixed
  }
  return null
}

export function buildAgentRoomSystemPromptSuffix(room: Pick<AgentRoom, 'name' | 'members'>): string {
  const handles = room.members.map((member) => memberHandle(member))
  const teammates = handles.length > 0 ? handles.join(', ') : 'your teammates'
  return [
    '[Agent room]',
    `You are in room ${room.name} with teammates ${teammates}.`,
    'Address teammates with @handle. Escalate to a human with @user — that is not a Hermes WebSocket event.',
    '---',
    '',
  ].join('\n')
}

/** Canonical dispatch-agent selection shared by every runtime-binding lifecycle path. */
export async function resolveConversationDispatchAgentId(
  input: ConversationDispatchSelection,
  options: DispatchAgentResolutionOptions = {},
): Promise<AgentId | null> {
  const agentIds = Array.from(new Set(input.participantAgentIds.filter((agentId) => agentId.trim())))
  if (agentIds.length === 0) return null

  const enabled = options.isAgentEnabled ?? isAgentEnabled

  if (input.agentRoom) {
    const mentioned = mentionedRoomAgentId(options.messageContent ?? '', agentIds)
    if (mentioned) return mentioned
    const dispatcher = input.orchestration?.dispatcherAgentId
    if (dispatcher && agentIds.includes(dispatcher) && await enabled(dispatcher)) return dispatcher
    return agentIds[0]
  }

  if (agentIds.length === 1) return agentIds[0]

  const orchestrator = input.orchestration?.dispatcherAgentId ?? 'pip'
  if (agentIds.includes(orchestrator)
    && await enabled(orchestrator)) return orchestrator
  return agentIds[0]
}
