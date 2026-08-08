/**
 * Messages open_context handoff — shared contract for side-canvas surfaces.
 *
 * When an agent creates a reviewable artifact (email, invoice, quote, campaign,
 * social post, …) during a Messages turn, create routes should call
 * `attachOpenContextToAssistantMessage` (or `handoffOpenContextFromCreate`) so
 * the Context Dock opens even if the model forgets to echo uiActions.
 *
 * Future canvas kinds: add to MESSAGES_CANVAS_KINDS + ContextDock preview +
 * create-route handoff + skill line. See wiki
 * messages-open-context-hardening.md.
 */
import { FieldValue } from 'firebase-admin/firestore'

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import type { ContextReferenceType } from '@/lib/context-references/types'

/** Kinds that open a rich Context Dock preview in Messages (not generic link chips). */
export const MESSAGES_CANVAS_KINDS = [
  'email',
  'invoice',
  'quote',
  'campaign',
  'social',
  'document',
  'design',
] as const

export type MessagesCanvasKind = (typeof MESSAGES_CANVAS_KINDS)[number]

export type MessagesHandoffIds = {
  conversationId?: string | null
  responseMessageId?: string | null
}

export type OpenContextUiAction = {
  id: string
  type: 'open_context'
  label: string
  variant: 'primary'
  payload: {
    kind: MessagesCanvasKind
    id: string
    label?: string
  }
}

export type OpenContextPresentation = {
  contextRef: {
    type: ContextReferenceType
    id: string
    label: string
    origin: 'manual'
    summary?: string
  }
  uiActions: OpenContextUiAction[]
}

const CANVAS_LABEL: Record<MessagesCanvasKind, string> = {
  email: 'Review email draft',
  invoice: 'Review invoice',
  quote: 'Review quote',
  campaign: 'Review campaign',
  social: 'Review social post',
  document: 'Review document',
  design: 'Review design audit',
}

export function isMessagesCanvasKind(value: unknown): value is MessagesCanvasKind {
  return typeof value === 'string' && (MESSAGES_CANVAS_KINDS as readonly string[]).includes(value)
}

export function parseMessagesHandoffIds(body: Record<string, unknown> | null | undefined): MessagesHandoffIds {
  if (!body || typeof body !== 'object') return { conversationId: null, responseMessageId: null }
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

export function buildOpenContextPresentation(input: {
  kind: MessagesCanvasKind
  id: string
  label?: string
  summary?: string
}): OpenContextPresentation {
  const id = input.id.trim()
  const label = (input.label ?? id).trim() || '(untitled)'
  const summary = input.summary?.trim()
  return {
    contextRef: {
      type: input.kind,
      id,
      label,
      origin: 'manual',
      ...(summary ? { summary: summary.slice(0, 700) } : {}),
    },
    uiActions: [{
      id: `open-${input.kind}:${id}`,
      type: 'open_context',
      label: CANVAS_LABEL[input.kind],
      variant: 'primary',
      payload: {
        kind: input.kind,
        id,
        label,
      },
    }],
  }
}

/**
 * Attach open_context uiActions onto the in-flight assistant message so Messages
 * auto-opens the Context Dock even if the agent forgets to echo them in final text.
 */
export async function attachOpenContextToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: OpenContextPresentation
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

  const kind = input.presentation.contextRef.type
  const refId = input.presentation.contextRef.id
  const existingRefs = Array.isArray(data.contextRefs) ? data.contextRefs : []
  const nextRefs = [
    ...existingRefs.filter((ref) => {
      if (!ref || typeof ref !== 'object') return true
      const record = ref as Record<string, unknown>
      return !(record.type === kind && record.id === refId)
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

/** Create presentation + attach when handoff ids present. Safe no-op when ids missing. */
export async function handoffOpenContextFromCreate(input: {
  orgId: string
  body: Record<string, unknown> | null | undefined
  kind: MessagesCanvasKind
  id: string
  label?: string
  summary?: string
}): Promise<OpenContextPresentation & { messagesAttach: { attached: boolean; reason?: string } }> {
  const presentation = buildOpenContextPresentation({
    kind: input.kind,
    id: input.id,
    label: input.label,
    summary: input.summary,
  })
  const handoff = parseMessagesHandoffIds(input.body ?? undefined)
  const messagesAttach = await attachOpenContextToAssistantMessage({
    orgId: input.orgId,
    conversationId: handoff.conversationId,
    responseMessageId: handoff.responseMessageId,
    presentation,
  }).catch(() => ({ attached: false as const, reason: 'handoff_failed' }))
  return { ...presentation, messagesAttach }
}
