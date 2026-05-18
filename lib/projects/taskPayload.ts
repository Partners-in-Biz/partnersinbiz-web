import { isValidAgentId } from '@/lib/agents/types'

type PayloadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number }

const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'normal', 'low'] as const

const VALID_AGENT_STATUSES = [
  'pending',
  'picked-up',
  'in-progress',
  'awaiting-input',
  'done',
  'blocked',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanString).filter((item): item is string => !!item)))
}

function cleanOptionalDate(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function cleanEstimate(value: unknown): PayloadResult<number | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'estimateMinutes must be a positive number or null', status: 400 }
  }
  return { ok: true, value: Math.round(value) }
}

function cleanOrder(value: unknown, fallback = Date.now()): PayloadResult<number> {
  if (value === undefined || value === null) return { ok: true, value: fallback }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'order must be a number', status: 400 }
  }
  return { ok: true, value }
}

function cleanPriority(value: unknown): PayloadResult<string> {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'medium' }
  if (typeof value !== 'string' || !VALID_PRIORITIES.includes(value as (typeof VALID_PRIORITIES)[number])) {
    return { ok: false, error: 'Invalid priority; expected urgent | high | medium | low', status: 400 }
  }
  return { ok: true, value: value === 'normal' ? 'medium' : value }
}

function cleanAttachments(value: unknown): PayloadResult<Record<string, unknown>[]> {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'Attachments must be an array', status: 400 }

  const attachments: Record<string, unknown>[] = []
  for (const attachment of value) {
    if (!isRecord(attachment)) {
      return { ok: false, error: 'Each attachment must be an object', status: 400 }
    }
    const url = cleanString(attachment.url)
    const name = cleanString(attachment.name)
    if (!url || !name) {
      return { ok: false, error: 'Each attachment must have url and name fields', status: 400 }
    }
    const cleanAttachment: Record<string, unknown> = {
      url,
      name,
      type: cleanString(attachment.type) ?? cleanString(attachment.mimeType) ?? 'application/octet-stream',
      mimeType: cleanString(attachment.mimeType) ?? cleanString(attachment.type) ?? 'application/octet-stream',
    }
    const id = cleanString(attachment.id)
    const uploadId = cleanString(attachment.uploadId)
    const storagePath = cleanString(attachment.storagePath)
    if (id) cleanAttachment.id = id
    if (uploadId) cleanAttachment.uploadId = uploadId
    if (storagePath) cleanAttachment.storagePath = storagePath
    if (typeof attachment.size === 'number' && Number.isFinite(attachment.size)) {
      cleanAttachment.size = attachment.size
    }
    attachments.push(cleanAttachment)
  }
  return { ok: true, value: attachments }
}

function cleanChecklist(value: unknown): PayloadResult<Record<string, unknown>[]> {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'Checklist must be an array', status: 400 }

  const checklist: Record<string, unknown>[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!isRecord(item)) return { ok: false, error: 'Each checklist item must be an object', status: 400 }
    const text = cleanString(item.text)
    if (!text) return { ok: false, error: 'Each checklist item must have text', status: 400 }
    checklist.push({
      id: cleanString(item.id) ?? `item-${Date.now()}-${index}`,
      text,
      done: item.done === true,
    })
  }

  return { ok: true, value: checklist }
}

function cleanAgentId(value: unknown): PayloadResult<string | null> {
  if (value === undefined) return { ok: true, value: null }
  if (value === null || value === '') return { ok: true, value: null }
  if (!isValidAgentId(value)) {
    return { ok: false, error: 'Invalid assigneeAgentId; expected a valid agent id', status: 400 }
  }
  return { ok: true, value }
}

function cleanAgentStatus(value: unknown): PayloadResult<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !VALID_AGENT_STATUSES.includes(value as (typeof VALID_AGENT_STATUSES)[number])) {
    return { ok: false, error: `Invalid agentStatus; expected one of ${VALID_AGENT_STATUSES.join(' | ')}`, status: 400 }
  }
  return { ok: true, value }
}

