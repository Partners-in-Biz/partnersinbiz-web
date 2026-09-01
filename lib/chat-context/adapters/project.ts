import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { buildProjectChatProgress, type ProjectChatTaskItem, type ProjectChatTaskSource } from '@/lib/projects/chatProgress'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { taskOrderMillis } from '@/lib/projects/taskPayload'
import { canApproveProjectGate } from '@/lib/projects/adminApprover'
import type { AgentArtifact, AgentOutput } from '@/lib/projects/types'
import type {
  ChatContextAction,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
  ContextItemAgentSnapshot,
  ContextItemSummary,
} from '@/lib/chat-context/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { canAccessConversation } from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import { getProjectConversationComputerLinkStatus } from '@/lib/project-locations/auto-link-conversation-computer'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  return cleanString(value) || undefined
}

function knownString<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  const normalized = cleanString(value)
  return allowed.includes(normalized as T[number]) ? normalized as T[number] : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = cleanString(item)
    return normalized ? [normalized] : []
  })
}

const COLUMN_IDS = ['todo', 'in_progress', 'review', 'done', 'blocked'] as const
const AGENT_STATUSES = ['pending', 'picked-up', 'in-progress', 'awaiting-input', 'blocked', 'failed', 'done'] as const
const REVIEW_STATUSES = ['pending', 'in-progress', 'approved', 'changes-requested', 'rejected'] as const
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const
const RELEASE_STATUSES = ['scheduled', 'released', 'cancelled'] as const
const ARTIFACT_TYPES = ['url', 'file', 'commit', 'message-thread', 'doc'] as const

function normalizeAgentOutput(value: unknown): AgentOutput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const summary = optionalString(raw.summary)
  const artifacts: AgentArtifact[] = Array.isArray(raw.artifacts)
    ? raw.artifacts.flatMap((item): AgentArtifact[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const entry = item as Record<string, unknown>
        const type = knownString(entry.type, ARTIFACT_TYPES) ?? 'url'
        const ref = optionalString(entry.ref)
        if (!ref) return []
        const label = optionalString(entry.label)
        return [{ type, ref, ...(label ? { label } : {}) }]
      })
    : []
  if (!summary && artifacts.length === 0) return undefined
  return {
    summary: summary ?? '',
    ...(artifacts.length > 0 ? { artifacts } : {}),
  }
}

export function normalizeTask(task: Record<string, unknown>): ProjectChatTaskSource {
  const agentInput = task.agentInput && typeof task.agentInput === 'object' && !Array.isArray(task.agentInput)
    ? task.agentInput as Record<string, unknown>
    : null
  return {
    id: cleanString(task.id),
    title: optionalString(task.title),
    description: optionalString(task.description),
    priority: optionalString(task.priority),
    columnId: knownString(task.columnId, COLUMN_IDS),
    agentStatus: knownString(task.agentStatus, AGENT_STATUSES),
    assigneeAgentId: optionalString(task.assigneeAgentId),
    reviewerAgentId: optionalString(task.reviewerAgentId),
    reviewerIds: stringArray(task.reviewerIds),
    reviewStatus: knownString(task.reviewStatus, REVIEW_STATUSES),
    approvalGateTaskId: optionalString(task.approvalGateTaskId),
    approvalStatus: knownString(task.approvalStatus, APPROVAL_STATUSES),
    agentReleaseStatus: knownString(task.agentReleaseStatus, RELEASE_STATUSES),
    dependsOn: stringArray(task.dependsOn),
    labels: stringArray(task.labels),
    agentConversationId: optionalString(task.agentConversationId) ?? null,
    agentOutput: normalizeAgentOutput(task.agentOutput),
    agentInput: agentInput && optionalString(agentInput.spec)
      ? { spec: optionalString(agentInput.spec)! }
      : undefined,
    updatedAt: task.updatedAt,
  }
}

function updatedAt(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date }
    try { return timestamp.toDate?.().toISOString() } catch { return undefined }
  }
  return undefined
}

export function projectTaskChatActions(input: {
  projectId: string
  task: ProjectChatTaskItem
  canWrite: boolean
  canApprove: boolean
}): ChatContextAction[] {
  if (!input.canWrite) return []
  const taskHref = `/api/v1/projects/${encodeURIComponent(input.projectId)}/tasks/${encodeURIComponent(input.task.id)}`
  if (input.task.approvalStatus === 'pending') {
    return input.canApprove ? [{
      id: `approve:${input.task.id}`,
      label: 'Approve next step',
      href: taskHref,
      method: 'PATCH',
      requiresApproval: true,
      body: { approvalStatus: 'approved' },
    }] : []
  }
  if (input.task.state === 'review') {
    return [{
      id: `approve-review:${input.task.id}`,
      label: 'Approve and complete',
      href: taskHref,
      method: 'PATCH',
      requiresApproval: true,
      body: { reviewStatus: 'approved', columnId: 'done' },
    }]
  }
  const canUnblock = input.task.agentStatus === 'blocked'
    || input.task.agentStatus === 'awaiting-input'
    || input.task.columnId === 'blocked'
  return canUnblock ? [{
    id: `unblock:${input.task.id}`,
    label: input.task.assigneeAgentId ? 'Unblock and requeue' : 'Clear blocker',
    href: `${taskHref}/unblock`,
    method: 'POST',
    requiresApproval: true,
  }] : []
}

