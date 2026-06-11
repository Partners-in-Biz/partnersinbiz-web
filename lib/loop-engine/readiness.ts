import type { LoopRiskLevel } from './registry'

export type LoopTaskReadinessInput = {
  id?: string | null
  title?: string | null
  columnId?: string | null
  status?: string | null
  assigneeAgentId?: string | null
  agentStatus?: string | null
  agentInput?: {
    spec?: unknown
    context?: Record<string, unknown>
  } | null
  dependsOn?: unknown
  resolvedDependencyIds?: string[]
  reviewStatus?: string | null
  dueDate?: string | null
  scheduledFor?: string | null
  agentDisabled?: boolean
  riskLevel?: LoopRiskLevel | string | null
  requiredCapability?: string | null
  approvalGateTaskId?: string | null
  approvalGateStatus?: 'approved' | 'rejected' | 'pending' | 'missing' | string | null
}

export type LoopReadinessReason = {
  code: string
  label: string
  severity: 'blocker' | 'warning' | 'ready'
}

export type LoopReadinessResult = {
  eligible: boolean
  summary: string
  reasons: LoopReadinessReason[]
  requiredEvidence: string[]
}

const APPROVAL_SENSITIVE_CAPABILITIES = new Set([
  'approve',
  'publish',
  'deploy',
  'spend',
  'message_client',
  'access_secret',
  'delete',
  'finance',
])

const APPROVAL_SENSITIVE_RISKS = new Set(['high', 'critical'])

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function hasUsableSpec(task: LoopTaskReadinessInput): boolean {
  return typeof task.agentInput?.spec === 'string' && task.agentInput.spec.trim().length > 0
}

function isFutureIso(value: string | null | undefined, now: Date): boolean {
  if (!value) return false
  const millis = Date.parse(value)
  return Number.isFinite(millis) && millis > now.getTime()
}

function needsApproval(task: LoopTaskReadinessInput): boolean {
  const riskLevel = typeof task.riskLevel === 'string' ? task.riskLevel : null
  const capability = typeof task.requiredCapability === 'string' ? task.requiredCapability : null
  return Boolean(
    (riskLevel && APPROVAL_SENSITIVE_RISKS.has(riskLevel))
    || (capability && APPROVAL_SENSITIVE_CAPABILITIES.has(capability))
    || task.approvalGateTaskId,
  )
}

export function evidenceRequirementsForRisk(riskLevel: LoopRiskLevel | string | null | undefined): string[] {
  switch (riskLevel) {
    case 'critical':
      return [
        'Human approval id and exact approval wording',
        'Reviewer or second-review owner',
        'Artifact/output proof',
        'Rollback or stop condition',
      ]
    case 'high':
      return [
        'Approval gate id or explicit reviewer decision',
        'Artifact/output proof',
        'Test/check or source evidence',
      ]
    case 'medium':
      return ['Artifact/output proof', 'Relevant check or source evidence']
    case 'low':
    default:
      return ['Short summary', 'Artifact or source reference']
  }
}

export function explainTaskLoopReadiness(
  task: LoopTaskReadinessInput,
  options: { now?: Date } = {},
): LoopReadinessResult {
  const now = options.now ?? new Date()
  const reasons: LoopReadinessReason[] = []

  if (!task.assigneeAgentId) {
    reasons.push({ code: 'missing-agent', label: 'No assigneeAgentId is set', severity: 'blocker' })
  }

  if (task.agentDisabled) {
    reasons.push({ code: 'agent-disabled', label: 'Assigned agent is disabled or unhealthy', severity: 'blocker' })
  }

  if (task.columnId && task.columnId !== 'todo') {
    reasons.push({ code: 'not-in-todo', label: `Task is in ${task.columnId}, not todo`, severity: 'blocker' })
  }

  if (task.status && !['todo', 'in_progress'].includes(task.status)) {
    reasons.push({ code: 'closed-task-status', label: `Task status is ${task.status}`, severity: 'blocker' })
  }

  if (task.agentStatus !== 'pending') {
    reasons.push({
      code: 'agent-status-not-pending',
      label: `agentStatus is ${task.agentStatus ?? 'missing'}, not pending`,
      severity: 'blocker',
    })
  }

  if (!hasUsableSpec(task)) {
    reasons.push({ code: 'missing-spec', label: 'agentInput.spec is missing or empty', severity: 'blocker' })
  }

  const dependencies = stringArray(task.dependsOn)
  const resolved = new Set(task.resolvedDependencyIds ?? [])
  const unresolved = dependencies.filter((id) => !resolved.has(id))
  if (unresolved.length > 0) {
    reasons.push({
      code: 'unresolved-dependencies',
      label: `Unresolved dependencies: ${unresolved.join(', ')}`,
      severity: 'blocker',
    })
  }

  if (isFutureIso(task.scheduledFor, now) || isFutureIso(task.dueDate, now)) {
    reasons.push({ code: 'scheduled-future', label: 'Task is scheduled for the future', severity: 'blocker' })
  }

  if (task.reviewStatus === 'pending') {
    reasons.push({ code: 'review-pending', label: 'Task already has pending review output', severity: 'blocker' })
  }

  if (needsApproval(task) && task.approvalGateStatus !== 'approved') {
    reasons.push({
      code: 'approval-missing',
      label: `Approval-sensitive task is not approved (${task.approvalGateStatus ?? 'missing'})`,
      severity: 'blocker',
    })
  }

  if (reasons.length === 0) {
    reasons.push({ code: 'eligible', label: 'Task is eligible for the agent loop', severity: 'ready' })
  }

  const blockers = reasons.filter((reason) => reason.severity === 'blocker')
  const title = task.title ? `“${task.title}”` : task.id ? `task ${task.id}` : 'this task'

  return {
    eligible: blockers.length === 0,
    summary: blockers.length === 0
      ? `${title} is ready for the agent loop.`
      : `${title} is not ready: ${blockers.map((reason) => reason.label).join('; ')}.`,
    reasons,
    requiredEvidence: evidenceRequirementsForRisk(task.riskLevel),
  }
}
