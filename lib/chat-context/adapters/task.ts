import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import {
  normalizeTask,
  projectTaskChatActions,
  projectTaskSummary,
} from '@/lib/chat-context/adapters/project'
import type {
  ChatContextAction,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import { getProjectForUser } from '@/lib/projects/access'
import { buildProjectChatProgress } from '@/lib/projects/chatProgress'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { canApproveProjectGate } from '@/lib/projects/adminApprover'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function projectIdFrom(input: Parameters<ChatContextAdapter['resolve']>[0]): string {
  return clean(input.projectId, 200) || clean(input.contextReference?.metadata?.projectId, 200)
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function globalState(data: Record<string, unknown>): ContextDisplayState {
  const status = clean(data.status).toLowerCase()
  if (status === 'done' || status === 'completed') return 'complete'
  if (status === 'cancelled') return 'archived'
  if (status === 'in_progress') return 'running'
  if (clean(data.agentStatus) === 'blocked' || clean(data.agentStatus) === 'failed') return 'blocked'
  return 'ready'
}

function globalTaskActions(input: {
  taskId: string
  status: string
  role: string
}): ChatContextAction[] {
  if (input.role !== 'admin' || ['done', 'completed', 'cancelled'].includes(input.status)) return []
  return [{
    id: `complete-global-task:${input.taskId}`,
    label: 'Mark task complete',
    href: `/api/v1/tasks/${encodeURIComponent(input.taskId)}/complete`,
    method: 'POST',
    requiresApproval: true,
  }]
}

export const taskChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'task') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported task context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const projectId = projectIdFrom(input)

    if (!projectId) {
      const snap = await adminDb.collection('tasks').doc(input.id).get()
      if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
      const data = snap.data() ?? {}
      if (clean(data.orgId, 200) !== base.model.context.orgId || data.deleted === true) {
        return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
      }
      const status = clean(data.status) || 'todo'
      const actions = globalTaskActions({ taskId: snap.id, status, role: input.user.role })
      const href = `${input.user.role === 'client' ? '/portal/dashboard' : '/admin/dashboard'}?taskId=${encodeURIComponent(snap.id)}`
      const label = clean(data.title, 180) || clean(data.name, 180) || base.model.context.label
      return {
        ok: true,
        model: {
          context: { ...base.model.context, label, href },
          pulse: {
            label: 'Task',
            metrics: [
              { id: 'status', label: 'Status', value: titleCase(status) },
              { id: 'priority', label: 'Priority', value: titleCase(clean(data.priority) || 'normal') },
              { id: 'assignee', label: 'Assignee', value: clean(data.assigneeName) || clean((data.assignedTo as Record<string, unknown> | undefined)?.id) || 'Unassigned' },
            ],
            headline: clean(data.description, 300),
          },
          groups: [{
            id: 'task',
            label: 'Task',
            items: [{
              id: snap.id,
              label,
              state: globalState(data),
              detail: clean(data.description, 300),
              href,
              ...(actions.length > 0 ? { actions } : {}),
            }],
          }],
          artifacts: [],
          attention: [],
          activity: base.model.activity,
          preview: {
            kind: 'summary',
            text: clean(data.description, 700),
            status,
          },
          capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : [])],
          asOf: new Date().toISOString(),
        },
      }
    }

    const access = await getProjectForUser(projectId, input.user)
    if (!access.ok) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const projectData = access.doc.data() ?? {}
    const snapshot = await adminDb.collection('projects').doc(projectId).collection('tasks').get()
    const visibleTasks = filterProjectItemsForAccess(
      snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
      { projectAccess: access.projectAccess, user: input.user },
    ).map((task) => normalizeTask(task as Record<string, unknown>))
    const progress = buildProjectChatProgress({
      project: {
        id: projectId,
        name: clean(projectData.name) || clean(projectData.title) || 'Untitled project',
        status: clean(projectData.status) || undefined,
      },
      tasks: visibleTasks,
    })
    const task = progress.tasks.find((item) => item.id === input.id)
    if (!task) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const canWrite = canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')
    const actions = projectTaskChatActions({
      projectId,
      task,
      canWrite,
      canApprove: canWrite && await canApproveProjectGate(input.user, task.approvalGate),
    })
    const href = `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(task.id)}`
    const item = { ...projectTaskSummary(task, actions), href }
    const dependencyCount = task.unresolvedDependencyIds.length
    const attention: ContextAttentionSummary[] = task.state === 'needs_input' || task.state === 'blocked' || task.state === 'review'
      ? [{
          id: `task-attention:${task.id}`,
          label: task.state === 'review' ? 'Task is ready for review' : task.state === 'blocked' ? 'Task is blocked' : 'Task needs input',
          state: task.state === 'review' ? 'review' : task.state,
          detail: item.detail,
          href,
          ...(actions.length > 0 ? { actions } : {}),
        }]
      : []

    return {
      ok: true,
      model: {
        context: { ...base.model.context, label: task.title, href },
        pulse: {
          label: 'Project task',
          metrics: [
            { id: 'state', label: 'State', value: titleCase(task.state) },
            { id: 'priority', label: 'Priority', value: titleCase(clean(task.priority) || 'normal') },
            { id: 'dependencies', label: 'Open dependencies', value: dependencyCount },
            { id: 'agent', label: 'Agent', value: clean(task.assigneeAgentId) || 'Unassigned' },
            ...(clean(task.reviewStatus) ? [{ id: 'review', label: 'Review', value: titleCase(clean(task.reviewStatus)) }] : []),
          ],
          headline: clean(task.description, 300) || item.agent?.summary,
          ...(attention[0] ? { next: item } : {}),
        },
        groups: [{ id: 'task', label: 'Task', items: [item] }],
        artifacts: [],
        attention,
        activity: base.model.activity,
        preview: {
          kind: 'summary',
          text: clean(task.description, 700) || item.agent?.summary,
          status: task.state,
        },
        relationships: [{
          kind: 'project',
          id: projectId,
          label: progress.project.name,
          relation: 'Project',
          href: `/portal/projects/${encodeURIComponent(projectId)}`,
        }],
        capabilities: ['open', 'preview', 'agent-status', 'dependencies', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
