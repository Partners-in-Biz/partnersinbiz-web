import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { buildProjectChatProgress, type ProjectChatTaskItem, type ProjectChatTaskSource } from '@/lib/projects/chatProgress'
import { filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { taskOrderMillis } from '@/lib/projects/taskPayload'
import type { ContextDisplayState, ContextItemSummary } from '@/lib/chat-context/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  return cleanString(value) || undefined
}

function knownString(value: unknown, allowed: readonly string[]): string | undefined {
  const normalized = cleanString(value)
  return allowed.includes(normalized) ? normalized : undefined
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

function normalizeTask(task: Record<string, unknown>): ProjectChatTaskSource {
  return {
    id: cleanString(task.id),
    title: optionalString(task.title),
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

function summary(task: ProjectChatTaskItem): ContextItemSummary {
  return {
    id: task.id,
    label: task.title,
    state: task.state as ContextDisplayState,
    detail: task.unresolvedDependencyIds.length > 0
      ? `Waiting for ${task.unresolvedDependencyIds.length} dependenc${task.unresolvedDependencyIds.length === 1 ? 'y' : 'ies'}`
      : undefined,
    updatedAt: updatedAt(task.updatedAt),
  }
}

export const projectChatContextAdapter: ChatContextAdapter = {
  async resolve({ id: projectId, user }) {
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

    return {
      ok: true,
      model: {
        context: {
          kind: 'project',
          id: projectId,
          orgId: cleanString(projectData.orgId) || cleanString(projectData.ownerOrgId) || '',
          label: progress.project.name,
          icon: 'project',
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
          next: progress.next ? summary(progress.next) : undefined,
        },
        groups: progress.tasks.length > 0
          ? [{ id: 'tasks', label: 'Tasks', items: progress.tasks.map(summary) }]
          : [],
        artifacts: [],
        attention: progress.attention ? [{
          id: progress.attention.id,
          label: progress.attention.title,
          state: progress.attention.state === 'needs_input' ? 'needs_input' : 'blocked',
        }] : [],
        activity: [],
        capabilities: ['view'],
        asOf,
      },
    }
  },
}
