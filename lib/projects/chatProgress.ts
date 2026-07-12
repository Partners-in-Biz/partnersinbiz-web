import type { AgentOutput, TaskChatOrigin } from '@/lib/projects/types'

export type ProjectChatTaskState =
  | 'ready'
  | 'running'
  | 'waiting'
  | 'needs_input'
  | 'blocked'
  | 'review'
  | 'complete'

export interface ProjectChatTaskSource {
  id: string
  title?: string
  columnId?: string
  agentStatus?: string | null
  assigneeAgentId?: string | null
  reviewerAgentId?: string | null
  reviewerIds?: string[]
  reviewStatus?: string | null
  approvalGateTaskId?: string | null
  approvalStatus?: string | null
  agentReleaseStatus?: string | null
  dependsOn?: string[]
  labels?: string[]
  agentModel?: string | null
  agentOutput?: AgentOutput
  chatOrigin?: TaskChatOrigin
  updatedAt?: unknown
  [key: string]: unknown
}

export interface ProjectChatTaskItem extends ProjectChatTaskSource {
  title: string
  state: ProjectChatTaskState
  unresolvedDependencyIds: string[]
}

export interface ProjectChatProgress {
  project: { id: string; name: string; status?: string }
  counts: {
    total: number
    complete: number
    running: number
    waiting: number
    blocked: number
    needsYou: number
    approvals: number
  }
  tasks: ProjectChatTaskItem[]
  attention?: ProjectChatTaskItem | null
  next: ProjectChatTaskItem | null
}

export function selectActiveProjectId(input: {
  scope?: string
  scopeRefId?: string
  contextRefs?: Array<{ type: string; id: string }>
}): string | null {
  if (input.scope === 'project' && input.scopeRefId?.trim()) return input.scopeRefId.trim()
  const projectRefs = (input.contextRefs ?? []).filter((ref) => ref.type === 'project' && ref.id.trim())
  return projectRefs.at(-1)?.id.trim() ?? null
}

function requiresReview(task: ProjectChatTaskSource): boolean {
  return Boolean(task.reviewerAgentId) || Boolean(task.reviewerIds?.length)
}

export function isProjectChatTaskComplete(task: ProjectChatTaskSource): boolean {
  if (!task.assigneeAgentId) return task.columnId === 'done'
  if (requiresReview(task)) return task.reviewStatus === 'approved'
  return task.agentStatus === 'done'
}

function taskState(
  task: ProjectChatTaskSource,
  tasksById: Map<string, ProjectChatTaskSource>,
): Pick<ProjectChatTaskItem, 'state' | 'unresolvedDependencyIds'> {
  if (isProjectChatTaskComplete(task)) return { state: 'complete', unresolvedDependencyIds: [] }

  const dependencyIds = Array.from(new Set([
    ...(task.dependsOn ?? []),
    ...(task.approvalGateTaskId ? [task.approvalGateTaskId] : []),
  ]))
  const unresolvedDependencyIds = dependencyIds.filter((dependencyId) => {
    const dependency = tasksById.get(dependencyId)
    return !dependency || !isProjectChatTaskComplete(dependency)
  })
  if (unresolvedDependencyIds.length > 0) return { state: 'waiting', unresolvedDependencyIds }
  if (task.agentReleaseStatus === 'scheduled') return { state: 'waiting', unresolvedDependencyIds }

  if (task.agentStatus === 'awaiting-input' || task.approvalStatus === 'pending') {
    return { state: 'needs_input', unresolvedDependencyIds }
  }
  if (task.agentStatus === 'blocked' || task.agentStatus === 'failed' || task.columnId === 'blocked') {
    return { state: 'blocked', unresolvedDependencyIds }
  }
  if (task.agentStatus === 'picked-up' || task.agentStatus === 'in-progress' || task.columnId === 'in_progress') {
    return { state: 'running', unresolvedDependencyIds }
  }
  if (task.reviewStatus === 'pending' || task.reviewStatus === 'in-progress' || task.columnId === 'review') {
    return { state: 'review', unresolvedDependencyIds }
  }
  return { state: 'ready', unresolvedDependencyIds }
}

export function buildProjectChatProgress(input: {
  project: { id: string; name: string; status?: string }
  tasks: ProjectChatTaskSource[]
}): ProjectChatProgress {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]))
  const tasks = input.tasks.map((task): ProjectChatTaskItem => ({
    ...task,
    title: task.title?.trim() || 'Untitled task',
    ...taskState(task, tasksById),
  }))
  const count = (state: ProjectChatTaskState) => tasks.filter((task) => task.state === state).length
  const attention = tasks.find((task) => task.state === 'needs_input')
    ?? tasks.find((task) => task.state === 'blocked')
    ?? null
  const next = tasks.find((task) => task.state === 'ready') ?? null

  return {
    project: input.project,
    counts: {
      total: tasks.length,
      complete: count('complete'),
      running: count('running'),
      waiting: count('waiting'),
      blocked: count('blocked'),
      needsYou: count('needs_input'),
      approvals: tasks.filter((task) => task.approvalStatus === 'pending').length,
    },
    tasks,
    attention,
    next,
  }
}