function cleanAgentInput(value: unknown): PayloadResult<Record<string, unknown> | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!isRecord(value)) return { ok: false, error: 'agentInput must be an object', status: 400 }
  const spec = cleanString(value.spec)
  if (!spec) return { ok: false, error: 'agentInput.spec is required', status: 400 }
  const out: Record<string, unknown> = { spec }
  if (isRecord(value.context)) out.context = value.context
  if (Array.isArray(value.constraints)) {
    out.constraints = value.constraints.map(cleanString).filter((s): s is string => !!s)
  }
  return { ok: true, value: out }
}

function cleanAgentOutput(value: unknown): PayloadResult<Record<string, unknown> | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!isRecord(value)) return { ok: false, error: 'agentOutput must be an object', status: 400 }
  const summary = cleanString(value.summary)
  if (!summary) return { ok: false, error: 'agentOutput.summary is required', status: 400 }
  const out: Record<string, unknown> = { summary }
  if (Array.isArray(value.artifacts)) {
    const artifacts: Record<string, unknown>[] = []
    for (const a of value.artifacts) {
      if (!isRecord(a)) return { ok: false, error: 'Each artifact must be an object', status: 400 }
      const ref = cleanString(a.ref)
      const type = cleanString(a.type)
      if (!ref || !type) return { ok: false, error: 'Each artifact needs ref + type', status: 400 }
      const artifact: Record<string, unknown> = { ref, type }
      const label = cleanString(a.label)
      if (label) artifact.label = label
      artifacts.push(artifact)
    }
    out.artifacts = artifacts
  }
  return { ok: true, value: out }
}

function cleanDependsOn(value: unknown): PayloadResult<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'dependsOn must be an array of task IDs', status: 400 }
  const ids = value.map(cleanString).filter((s): s is string => !!s)
  return { ok: true, value: Array.from(new Set(ids)) }
}

export function notificationPriority(priority: unknown): 'low' | 'normal' | 'high' | 'urgent' {
  if (priority === 'urgent' || priority === 'high' || priority === 'low') return priority
  return 'normal'
}

export function taskOrderMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return Number.MAX_SAFE_INTEGER
}

export function buildProjectTaskCreateData(
  body: Record<string, unknown>,
  projectId: string,
  fallbackOrgId?: string,
): PayloadResult<Record<string, unknown>> {
  const title = cleanString(body.title)
  if (!title) return { ok: false, error: 'title is required', status: 400 }

  const columnId = cleanString(body.columnId) ?? 'backlog'
  const priority = cleanPriority(body.priority)
  if (!priority.ok) return priority
  const order = cleanOrder(body.order)
  if (!order.ok) return order
  const estimate = cleanEstimate(body.estimateMinutes)
  if (!estimate.ok) return estimate
  const attachments = cleanAttachments(body.attachments)
  if (!attachments.ok) return attachments
  const checklist = cleanChecklist(body.checklist)
  if (!checklist.ok) return checklist
  const assigneeIds = cleanStringArray(body.assigneeIds)
  const agentId = cleanAgentId(body.assigneeAgentId)
  if (!agentId.ok) return agentId
  const agentInput = cleanAgentInput(body.agentInput)
  if (!agentInput.ok) return agentInput
  const dependsOn = cleanDependsOn(body.dependsOn)
  if (!dependsOn.ok) return dependsOn

  const value: Record<string, unknown> = {
    orgId: cleanString(body.orgId) ?? fallbackOrgId ?? null,
    projectId,
    columnId,
    title,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    priority: priority.value,
    assigneeId: cleanString(body.assigneeId) ?? assigneeIds[0] ?? null,
    assigneeIds,
    mentionIds: cleanStringArray(body.mentionIds),
    labels: cleanStringArray(body.labels),
    attachments: attachments.value,
    checklist: checklist.value,
    dueDate: cleanOptionalDate(body.dueDate),
    startDate: cleanOptionalDate(body.startDate),
    estimateMinutes: estimate.value,
    order: order.value,
  }

  if (agentId.value) {
    value.assigneeAgentId = agentId.value
    value.agentStatus = 'pending'
  }
  if (agentInput.value) value.agentInput = agentInput.value
  if (dependsOn.value.length > 0) value.dependsOn = dependsOn.value

  return { ok: true, value }
}

