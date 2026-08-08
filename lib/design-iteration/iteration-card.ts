/**
 * Design Iteration ("Design this page") — Messages action card (P1).
 *
 * Converts a stored DesignIterationSession into the `design_iteration` rich
 * part (the variant deck: baseline screenshot, instruction, element refs,
 * and one entry per variant with archetype + description + status) plus
 * per-variant uiActions (Accept / Reject) and an open_context to the design
 * canvas. Attaches to the in-flight assistant message mirroring the
 * design-audit card + planningConfirmHandoff patterns.
 *
 * Accept/Reject are `custom` actions dispatched to the agent run — the agent
 * performs the repo write (development branch, approved repo only), runs the
 * T1 detector, and records the apply via POST /api/v1/design-iteration/
 * sessions/[id]/apply.
 */

import { FieldValue } from 'firebase-admin/firestore'

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import type { ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import {
  parseMessagesHandoffIds,
  type MessagesHandoffIds,
} from '@/lib/messages/openContextHandoff'
import type { DesignIterationSession, DesignIterationVariant } from './types'

export const DESIGN_ITERATION_CARD_PART_TYPE = 'design_iteration'

export interface DesignIterationCardPresentation {
  richParts: RichMessagePart[]
  uiActions: ChatUiAction[]
  contextRef: {
    type: 'design'
    id: string
    label: string
    origin: 'manual'
    summary?: string
  }
}

function variantStatusLabel(variant: DesignIterationVariant): string {
  if (variant.status === 'accepted') return 'Accepted'
  if (variant.status === 'rejected') return 'Rejected'
  return 'Pending'
}

function variantLine(variant: DesignIterationVariant): string {
  const changeType = variant.changeType === 'image-mock' ? 'image mock' : 'DOM/CSS edit'
  return `${variant.archetype} — ${variant.status} (${changeType}): ${variant.description}${variant.decisionNote ? ` [${variant.decisionNote}]` : ''}`
}

function elementRefLine(ref: { ref: string; role?: string; name?: string }): string {
  return `${ref.ref}${ref.name ? ` ${ref.name}` : ''}${ref.role ? ` (${ref.role})` : ''}`
}

export function buildDesignIterationCardPresentation(input: {
  session: DesignIterationSession
  label?: string
}): DesignIterationCardPresentation {
  const session = input.session
  const label = (input.label ?? `Design this page — ${session.url}`).trim() || 'Design this page'
  const pending = session.variants.filter((variant) => variant.status === 'pending').length
  const accepted = session.variants.find((variant) => variant.status === 'accepted')
  const statusLabel = session.status === 'applied'
    ? 'Applied'
    : accepted
      ? `Accepted: ${accepted.archetype}`
      : session.status === 'rejected'
        ? 'All variants rejected'
        : `${session.variants.length} variant${session.variants.length === 1 ? '' : 's'} · ${pending} pending`

  const richParts: RichMessagePart[] = [{
    type: DESIGN_ITERATION_CARD_PART_TYPE,
    id: `design-iteration:${session.id}`,
    title: label,
    statusLabel,
    body: [
      `URL: ${session.url}`,
      `Instruction: ${session.instruction}`,
      session.elementRefs.length ? `Element refs: ${session.elementRefs.map(elementRefLine).join(' · ')}` : '',
    ].filter(Boolean).join('\n'),
    evidence: [
      `${session.variants.length} archetype-distinct variant${session.variants.length === 1 ? '' : 's'}`,
      ...(session.apply ? [`Applied to ${session.apply.repo} (${session.apply.branch})`, `Diff: ${session.apply.diffSummary}`] : []),
    ],
    ...(session.screenshotUrl ? { images: [{ url: session.screenshotUrl, alt: 'Live page — design this page baseline', caption: 'Baseline page' }] } : {}),
    metrics: [
      { label: 'Variants', value: session.variants.length },
      { label: 'Pending', value: pending },
      { label: 'Accepted', value: session.variants.filter((variant) => variant.status === 'accepted').length },
      { label: 'Rejected', value: session.variants.filter((variant) => variant.status === 'rejected').length },
    ],
    sections: session.variants.map((variant, index) => ({
      heading: `Variant ${index + 1} — ${variant.archetype} [${variantStatusLabel(variant)}]`,
      items: [variantLine(variant), ...(variant.screenshotUrl ? [`Preview: ${variant.screenshotUrl}`] : [])],
    })),
  }]

  const uiActions: ChatUiAction[] = session.variants.flatMap((variant) => {
    if (variant.status !== 'pending') return []
    return [
      {
        id: `design-iteration-accept:${session.id}:${variant.id}`,
        type: 'custom',
        actionId: 'design-iteration:accept',
        label: `Accept: ${variant.archetype}`,
        variant: 'primary',
        payload: { sessionId: session.id, variantId: variant.id, url: session.url },
      },
      {
        id: `design-iteration-reject:${session.id}:${variant.id}`,
        type: 'custom',
        actionId: 'design-iteration:reject',
        label: `Reject: ${variant.archetype}`,
        variant: 'secondary',
        payload: { sessionId: session.id, variantId: variant.id, url: session.url },
      },
    ]
  })
  if (session.status === 'applied' && session.apply) {
    uiActions.push({
      id: `design-iteration-view-diff:${session.id}`,
      type: 'open_context',
      label: 'View applied change',
      variant: 'secondary',
      payload: { kind: 'design', id: session.id, label },
    })
  } else {
    uiActions.push({
      id: `open-design-iteration:${session.id}`,
      type: 'open_context',
      label: 'Open variant deck',
      variant: 'secondary',
      payload: { kind: 'design', id: session.id, label },
    })
  }

  return {
    richParts,
    uiActions,
    contextRef: {
      type: 'design',
      id: session.id,
      label,
      origin: 'manual',
      summary: `${statusLabel} · ${session.url}`,
    },
  }
}

/** Attaches the deck's richParts + uiActions + contextRef to the in-flight assistant message. */
export async function attachDesignIterationCardToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: DesignIterationCardPresentation
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

  const existingParts = Array.isArray(data.richParts)
    ? data.richParts
    : Array.isArray(data.rich_parts)
      ? data.rich_parts
      : []
  const nextParts = [
    ...existingParts.filter((part: unknown) => {
      if (!part || typeof part !== 'object') return true
      const record = part as Record<string, unknown>
      return !(record.type === DESIGN_ITERATION_CARD_PART_TYPE && record.id === `design-iteration:${input.presentation.contextRef.id}`)
    }),
    ...input.presentation.richParts,
  ]

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
    ...existingRefs.filter((ref: unknown) => {
      if (!ref || typeof ref !== 'object') return true
      const record = ref as Record<string, unknown>
      return !(record.type === kind && record.id === refId)
    }),
    input.presentation.contextRef,
  ]

  await msgRef.update({
    richParts: nextParts,
    rich_parts: nextParts,
    uiActions,
    ui_actions: uiActions,
    contextRefs: nextRefs,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { attached: true }
}

/** Builds the presentation + attaches when handoff ids are present. Safe no-op when ids missing. */
export async function handoffDesignIterationCardFromCreate(input: {
  orgId: string
  body: Record<string, unknown> | null | undefined
  session: DesignIterationSession
  label?: string
}): Promise<DesignIterationCardPresentation & { messagesAttach: { attached: boolean; reason?: string } }> {
  const presentation = buildDesignIterationCardPresentation({ session: input.session, label: input.label })
  const handoff: MessagesHandoffIds = parseMessagesHandoffIds(input.body ?? undefined)
  const messagesAttach = await attachDesignIterationCardToAssistantMessage({
    orgId: input.orgId,
    conversationId: handoff.conversationId,
    responseMessageId: handoff.responseMessageId,
    presentation,
  }).catch(() => ({ attached: false as const, reason: 'handoff_failed' }))
  return { ...presentation, messagesAttach }
}
