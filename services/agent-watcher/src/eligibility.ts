export interface DispatchEligibilityTask {
  assigneeAgentId?: string | null
  agentStatus?: string | null
  columnId?: string | null
  status?: string | null
  deleted?: boolean | null
  requiresApproval?: boolean | null
  approvalStatus?: string | null
  approvalGate?: string | { status?: string | null } | null
  agentReleaseAt?: string | number | { toMillis?: () => number; toDate?: () => Date } | null
  agentReleaseStatus?: string | null
  agentRetryAt?: string | number | { toMillis?: () => number; toDate?: () => Date } | null
}

export interface DependencyState {
  agentStatus?: string | null
  columnId?: string | null
  reviewerAgentId?: string | null
  reviewStatus?: string | null
  approvalStatus?: string | null
  approvalGate?: string | { status?: string | null } | null
  labels?: string[] | null
}

export type DispatchBlocker =
  | 'invalid-assignee'
  | 'not-pending'
  | 'not-todo'
  | 'deleted'
  | 'cancelled'
  | 'approval-pending'
  | 'scheduled-release-pending'
  | 'retry-backoff-pending'

const APPROVED_STATUSES = new Set(['approved', 'accepted', 'resolved'])

export function getApprovalStatus(task: DispatchEligibilityTask): string | null {
  const direct = typeof task.approvalStatus === 'string' ? task.approvalStatus.trim().toLowerCase() : ''
  if (direct) return direct
  const gate = typeof task.approvalGate === 'object' && typeof task.approvalGate?.status === 'string'
    ? task.approvalGate.status.trim().toLowerCase()
    : ''
  return gate || null
}

export function hasPendingApprovalGate(task: DispatchEligibilityTask): boolean {
  const status = getApprovalStatus(task)
  const persistedGate = typeof task.approvalGate === 'string' ? task.approvalGate.trim().toLowerCase() : ''
  if (persistedGate && persistedGate !== 'none') return status !== 'approved'
  if (task.requiresApproval === true) return !status || !APPROVED_STATUSES.has(status)
  if (!status) return false
  return !APPROVED_STATUSES.has(status)
}

export function releaseMillis(value: DispatchEligibilityTask['agentReleaseAt']): number | null {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      try { return value.toMillis() } catch { return null }
    }
    if (typeof value.toDate === 'function') {
      try { return value.toDate().getTime() } catch { return null }
    }
  }
  return null
}

export function hasPendingScheduledRelease(task: DispatchEligibilityTask, now = Date.now()): boolean {
  if (task.agentReleaseStatus !== 'scheduled') return false
  const releaseAt = releaseMillis(task.agentReleaseAt)
  return releaseAt !== null && releaseAt > now
}

export function hasPendingAgentRetry(task: DispatchEligibilityTask, now = Date.now()): boolean {
  const retryAt = releaseMillis(task.agentRetryAt)
  return retryAt !== null && retryAt > now
}

export function getTaskDispatchBlocker(
  task: DispatchEligibilityTask,
  validAgentIds: readonly string[],
  now = Date.now(),
): DispatchBlocker | null {
  if (!task.assigneeAgentId || !validAgentIds.includes(task.assigneeAgentId)) return 'invalid-assignee'
  if (task.deleted === true) return 'deleted'
  if (task.status === 'cancelled' || task.status === 'canceled') return 'cancelled'
  if (task.agentStatus !== 'pending') return 'not-pending'
  if (task.columnId !== 'todo') return 'not-todo'
  if (hasPendingScheduledRelease(task, now)) return 'scheduled-release-pending'
  if (hasPendingAgentRetry(task, now)) return 'retry-backoff-pending'
  if (hasPendingApprovalGate(task)) return 'approval-pending'
  return null
}

export function isDependencyResolved(dep: DependencyState | null | undefined): boolean {
  if (!dep) return false
  if (isApprovalGateDependency(dep) && normalizedApprovalStatus(dep.approvalStatus) !== 'approved') return false
  // Board Done is the accepted handoff signal. Cards can land in Done with a stale
  // reviewStatus=pending after a manual drag; that must still unblock dependents.
  if (dep.columnId === 'done') return true
  if (dep.reviewerAgentId) return dep.agentStatus === 'done' && dep.reviewStatus === 'approved'
  return dep.agentStatus === 'done'
}

function normalizedApprovalStatus(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

function isApprovalGateDependency(dep: DependencyState): boolean {
  const stringGate = typeof dep.approvalGate === 'string' ? dep.approvalGate.trim().toLowerCase() : ''
  const objectGate = typeof dep.approvalGate === 'object' && dep.approvalGate !== null
  return Boolean(
    (stringGate && stringGate !== 'none')
    || objectGate
    || typeof dep.approvalStatus === 'string'
    // Match exact gate labels / approval-gate:<id>. Do not match topic labels like
    // "approval-gates" (module contracts that mention gates as scope).
    || dep.labels?.some((label) => /^(approval-gate|approval-required|client-approval|required-approval)(:.*)?$/i.test(String(label || '').trim())),
  )
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

export function getTaskDependencyGateIds(
  dependencyIds: readonly string[] | undefined,
  approvalGateTaskId: string | null | undefined,
): string[] {
  const ids = new Set<string>()
  for (const dependencyId of dependencyIds ?? []) {
    const normalized = typeof dependencyId === 'string' ? dependencyId.trim() : ''
    if (normalized) ids.add(normalized)
  }
  const gateId = typeof approvalGateTaskId === 'string' ? approvalGateTaskId.trim() : ''
  if (gateId) ids.add(gateId)
  return Array.from(ids)
}

export function getUnresolvedTaskDependencyGateIds(
  dependencyIds: readonly string[] | undefined,
  approvalGateTaskId: string | null | undefined,
  dependenciesById: Record<string, DependencyState | null | undefined>,
): string[] {
  const ordinaryDependencies = new Set(getTaskDependencyGateIds(dependencyIds, null))
  const gateId = typeof approvalGateTaskId === 'string' ? approvalGateTaskId.trim() : ''
  return getTaskDependencyGateIds(dependencyIds, gateId).filter((dependencyId) => {
    const dependency = dependenciesById[dependencyId]
    if (ordinaryDependencies.has(dependencyId) && !isDependencyResolved(dependency)) return true
    if (gateId === dependencyId && normalizedApprovalStatus(dependency?.approvalStatus) !== 'approved') return true
    return false
  })
}
