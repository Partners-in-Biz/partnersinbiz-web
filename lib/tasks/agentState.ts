import { type AgentStatus, type TaskStatus } from './types'

export type AgentColumnId = 'todo' | 'in_progress' | 'blocked' | 'review'

export function columnForAgentStatus(status: AgentStatus): AgentColumnId {
  switch (status) {
    case 'pending':
      return 'todo'
    case 'picked-up':
    case 'in-progress':
      return 'in_progress'
    case 'awaiting-input':
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'review'
  }
}

export function taskStatusForAgentStatus(status: AgentStatus): TaskStatus {
  switch (status) {
    case 'pending':
    case 'awaiting-input':
    case 'blocked':
      return 'todo'
    case 'picked-up':
    case 'in-progress':
      return 'in_progress'
    case 'done':
      return 'done'
  }
}

export function applyAgentColumnForCreate(
  value: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  const agentStatus = typeof value.agentStatus === 'string' ? value.agentStatus as AgentStatus : null
  if (!agentStatus) return
  if (body.columnId === undefined || body.columnId === null || body.columnId === '') {
    value.columnId = columnForAgentStatus(agentStatus)
  }
  if (agentStatus === 'done' && value.reviewStatus === undefined) {
    value.reviewStatus = 'pending'
  }
}

export function applyAgentColumnForUpdate(
  updates: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  const agentStatus = typeof updates.agentStatus === 'string' ? updates.agentStatus as AgentStatus : null
  if (!agentStatus || body.columnId !== undefined) return
  updates.columnId = columnForAgentStatus(agentStatus)
  if (agentStatus === 'done') updates.reviewStatus = 'pending'
}

export function applyStandaloneTaskStatusForAgentStatus(
  updates: Record<string, unknown>,
  body: Record<string, unknown>,
): void {
  const agentStatus = typeof updates.agentStatus === 'string' ? updates.agentStatus as AgentStatus : null
  if (!agentStatus || body.status !== undefined) return
  updates.status = taskStatusForAgentStatus(agentStatus)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function taskSpecFrom(value: Record<string, unknown>, existing?: Record<string, unknown>): string {
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : typeof existing?.title === 'string'
      ? existing.title.trim()
      : ''
  const description = typeof value.description === 'string' && value.description.trim()
    ? value.description.trim()
    : typeof existing?.description === 'string'
      ? existing.description.trim()
      : ''
  return [title, description].filter(Boolean).join('\n\n')
}

export function applyAgentDispatchDefaultsForStandaloneAssignment(
  value: Record<string, unknown>,
  body: Record<string, unknown>,
  existing?: Record<string, unknown>,
): void {
  const assignedTo = isRecord(value.assignedTo) ? value.assignedTo : null
  if (assignedTo?.type !== 'agent' || typeof assignedTo.id !== 'string' || !assignedTo.id.trim()) return

  const agentId = assignedTo.id.trim()
  if (body.assigneeAgentId === undefined && value.assigneeAgentId === undefined) {
    value.assigneeAgentId = agentId
  }
  if (body.agentStatus === undefined && value.agentStatus === undefined) {
    value.agentStatus = 'pending'
  }
  if (body.status === undefined && value.status === undefined) {
    value.status = 'todo'
  }
  applyAgentColumnForCreate(value, body)

  if (body.agentInput === undefined && value.agentInput === undefined) {
    const spec = taskSpecFrom(value, existing)
    if (spec) value.agentInput = { spec }
  }

  value.agentOutput = null
  value.agentConversationId = null
  value.agentHeartbeatAt = null
}

export function applyAgentTodoRequeue(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const hasAgent = typeof existing.assigneeAgentId === 'string' && existing.assigneeAgentId.trim().length > 0
  const movedToTodo = updates.columnId === 'todo'
  const callerDidNotSetStatus = body.agentStatus === undefined
  const currentStatus = typeof existing.agentStatus === 'string' ? existing.agentStatus : null
  const requeueable = currentStatus === 'done' || currentStatus === 'blocked' || currentStatus === 'awaiting-input'

  if (!hasAgent || !movedToTodo || !callerDidNotSetStatus || !requeueable) return updates

  return {
    ...updates,
    agentStatus: 'pending',
    status: body.status === undefined ? 'todo' : updates.status,
    reviewStatus: 'changes-requested',
    agentOutput: null,
    agentConversationId: null,
    agentHeartbeatAt: null,
  }
}
