export interface DispatchEligibilityTask {
  assigneeAgentId?: string | null
  agentStatus?: string | null
  columnId?: string | null
  status?: string | null
  deleted?: boolean | null
  requiresApproval?: boolean | null
  approvalStatus?: string | null
  approvalGate?: { status?: string | null } | null
}

export interface DependencyState {
  agentStatus?: string | null
  columnId?: string | null
}

export type DispatchBlocker =
  | 'invalid-assignee'
  | 'not-pending'
  | 'not-todo'
  | 'deleted'
  | 'cancelled'
  | 'approval-pending'

const APPROVED_STATUSES = new Set(['approved', 'accepted', 'resolved'])

export function getApprovalStatus(task: DispatchEligibilityTask): string | null {
  const direct = typeof task.approvalStatus === 'string' ? task.approvalStatus.trim().toLowerCase() : ''
  if (direct) return direct
  const gate = typeof task.approvalGate?.status === 'string' ? task.approvalGate.status.trim().toLowerCase() : ''
  return gate || null
}

export function hasPendingApprovalGate(task: DispatchEligibilityTask): boolean {
  const status = getApprovalStatus(task)
  if (task.requiresApproval === true) return !status || !APPROVED_STATUSES.has(status)
  if (!status) return false
  return !APPROVED_STATUSES.has(status)
}

export function getTaskDispatchBlocker(
  task: DispatchEligibilityTask,
  validAgentIds: readonly string[],
): DispatchBlocker | null {
  if (!task.assigneeAgentId || !validAgentIds.includes(task.assigneeAgentId)) return 'invalid-assignee'
  if (task.deleted === true) return 'deleted'
  if (task.status === 'cancelled' || task.status === 'canceled') return 'cancelled'
  if (task.agentStatus !== 'pending') return 'not-pending'
  if (task.columnId !== 'todo') return 'not-todo'
  if (hasPendingApprovalGate(task)) return 'approval-pending'
  return null
}

export function isDependencyResolved(dep: DependencyState | null | undefined): boolean {
  if (!dep) return false
  return dep.columnId === 'done' || dep.agentStatus === 'done'
}

export function getUnresolvedDependencyIds(
  dependencyIds: readonly string[] | undefined,
  dependenciesById: Record<string, DependencyState | null | undefined>,
): string[] {
  if (!dependencyIds || dependencyIds.length === 0) return []
  const unresolved: string[] = []
  for (const dependencyId of dependencyIds) {
    if (!dependencyId) continue
    if (!isDependencyResolved(dependenciesById[dependencyId])) unresolved.push(dependencyId)
  }
  return unresolved
}
