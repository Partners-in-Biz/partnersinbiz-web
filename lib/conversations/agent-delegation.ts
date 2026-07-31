/**
 * Chat-native @agent / handoff → isolated subagent branch orchestration.
 *
 * Hermes-style rules:
 * - Parent supplies full goal + context only
 * - Child starts with a fresh context (no parent history dump)
 * - Leaf children do not re-delegate by default
 * - Only the structured summary re-enters the parent thread
 */
import type { Mention } from '@/lib/comments/types'
import type { RichMessagePart } from '@/lib/hermes/types'
import type {
  DelegationChild,
  DelegationChildStatus,
  DelegationGoalInput,
} from '@/lib/hermes-features/types'
import type { DelegationRecord } from '@/lib/hermes-features/repository'
import type { ConversationMessage } from './types'

export const AGENT_DELEGATION_BRANCH_PART = 'agent_delegation_branch' as const

export interface ChatDelegationBranchChild {
  id: string
  agentId: string
  goal: string
  context?: string
  status: DelegationChildStatus
  result?: string
  runId?: string
  runDocId?: string
}

export interface ChatDelegationBranchPart {
  type: typeof AGENT_DELEGATION_BRANCH_PART
  id: string
  title: string
  delegationId: string
  conversationId?: string
  parentRunHint: string
  parentAgentId: string
  children: ChatDelegationBranchChild[]
  status: DelegationChildStatus | 'partial'
  summary?: string
}

export function extractAgentMentionsForDelegation(
  mentions: Mention[] | undefined,
  options: {
    /** Primary conversation dispatcher — kept on the main turn, not branched. */
    excludeAgentIds?: string[]
  } = {},
): string[] {
  const excluded = new Set((options.excludeAgentIds ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean))
  const seen = new Set<string>()
  const agentIds: string[] = []
  for (const mention of mentions ?? []) {
    if (mention.type !== 'agent') continue
    const id = mention.id.trim()
    if (!id) continue
    const key = id.toLowerCase()
    if (excluded.has(key) || seen.has(key)) continue
    seen.add(key)
    agentIds.push(id)
  }
  return agentIds
}

/**
 * Build isolated goal+context packages for each tagged specialist.
 * Parent must pass everything the child needs — no shared conversation history.
 */
export function buildChatDelegationGoals(input: {
  agentIds: string[]
  messageContent: string
  parentAgentId?: string | null
  parentMessageId?: string
  conversationId: string
  actorDisplayName?: string
  extraContext?: string
}): DelegationGoalInput[] {
  const content = input.messageContent.trim()
  const baseContext = [
    `conversationId: ${input.conversationId}`,
    input.parentMessageId ? `parentMessageId: ${input.parentMessageId}` : null,
    input.parentAgentId ? `parentAgent: ${input.parentAgentId}` : null,
    input.actorDisplayName ? `requestedBy: ${input.actorDisplayName}` : null,
    input.extraContext?.trim() || null,
    '',
    'Original request:',
    content || '(empty)',
  ].filter((line): line is string => line !== null).join('\n')

  return input.agentIds.map((agentId) => ({
    agentId,
    goal: content
      ? `Handle the work tagged for @agent:${agentId} from the parent Messages thread.`
      : `Assist on the work assigned to @agent:${agentId}.`,
    context: [
      baseContext,
      '',
      `You are the specialist agent "${agentId}". Stay in your domain.`,
      'Return a structured summary only — do not re-delegate.',
    ].join('\n'),
  }))
}

export function overallDelegationStatus(
  children: Array<{ status: DelegationChildStatus }>,
): ChatDelegationBranchPart['status'] {
  if (children.length === 0) return 'failed'
  if (children.every((c) => c.status === 'done')) return 'done'
  if (children.every((c) => c.status === 'failed' || c.status === 'unknown')) return 'failed'
  if (children.some((c) => c.status === 'running' || c.status === 'queued')) {
    return children.some((c) => c.status === 'done' || c.status === 'failed' || c.status === 'unknown')
      ? 'partial'
      : children.some((c) => c.status === 'running') ? 'running' : 'queued'
  }
  return 'partial'
}