export function projectTaskSummary(task: ProjectChatTaskItem, actions: ChatContextAction[] = []): ContextItemSummary {
  const dependencyDetail = task.unresolvedDependencyIds.length > 0
    ? `Waiting for ${task.unresolvedDependencyIds.length} dependenc${task.unresolvedDependencyIds.length === 1 ? 'y' : 'ies'}`
    : undefined
  const agentSummary = optionalString(task.agentOutput?.summary)
  const inputSpec = optionalString(task.agentInput && typeof task.agentInput === 'object'
    ? (task.agentInput as { spec?: unknown }).spec
    : undefined)
  const artifacts: NonNullable<ContextItemAgentSnapshot['artifacts']> = Array.isArray(task.agentOutput?.artifacts)
    ? task.agentOutput!.artifacts!.flatMap((item) => {
        const type = optionalString(item.type) ?? 'url'
        const ref = optionalString(item.ref)
        if (!ref) return []
        const label = optionalString(item.label)
        return [{ type, ref, ...(label ? { label } : {}) }]
      })
    : []
  const conversationId = optionalString(task.agentConversationId) ?? null
  const agentId = optionalString(task.assigneeAgentId)
  const agentStatus = optionalString(task.agentStatus)
  const agent: ContextItemAgentSnapshot | undefined = (agentId || agentStatus || agentSummary || conversationId)
    ? {
        ...(agentId ? { agentId } : {}),
        ...(agentStatus ? { agentStatus } : {}),
        conversationId,
        ...(agentSummary ? { summary: agentSummary } : {}),
        ...(inputSpec ? { inputSpec } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {}),
      }
    : undefined

  return {
    id: task.id,
    label: task.title,
    state: task.state as ContextDisplayState,
    detail: dependencyDetail
      || (task.state === 'running' && agentSummary ? agentSummary : undefined)
      || (task.state === 'complete' && agentSummary ? agentSummary : undefined)
      || (task.state === 'needs_input' && agentSummary ? agentSummary : undefined)
      || (task.state === 'blocked' && agentSummary ? agentSummary : undefined)
      || undefined,
    updatedAt: updatedAt(task.updatedAt),
    agent,
    ...(actions.length > 0 ? { actions } : {}),
  }
}

export function projectRoutineActivity(tasks: ProjectChatTaskItem[]): ContextActivitySummary[] {
  return tasks.flatMap((task) => {
    const type = task.state === 'ready' ? 'pickup'
      : task.state === 'running' ? 'running'
        : task.state === 'waiting' || task.state === 'review' ? 'waiting'
          : null
    const occurredAt = updatedAt(task.updatedAt)
    return type && occurredAt ? [{ id: `project-task:${task.id}`, type, label: task.title, occurredAt }] : []
  })
}

/**
 * One-click action to create the project↔computer location replica for the
 * computer bound on the Messages conversation (so agent turns can execute).
 */
export function projectLinkToConversationComputerAction(input: {
  projectId: string
  conversationId: string
  computerLabel?: string
}): ChatContextAction {
  const computer = optionalString(input.computerLabel)
  return {
    id: 'link-to-chat-computer',
    label: computer ? `Link to ${computer}` : 'Link to this computer',
    href: `/api/v1/projects/${encodeURIComponent(input.projectId)}/link-to-conversation`,
    method: 'POST',
    body: { conversationId: input.conversationId },
  }
}

export async function resolveProjectConversationComputerAttention(input: {
  projectId: string
  conversationId: string
  orgId: string
  actorUserId: string
  canWrite: boolean
  workspaceContext: Parameters<typeof getProjectConversationComputerLinkStatus>[0]['workspaceContext']
}): Promise<ContextAttentionSummary | null> {
  if (!input.canWrite || !input.conversationId) return null

  const linkStatus = await getProjectConversationComputerLinkStatus({
    projectId: input.projectId,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    workspaceContext: input.workspaceContext,
  })

  if (linkStatus.status !== 'not_linked') return null

  const computer = optionalString(linkStatus.computerLabel) ?? 'this chat’s computer'
  return {
    id: 'project-computer-link',
    label: `Project is not on ${computer}`,
    state: 'needs_input',
    detail: 'Link this project to the computer bound on this chat so agents can run tasks, sync files, and write AGENTS.md on that machine.',
    actions: [projectLinkToConversationComputerAction({
      projectId: input.projectId,
      conversationId: input.conversationId,
      computerLabel: linkStatus.computerLabel,
    })],
  }
}

