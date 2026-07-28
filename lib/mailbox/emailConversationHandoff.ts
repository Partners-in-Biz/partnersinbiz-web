import { FieldValue } from 'firebase-admin/firestore'

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import type { EmailContextPresentation } from '@/lib/mailbox/emailContextPresentation'

export type EmailMessagesHandoffIds = {
  conversationId?: string | null
  responseMessageId?: string | null
}

/**
 * Attach draft open_context uiActions onto the in-flight assistant message so Messages
 * auto-opens the email side canvas even if the agent forgets to echo them in final text.
 */
export async function attachEmailDraftOpenContextToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: EmailContextPresentation
}): Promise<{ attached: boolean; reason?: string }> {
  const conversationId = typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
  const responseMessageId = typeof input.responseMessageId === 'string' ? input.responseMessageId.trim() : ''
  if (!conversationId || !responseMessageId) {
    return { attached: false, reason: 'missing_handoff_ids' }
  }

  const conversation = await getConversation(conversationId)
  if (!conversation) return { attached: false, reason: 'conversation_not_found' }
  if (conversation.orgId !== input.orgId) return { attached: false, reason: 'org_mismatch' }

  const msgRef = messagesCollection(conversationId).doc(responseMessageId)
  const snap = await msgRef.get()
  if (!snap.exists) return { attached: false, reason: 'message_not_found' }
  const data = snap.data() ?? {}
  if (data.role !== 'assistant') return { attached: false, reason: 'not_assistant_message' }

  const existingActions = Array.isArray(data.uiActions)
    ? data.uiActions
    : Array.isArray(data.ui_actions)
      ? data.ui_actions
      : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const action of existingActions) {
    if (!action || typeof action !== 'object') continue
    const record = action as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    if (id) byId.set(id, record)
  }
  for (const action of input.presentation.uiActions) {
    byId.set(action.id, action as unknown as Record<string, unknown>)
  }
  const uiActions = Array.from(byId.values())

  const existingRefs = Array.isArray(data.contextRefs) ? data.contextRefs : []
  const nextRefs = [
    ...existingRefs.filter((ref) => {
      if (!ref || typeof ref !== 'object') return true
      const record = ref as Record<string, unknown>
      return !(record.type === 'email' && record.id === input.presentation.contextRef.id)
    }),
    input.presentation.contextRef,
  ]

  await msgRef.update({
    uiActions,
    ui_actions: uiActions,
    contextRefs: nextRefs,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { attached: true }
}

export function parseEmailMessagesHandoff(body: Record<string, unknown>): EmailMessagesHandoffIds {
  const conversationOrigin = body.conversationOrigin && typeof body.conversationOrigin === 'object' && !Array.isArray(body.conversationOrigin)
    ? body.conversationOrigin as Record<string, unknown>
    : null
  const conversationId = typeof body.conversationId === 'string'
    ? body.conversationId
    : typeof conversationOrigin?.conversationId === 'string'
      ? conversationOrigin.conversationId
      : null
  const responseMessageId = typeof body.responseMessageId === 'string'
    ? body.responseMessageId
    : typeof conversationOrigin?.responseMessageId === 'string'
      ? conversationOrigin.responseMessageId
      : null
  return { conversationId, responseMessageId }
}