export function branchChildrenFromRecord(record: DelegationRecord): ChatDelegationBranchChild[] {
  return record.children.map((child) => ({
    id: child.id,
    agentId: child.agentId || record.agentId,
    goal: child.goal,
    ...(child.context ? { context: child.context } : {}),
    status: child.status,
    ...(child.result ? { result: child.result } : {}),
    ...(child.runId ? { runId: child.runId } : {}),
    ...(child.runDocId ? { runDocId: child.runDocId } : {}),
  }))
}

export function buildAgentDelegationBranchPart(record: DelegationRecord): ChatDelegationBranchPart {
  const children = branchChildrenFromRecord(record)
  return {
    type: AGENT_DELEGATION_BRANCH_PART,
    id: `branch_${record.id}`,
    title: children.length === 1
      ? `Branch · @${children[0].agentId}`
      : `Branch · ${children.length} specialists`,
    delegationId: record.id,
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    parentRunHint: record.parentRunHint,
    parentAgentId: record.agentId,
    children,
    status: overallDelegationStatus(children),
  }
}

export function buildDelegationBranchSystemMessage(input: {
  conversationId: string
  record: DelegationRecord
  authorDisplayName?: string
}): Omit<ConversationMessage, 'id' | 'createdAt'> {
  const part = buildAgentDelegationBranchPart(input.record)
  const lines = part.children.map((child) => {
    const badge = child.status.toUpperCase()
    return `· ${child.agentId} [${badge}] ${child.goal.slice(0, 120)}`
  })
  return {
    conversationId: input.conversationId,
    role: 'system',
    content: [
      `Subagent branch opened (${part.status})`,
      ...lines,
      'Only structured child summaries re-enter this thread when complete.',
    ].join('\n'),
    richParts: [part as unknown as RichMessagePart],
    authorKind: 'system',
    authorId: 'system',
    authorDisplayName: input.authorDisplayName || 'Delegation',
    status: 'completed',
  }
}

export function buildChildSummaryParentMessage(input: {
  conversationId: string
  record: DelegationRecord
  childId: string
}): Omit<ConversationMessage, 'id' | 'createdAt'> | null {
  const child = input.record.children.find((c) => c.id === input.childId)
  if (!child) return null
  const agentId = child.agentId || input.record.agentId
  const part = buildAgentDelegationBranchPart(input.record)
  const ok = child.status === 'done'
  const headline = ok
    ? `@${agentId} finished their branch`
    : child.status === 'unknown'
      ? `@${agentId} branch state is unknown`
      : `@${agentId} branch failed`
  const summary = (child.result || '').trim() || (ok ? 'Completed without a text summary.' : 'No error detail provided.')
  return {
    conversationId: input.conversationId,
    role: 'assistant',
    content: [
      headline,
      '',
      summary,
    ].join('\n'),
    richParts: [
      {
        ...part,
        summary,
      } as unknown as RichMessagePart,
    ],
    authorKind: 'agent',
    authorId: agentId,
    authorDisplayName: agentId,
    status: ok ? 'completed' : 'failed',
    ...(child.runId ? { runId: child.runId } : {}),
    ...(child.runDocId ? { runDocId: child.runDocId } : {}),
    dispatchAgentId: agentId as ConversationMessage['dispatchAgentId'],
  }
}

/** Pure transition: apply child completion onto a branch part snapshot. */
export function applyChildCompletionToBranch(
  part: ChatDelegationBranchPart,
  childId: string,
  result: string,
  ok: boolean,
): ChatDelegationBranchPart {
  const children = part.children.map((child) => (
    child.id === childId
      ? { ...child, status: (ok ? 'done' : 'failed') as DelegationChildStatus, result }
      : child
  ))
  return {
    ...part,
    children,
    status: overallDelegationStatus(children),
    ...(children.every((c) => c.status === 'done' || c.status === 'failed' || c.status === 'unknown')
      ? { summary: children.map((c) => `@${c.agentId}: ${(c.result || c.status).slice(0, 200)}`).join('\n') }
      : {}),
  }
}

