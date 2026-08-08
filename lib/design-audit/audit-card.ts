/**
 * Design Audit action card — Messages presentation builder (T2).
 *
 * Converts a stored DesignAuditRun into the `design_audit` rich part +
 * uiActions (Fix it / Ignore + reason / Re-run / open_context) + a `design`
 * contextRef, and attaches it to the in-flight assistant message so the
 * Context Dock canvas opens. Mirrors planningConfirmHandoff / openContextHandoff.
 */

import { FieldValue } from 'firebase-admin/firestore'

import { getConversation, messagesCollection } from '@/lib/conversations/conversations'
import type { ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import {
  parseMessagesHandoffIds,
  type MessagesHandoffIds,
} from '@/lib/messages/openContextHandoff'
import type { DesignAuditRun, DesignAuditWaiver } from './audit-runs'
import type { Finding } from './types'

export const DESIGN_AUDIT_CARD_PART_TYPE = 'design_audit'

export interface DesignAuditCardPresentation {
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

function findingLine(finding: Finding): string {
  const value = finding.value ? ` (${finding.value})` : ''
  return `${finding.severity} ${finding.rule}${value} @ ${finding.ref}${finding.line ? `:${finding.line}` : ''} — ${finding.message}`
}

function waiverLine(waiver: DesignAuditWaiver): string {
  return `${waiver.rule} @ ${waiver.ref} — ${waiver.reason}`
}

function severityCounts(run: DesignAuditRun): string[] {
  if (!run.summary) return []
  return (['P0', 'P1', 'P2', 'P3'] as const)
    .map((severity) => `${severity}: ${run.summary?.bySeverity[severity] ?? 0}`)
}

export function buildDesignAuditCardPresentation(input: {
  run: DesignAuditRun
  label?: string
}): DesignAuditCardPresentation {
  const run = input.run
  const label = (input.label ?? `Design audit — ${run.url}`).trim() || 'Design audit'
  const clean = run.exitCode === 0 && run.findings.length === 0
  const statusLabel = run.status === 'failed'
    ? 'Audit failed'
    : clean
      ? 'Clean'
      : `${run.findings.length} finding${run.findings.length === 1 ? '' : 's'}`
  const waived = run.waivers.length > 0

  const grouped: Partial<Record<Finding['severity'], Finding[]>> = {}
  for (const finding of run.findings) {
    ;(grouped[finding.severity] ??= []).push(finding)
  }

  const richParts: RichMessagePart[] = [{
    type: DESIGN_AUDIT_CARD_PART_TYPE,
    id: `design-audit:${run.id}`,
    title: `Design audit — ${run.url}`,
    statusLabel,
    body: [
      `URL: ${run.url}`,
      `Scope: ${run.scope} · Engine exit code: ${run.exitCode ?? 'n/a'}`,
      run.summary ? `Severity: ${severityCounts(run).join(' · ')}` : '',
      run.designSystemPresent ? 'Design Context applied (drift rules active)' : 'No Design Context applied',
      run.notes.length ? `Notes: ${run.notes.join(' · ')}` : '',
    ].filter(Boolean).join('\n'),
    evidence: [
      `Rules run: ${run.findings.length} findings across ${run.summary?.total ?? 0}`,
      ...(waived ? [`Waived: ${run.waivers.length} (${run.waivers.map(waiverLine).join(' | ')})`] : []),
    ],
    ...(run.screenshotUrl ? { images: [{ url: run.screenshotUrl, alt: 'Live page screenshot', caption: 'Live page' }] } : {}),
    metrics: [
      { label: 'P0', value: run.summary?.bySeverity.P0 ?? 0 },
      { label: 'P1', value: run.summary?.bySeverity.P1 ?? 0 },
      { label: 'P2', value: run.summary?.bySeverity.P2 ?? 0 },
      { label: 'P3', value: run.summary?.bySeverity.P3 ?? 0 },
    ],
    sections: (['P0', 'P1', 'P2', 'P3'] as const).flatMap((severity) => {
      const findings = grouped[severity] ?? []
      if (findings.length === 0) return []
      return [{
        heading: `${severity} — ${findings.length}`,
        items: findings.map(findingLine),
      }]
    }),
  }]

  const uiActions: ChatUiAction[] = [
    {
      id: `design-audit-fix:${run.id}`,
      type: 'custom',
      actionId: 'design-audit:fix-it',
      label: 'Fix it',
      variant: 'primary',
      payload: { runId: run.id, url: run.url },
    },
    {
      id: `design-audit-ignore:${run.id}`,
      type: 'custom',
      actionId: 'design-audit:ignore',
      label: 'Ignore + reason',
      variant: 'secondary',
      payload: { runId: run.id },
    },
    {
      id: `design-audit-rerun:${run.id}`,
      type: 'custom',
      actionId: 'design-audit:rerun',
      label: 'Re-run',
      variant: 'secondary',
      payload: { runId: run.id, url: run.url },
    },
    {
      id: `open-design-audit:${run.id}`,
      type: 'open_context',
      label: 'Open design audit',
      variant: 'secondary',
      payload: { kind: 'design', id: run.id, label },
    },
  ]

  return {
    richParts,
    uiActions,
    contextRef: {
      type: 'design',
      id: run.id,
      label,
      origin: 'manual',
      summary: `${statusLabel} · ${run.url}${run.summary ? ` · ${severityCounts(run).join(' ')}` : ''}`,
    },
  }
}

/** Attaches the card's richParts + uiActions + contextRef to the in-flight assistant message. */
export async function attachDesignAuditCardToAssistantMessage(input: {
  orgId: string
  conversationId?: string | null
  responseMessageId?: string | null
  presentation: DesignAuditCardPresentation
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
      return !(record.type === DESIGN_AUDIT_CARD_PART_TYPE && record.id === `design-audit:${input.presentation.contextRef.id}`)
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
export async function handoffDesignAuditCardFromCreate(input: {
  orgId: string
  body: Record<string, unknown> | null | undefined
  run: DesignAuditRun
  label?: string
}): Promise<DesignAuditCardPresentation & { messagesAttach: { attached: boolean; reason?: string } }> {
  const presentation = buildDesignAuditCardPresentation({ run: input.run, label: input.label })
  const handoff: MessagesHandoffIds = parseMessagesHandoffIds(input.body ?? undefined)
  const messagesAttach = await attachDesignAuditCardToAssistantMessage({
    orgId: input.orgId,
    conversationId: handoff.conversationId,
    responseMessageId: handoff.responseMessageId,
    presentation,
  }).catch(() => ({ attached: false as const, reason: 'handoff_failed' }))
  return { ...presentation, messagesAttach }
}
