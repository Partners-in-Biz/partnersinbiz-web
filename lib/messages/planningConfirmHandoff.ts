/**
 * Decision Brief confirm handoff for Messages.
 *
 * Agents (and user_delegation tokens) cannot confirm a Decision Brief.
 * When a brief becomes brief_ready, attach a human-session approval card +
 * Confirm button so Peet can approve without leaving chat.
 *
 * Confirm clicks use the browser session (bodyMode: payload) against
 * POST /api/v1/projects/:id/planning-discovery — never the agent token.
 */
import { FieldValue } from 'firebase-admin/firestore'

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import type { ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import {
  parseMessagesHandoffIds,
  type MessagesHandoffIds,
} from '@/lib/messages/openContextHandoff'
import type { PlanningDecisionBrief } from '@/lib/projects/planningDiscovery'

export type PlanningConfirmPresentation = {
  richParts: RichMessagePart[]
  uiActions: ChatUiAction[]
  contextRef: {
    type: 'project'
    id: string
    label: string
    origin: 'manual'
    summary?: string
  }
}

function listLine(items: string[] | undefined, empty = 'None recorded'): string {
  const cleaned = (items ?? []).map((item) => item.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned.join(' · ') : empty
}

export function buildPlanningConfirmPresentation(input: {
  projectId: string
  projectLabel?: string
  revision: number
  digest: string
  brief: PlanningDecisionBrief
}): PlanningConfirmPresentation {
  const projectId = input.projectId.trim()
  const label = (input.projectLabel ?? 'Project').trim() || 'Project'
  const digest = input.digest.trim()
  const revision = Number.isFinite(input.revision) ? Math.max(0, Math.floor(input.revision)) : 0
  const brief = input.brief
  const shortDigest = digest.length > 16 ? `${digest.slice(0, 12)}…` : digest

  const richParts: RichMessagePart[] = [{
    type: 'approval_card',
    title: `Confirm Decision Brief — ${label}`,
    body: [
      `Outcome: ${brief.outcome || 'Not recorded'}`,
      `Audience: ${brief.user || 'Not recorded'}`,
      `Why now: ${brief.whyNow || 'Not recorded'}`,
      `Success: ${listLine(brief.successCriteria)}`,
      `Constraints: ${listLine(brief.constraints)}`,
      `Out of scope: ${listLine(brief.outOfScope)}`,
      `Assumptions: ${listLine(brief.assumptions)}`,
      `Risks: ${listLine(brief.risks)}`,
      `Approval gates: ${listLine(brief.approvalGates)}`,
      `Revision ${revision} · digest ${shortDigest}`,
    ].join('\n'),
    statusLabel: 'Needs your confirm',
    evidence: [
      'Planning discovery is brief_ready',
      'Agents and delegated tokens cannot confirm this gate',
      'Your browser session owns the Confirm action',
    ],
    dataSkill: 'interactive-project-planning',
    analysisQuestion: 'Does this Decision Brief still match the dependency chain you want executed?',
    decisions: [
      {
        label: 'Confirm Decision Brief and release the planning gate',
        value: 'confirm',
        required: true,
      },
      {
        label: 'Reject / reopen discovery (open Plan and reopen)',
        value: 'reopen',
        required: false,
      },
    ],
    recommendation: 'Confirm in chat with the primary button. Do not rely on typing “I confirm” for Pip to write the gate.',
    replyTemplate: '',
    safetyNote:
      'Confirm uses your signed-in human session. Pip cannot rubber-stamp Decision Briefs. YOLO / Plan with assumptions still requires the Plan panel attestation.',
  }]

  const uiActions: ChatUiAction[] = [
    {
      id: `confirm-brief:${projectId}:${digest.slice(0, 16)}`,
      type: 'approve',
      label: 'Confirm Decision Brief',
      variant: 'primary',
      method: 'POST',
      endpoint: `/api/v1/projects/${encodeURIComponent(projectId)}/planning-discovery`,
      bodyMode: 'payload',
      payload: {
        type: 'confirm',
        expectedRevision: revision,
        expectedDigest: digest,
      },
    },
    {
      id: `open-project-plan:${projectId}`,
      type: 'open_context',
      label: 'Open project Plan',
      variant: 'secondary',
      payload: {
        kind: 'project',
        id: projectId,
        label,
      },
    },
  ]

  return {
    richParts,
    uiActions,
    contextRef: {
      type: 'project',
      id: projectId,
      label,
      origin: 'manual',
      summary: `Decision Brief ready (rev ${revision}) — confirm in chat`,
    },
  }
}

export async function attachPlanningConfirmToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: PlanningConfirmPresentation
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

  const existingParts = Array.isArray(data.richParts)
    ? data.richParts
    : Array.isArray(data.rich_parts)
      ? data.rich_parts
      : []
  const nextParts = [
    ...existingParts.filter((part) => {
      if (!part || typeof part !== 'object') return true
      const record = part as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title : ''
      return !(record.type === 'approval_card' && title.startsWith('Confirm Decision Brief'))
    }),
    ...input.presentation.richParts,
  ]

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
    richParts: nextParts,
    rich_parts: nextParts,
    uiActions,
    ui_actions: uiActions,
    contextRefs: nextRefs,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { attached: true }
}

export async function handoffPlanningConfirmFromDiscovery(input: {
  orgId: string
  body: Record<string, unknown> | null | undefined
  projectId: string
  projectLabel?: string
  revision: number
  digest: string
  brief: PlanningDecisionBrief
}): Promise<PlanningConfirmPresentation & { messagesAttach: { attached: boolean; reason?: string } }> {
  const presentation = buildPlanningConfirmPresentation({
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    revision: input.revision,
    digest: input.digest,
    brief: input.brief,
  })
  const handoff: MessagesHandoffIds = parseMessagesHandoffIds(input.body ?? undefined)
  const messagesAttach = await attachPlanningConfirmToAssistantMessage({
    orgId: input.orgId,
    conversationId: handoff.conversationId,
    responseMessageId: handoff.responseMessageId,
    presentation,
  }).catch(() => ({ attached: false as const, reason: 'handoff_failed' }))
  return { ...presentation, messagesAttach }
}
