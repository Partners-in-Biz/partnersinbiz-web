/**
 * Email-specific wrappers around the shared Messages open_context handoff.
 * Prefer `@/lib/messages/openContextHandoff` for new canvas kinds.
 */
import {
  attachOpenContextToAssistantMessage,
  buildOpenContextPresentation,
  parseMessagesHandoffIds,
  type MessagesHandoffIds,
  type OpenContextPresentation,
} from '@/lib/messages/openContextHandoff'
import type { EmailContextPresentation } from '@/lib/mailbox/emailContextPresentation'

export type EmailMessagesHandoffIds = MessagesHandoffIds

export function parseEmailMessagesHandoff(body: Record<string, unknown>): EmailMessagesHandoffIds {
  return parseMessagesHandoffIds(body)
}

export async function attachEmailDraftOpenContextToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: EmailContextPresentation | OpenContextPresentation
}): Promise<{ attached: boolean; reason?: string }> {
  const presentation: OpenContextPresentation = 'uiActions' in input.presentation
    && input.presentation.contextRef?.type
    ? {
      contextRef: {
        type: 'email',
        id: input.presentation.contextRef.id,
        label: input.presentation.contextRef.label,
        origin: 'manual',
        summary: input.presentation.contextRef.summary,
      },
      uiActions: input.presentation.uiActions.map((action) => ({
        id: action.id,
        type: 'open_context' as const,
        label: action.label,
        variant: 'primary' as const,
        payload: {
          kind: 'email' as const,
          id: action.payload.id,
          label: action.payload.label,
        },
      })),
    }
    : buildOpenContextPresentation({
      kind: 'email',
      id: input.presentation.contextRef.id,
      label: input.presentation.contextRef.label,
      summary: input.presentation.contextRef.summary,
    })

  return attachOpenContextToAssistantMessage({
    orgId: input.orgId,
    conversationId: input.conversationId,
    responseMessageId: input.responseMessageId,
    presentation,
  })
}
