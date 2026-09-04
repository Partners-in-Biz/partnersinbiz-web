import type { AgentId } from '@/lib/agents/types'
import { validatePart, type SystemEventPart } from '@/lib/chat/parts'
import { createMessage, getConversation, touchConversation } from '@/lib/conversations/conversations'
import type { ConversationMessage } from '@/lib/conversations/types'
import type { RichMessagePart } from '@/lib/hermes/types'

export class SystemEventError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'SystemEventError'
  }
}

export type AppendSystemEventInput = {
  convId: string
  event: Omit<SystemEventPart, 'type' | 'at'> & { at?: string }
  /** Optional agent attribution when the event is about a bot. */
  agentId?: AgentId
  content?: string
}

/**
 * Appends a compact system_event rich part as a `role: 'system'` message.
 * Used for driver hand-offs, room membership changes, and routine lifecycle.
 */
export async function appendSystemEvent(input: AppendSystemEventInput): Promise<ConversationMessage> {
  const conversation = await getConversation(input.convId)
  if (!conversation) throw new SystemEventError('Conversation not found', 404)

  const at = input.event.at ?? new Date().toISOString()
  const part: RichMessagePart = {
    type: 'system_event',
    eventKind: String(input.event.eventKind || 'event').slice(0, 80),
    actorKind: input.event.actorKind === 'user' || input.event.actorKind === 'agent' ? input.event.actorKind : 'system',
    actorLabel: String(input.event.actorLabel || 'System').slice(0, 120),
    summary: String(input.event.summary || '').slice(0, 500),
    at,
    ...(input.event.href ? { href: String(input.event.href).slice(0, 2000) } : {}),
  }
  const checked = validatePart(part)
  if (!checked.ok) throw new SystemEventError(checked.reason, 400)

  const summary = typeof part.summary === 'string' ? part.summary : ''
  const content = (input.content ?? summary).slice(0, 2000)

  const message = await createMessage(input.convId, {
    conversationId: input.convId,
    role: 'system',
    content,
    richParts: [part],
    rich_parts: [part],
    status: 'completed',
    authorKind: 'system',
    authorId: 'system',
    authorDisplayName: String(part.actorLabel || 'System'),
  })

  await touchConversation(input.convId, content.slice(0, 140), 'system', message.id)
  return message
}