export const projectChatContextAdapter: ChatContextAdapter = {
  async resolve({ id: projectId, user, conversationId }) {
    const access = await getProjectForUser(projectId, user)
    if (!access.ok) {
      return {
        ok: false,
        reason: access.status === 403 ? 'forbidden' : 'not_found',
        status: access.status,
        error: access.error,
      }
    }

    const projectData = access.doc.data() ?? {}
    const snapshot = await adminDb.collection('projects').doc(projectId).collection('tasks').get()
    const visibleTasks = filterProjectItemsForAccess(
      snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
      { projectAccess: access.projectAccess, user },
    ).sort((left, right) => taskOrderMillis((left as Record<string, unknown>).order) - taskOrderMillis((right as Record<string, unknown>).order))
      .map((task) => normalizeTask(task as Record<string, unknown>))

    // This remains the single source of truth for task state and progress classification.
    const progress = buildProjectChatProgress({
      project: {
        id: projectId,
        name: cleanString(projectData.name) || cleanString(projectData.title) || 'Untitled project',
        status: cleanString(projectData.status) || undefined,
      },
      tasks: visibleTasks,
    })
    const asOf = new Date().toISOString()
    const canWrite = canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')
    const actionsByTaskId = new Map(
      await Promise.all(progress.tasks.map(async (task) => [
        task.id,
        projectTaskChatActions({
          projectId,
          task,
          canWrite,
          canApprove: canWrite && await canApproveProjectGate(user, task.approvalGate),
        }),
      ] as const)),
    )

    const orgId = cleanString(projectData.orgId) || cleanString(projectData.ownerOrgId) || ''
    const attention: ContextAttentionSummary[] = []
    if (progress.attention) {
      attention.push({
        id: progress.attention.id,
        label: progress.attention.title,
        state: progress.attention.state === 'needs_input' ? 'needs_input' : 'blocked',
        actions: actionsByTaskId.get(progress.attention.id),
      })
    }

    const conversationIdClean = optionalString(conversationId)
    if (conversationIdClean) {
      try {
        const conversation = await getConversation(conversationIdClean)
        // conversationId is presentation scope only — re-authorise before using it.
        if (conversation && canAccessConversation(user, conversation)) {
          const computerAttention = await resolveProjectConversationComputerAttention({
            projectId,
            conversationId: conversationIdClean,
            orgId: conversation.orgId || orgId,
            actorUserId: user.uid,
            canWrite,
            workspaceContext: conversation.workspaceContext,
          })
          if (computerAttention) attention.unshift(computerAttention)
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('[project-chat-context-computer-link]', error)
        }
      }
    }

    const hasInlineActions = Array.from(actionsByTaskId.values()).some((actions) => actions.length > 0)
      || attention.some((item) => (item.actions?.length ?? 0) > 0)

    return {
      ok: true,
      model: {
        context: {
          kind: 'project',
          id: projectId,
          orgId,
          label: progress.project.name,
          icon: 'account_tree',
          href: `/portal/projects/${encodeURIComponent(projectId)}`,
        },
        pulse: {
          label: `${progress.counts.complete} of ${progress.counts.total} complete`,
          progress: { complete: progress.counts.complete, total: progress.counts.total },
          metrics: [
            { id: 'running', label: 'Running', value: progress.counts.running },
            { id: 'waiting', label: 'Waiting', value: progress.counts.waiting },
            { id: 'needs-you', label: 'Needs you', value: progress.counts.needsYou },
            { id: 'blocked', label: 'Blocked', value: progress.counts.blocked },
          ],
          next: progress.next ? projectTaskSummary(progress.next, actionsByTaskId.get(progress.next.id)) : undefined,
        },
        groups: progress.tasks.length > 0
          ? [{
              id: 'tasks',
              label: 'Tasks',
              items: progress.tasks.map((task) => ({
                ...projectTaskSummary(task, actionsByTaskId.get(task.id)),
                href: `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(task.id)}`,
              })),
            }]
          : [],
        artifacts: [],
        attention,
        activity: projectRoutineActivity(progress.tasks),
        capabilities: ['view', ...(hasInlineActions ? ['inline-actions'] : [])],
        asOf,
      },
    }
  },
}