export function buildProjectTaskUpdateData(body: Record<string, unknown>): PayloadResult<Record<string, unknown>> {
  const updates: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const title = cleanString(body.title)
    if (!title) return { ok: false, error: 'title cannot be empty', status: 400 }
    updates.title = title
  }
  if (body.description !== undefined) updates.description = typeof body.description === 'string' ? body.description.trim() : ''
  if (body.columnId !== undefined) updates.columnId = cleanString(body.columnId) ?? 'backlog'
  if (body.priority !== undefined) {
    const priority = cleanPriority(body.priority)
    if (!priority.ok) return priority
    updates.priority = priority.value
  }
  if (body.order !== undefined) {
    const order = cleanOrder(body.order)
    if (!order.ok) return order
    updates.order = order.value
  }
  if (body.labels !== undefined) updates.labels = cleanStringArray(body.labels)
  if (body.assigneeIds !== undefined) {
    const assigneeIds = cleanStringArray(body.assigneeIds)
    updates.assigneeIds = assigneeIds
    if (body.assigneeId === undefined) updates.assigneeId = assigneeIds[0] ?? null
  }
  if (body.assigneeId !== undefined) updates.assigneeId = cleanString(body.assigneeId) ?? null
  if (body.mentionIds !== undefined) updates.mentionIds = cleanStringArray(body.mentionIds)
  if (body.dueDate !== undefined) updates.dueDate = cleanOptionalDate(body.dueDate)
  if (body.startDate !== undefined) updates.startDate = cleanOptionalDate(body.startDate)
  if (body.estimateMinutes !== undefined) {
    const estimate = cleanEstimate(body.estimateMinutes)
    if (!estimate.ok) return estimate
    updates.estimateMinutes = estimate.value
  }
  if (body.attachments !== undefined) {
    const attachments = cleanAttachments(body.attachments)
    if (!attachments.ok) return attachments
    updates.attachments = attachments.value
  }
  if (body.checklist !== undefined) {
    const checklist = cleanChecklist(body.checklist)
    if (!checklist.ok) return checklist
    updates.checklist = checklist.value
  }

  if (body.assigneeAgentId !== undefined) {
    const agentId = cleanAgentId(body.assigneeAgentId)
    if (!agentId.ok) return agentId
    updates.assigneeAgentId = agentId.value
    // Re-assigning to a new agent (or clearing) resets pickup state.
    if (body.agentStatus === undefined) {
      updates.agentStatus = agentId.value ? 'pending' : null
    }
  }
  if (body.agentStatus !== undefined) {
    const agentStatus = cleanAgentStatus(body.agentStatus)
    if (!agentStatus.ok) return agentStatus
    updates.agentStatus = agentStatus.value
  }
  if (body.agentInput !== undefined) {
    const agentInput = cleanAgentInput(body.agentInput)
    if (!agentInput.ok) return agentInput
    updates.agentInput = agentInput.value
  }
  if (body.agentOutput !== undefined) {
    const agentOutput = cleanAgentOutput(body.agentOutput)
    if (!agentOutput.ok) return agentOutput
    updates.agentOutput = agentOutput.value
  }
  if (body.dependsOn !== undefined) {
    const dependsOn = cleanDependsOn(body.dependsOn)
    if (!dependsOn.ok) return dependsOn
    updates.dependsOn = dependsOn.value
  }
  if (body.agentConversationId !== undefined) {
    updates.agentConversationId =
      typeof body.agentConversationId === 'string' && body.agentConversationId.trim()
        ? body.agentConversationId.trim()
        : null
  }
  if (body.agentHeartbeatAt === true) {
    // Sentinel — caller asks us to bump the heartbeat to "now".
    // Real timestamp is set in the route handler via FieldValue.serverTimestamp().
    updates.agentHeartbeatAt = '__server_timestamp__'
  }

  return { ok: true, value: updates }
}
