import { isValidAgentId } from '@/lib/agents/types'
import { columnForAgentStatus } from '@/lib/tasks/agentState'
import type { AgentStatus } from '@/lib/tasks/types'

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

const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

const VALID_AGENT_CAPABILITIES = [
  'read',
  'draft',
  'write',
  'approve',
  'publish',
  'deploy',
  'spend',
  'message_client',
  'access_secret',
  'delete',
] as const

export const TASK_SOURCE_LINKAGE_FIELDS = [
  'sourceDocumentId',
  'sourceDocumentSectionId',
  'sourceSpecVersion',
  'approvalGateTaskId',
  'sourceResearchItemId',
  'riskLevel',
  'requiredCapability',
  'requestedByAgentId',
  'expectedArtifacts',
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

function cleanRiskLevel(value: unknown): PayloadResult<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  const cleaned = cleanString(value)
  if (!cleaned || !VALID_RISK_LEVELS.includes(cleaned as (typeof VALID_RISK_LEVELS)[number])) {
    return { ok: false, error: 'Invalid riskLevel; expected low | medium | high | critical', status: 400 }
  }
  return { ok: true, value: cleaned }
}

function cleanRequiredCapability(value: unknown): PayloadResult<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  const cleaned = cleanString(value)
  if (!cleaned || !VALID_AGENT_CAPABILITIES.includes(cleaned as (typeof VALID_AGENT_CAPABILITIES)[number])) {
    return { ok: false, error: `Invalid requiredCapability; expected one of ${VALID_AGENT_CAPABILITIES.join(' | ')}`, status: 400 }
  }
  return { ok: true, value: cleaned }
}

function cleanAgentContext(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  const out: Record<string, unknown> = { ...value }

  for (const field of TASK_SOURCE_LINKAGE_FIELDS) {
    if (!(field in value)) continue
    if (field === 'expectedArtifacts') {
      const cleaned = cleanStringArray(value[field])
      if (cleaned.length > 0) out[field] = cleaned
      else delete out[field]
      continue
    }
    const cleaned = cleanString(value[field])
    if (cleaned) {
      out[field] = cleaned
    } else if (value[field] === null) {
      out[field] = null
    } else {
      delete out[field]
    }
  }

  return out
}

function applyProvenanceFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): PayloadResult<null> {
  if (source.riskLevel !== undefined) {
    const risk = cleanRiskLevel(source.riskLevel)
    if (!risk.ok) return { ok: false, error: risk.error, status: risk.status }
    if (risk.value) target.riskLevel = risk.value
  }
  if (source.requiredCapability !== undefined) {
    const capability = cleanRequiredCapability(source.requiredCapability)
    if (!capability.ok) return { ok: false, error: capability.error, status: capability.status }
    if (capability.value) target.requiredCapability = capability.value
  }
  if (source.requestedByAgentId !== undefined) {
    const requestedBy = cleanAgentId(source.requestedByAgentId, 'requestedByAgentId')
    if (!requestedBy.ok) return { ok: false, error: requestedBy.error, status: requestedBy.status }
    if (requestedBy.value) target.requestedByAgentId = requestedBy.value
  }
  if (source.expectedArtifacts !== undefined) {
    target.expectedArtifacts = cleanStringArray(source.expectedArtifacts)
  }
  return { ok: true, value: null }
}

function cleanOptionalDate(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function cleanOptionalIsoDateTime(value: unknown, fieldName: string): PayloadResult<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: `${fieldName} must be an ISO date/time string or null`, status: 400 }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  const millis = Date.parse(trimmed)
  if (!Number.isFinite(millis)) return { ok: false, error: `${fieldName} must be a valid ISO date/time`, status: 400 }
  return { ok: true, value: new Date(millis).toISOString() }
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

function cleanAgentId(value: unknown, fieldName = 'assigneeAgentId'): PayloadResult<string | null> {
  if (value === undefined) return { ok: true, value: null }
  if (value === null || value === '') return { ok: true, value: null }
  if (!isValidAgentId(value)) {
    return { ok: false, error: `Invalid ${fieldName}; expected a valid agent id`, status: 400 }
  }
  return { ok: true, value: value as string }
}

function cleanAgentStatus(value: unknown): PayloadResult<AgentStatus | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !VALID_AGENT_STATUSES.includes(value as (typeof VALID_AGENT_STATUSES)[number])) {
    return { ok: false, error: `Invalid agentStatus; expected one of ${VALID_AGENT_STATUSES.join(' | ')}`, status: 400 }
  }
  return { ok: true, value: value as AgentStatus }
}

function cleanAgentInput(value: unknown): PayloadResult<Record<string, unknown> | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (!isRecord(value)) return { ok: false, error: 'agentInput must be an object', status: 400 }
  const spec = cleanString(value.spec)
  if (!spec) return { ok: false, error: 'agentInput.spec is required', status: 400 }
  const out: Record<string, unknown> = { spec }
  const context = cleanAgentContext(value.context)
  if (context) out.context = context
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
  if (value.completedAt !== undefined) out.completedAt = cleanOptionalDate(value.completedAt)
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

  const columnId = cleanString(body.columnId) ?? 'todo'
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
  const agentStatus = cleanAgentStatus(body.agentStatus)
  if (!agentStatus.ok) return agentStatus
  const agentInput = cleanAgentInput(body.agentInput)
  if (!agentInput.ok) return agentInput
  const agentReleaseAt = cleanOptionalIsoDateTime(body.agentReleaseAt, 'agentReleaseAt')
  if (!agentReleaseAt.ok) return agentReleaseAt
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
    baselineDueDate: cleanOptionalDate(body.baselineDueDate),
    baselineStartDate: cleanOptionalDate(body.baselineStartDate),
    estimateMinutes: estimate.value,
    order: order.value,
  }
  if (body.internalOnly !== undefined) value.internalOnly = body.internalOnly === true

  if (agentId.value) {
    const nextAgentStatus = agentStatus.value ?? 'pending'
    value.assigneeAgentId = agentId.value
    value.agentStatus = nextAgentStatus
    if (agentReleaseAt.value) {
      value.agentReleaseAt = agentReleaseAt.value
      value.agentReleaseStatus = 'scheduled'
      if (body.columnId === undefined) value.columnId = 'backlog'
    } else if (body.columnId === undefined) {
      value.columnId = columnForAgentStatus(nextAgentStatus)
    }
    if (nextAgentStatus === 'done') value.reviewStatus = 'pending'
  }
  const provenance = applyProvenanceFields(body, value)
  if (!provenance.ok) return provenance
  if (agentInput.value) value.agentInput = agentInput.value
  if (dependsOn.value.length > 0) value.dependsOn = dependsOn.value
  const reviewerIds = cleanStringArray(body.reviewerIds)
  const reviewerAgentId = cleanAgentId(body.reviewerAgentId, 'reviewerAgentId')
  if (!reviewerAgentId.ok) return reviewerAgentId
  if (reviewerIds.length > 0) value.reviewerIds = reviewerIds
  if (reviewerAgentId.value) value.reviewerAgentId = reviewerAgentId.value

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
  if (body.columnId !== undefined) updates.columnId = cleanString(body.columnId) ?? 'todo'
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
  if (body.baselineDueDate !== undefined) updates.baselineDueDate = cleanOptionalDate(body.baselineDueDate)
  if (body.baselineStartDate !== undefined) updates.baselineStartDate = cleanOptionalDate(body.baselineStartDate)
  if (body.agentReleaseAt !== undefined) {
    const releaseAt = cleanOptionalIsoDateTime(body.agentReleaseAt, 'agentReleaseAt')
    if (!releaseAt.ok) return releaseAt
    updates.agentReleaseAt = releaseAt.value
    updates.agentReleaseStatus = releaseAt.value ? 'scheduled' : null
    if (releaseAt.value && body.columnId === undefined) updates.columnId = 'backlog'
  }
  if (body.agentReleaseStatus !== undefined) {
    const releaseStatus = cleanString(body.agentReleaseStatus)
    if (releaseStatus && !['scheduled', 'released', 'cancelled'].includes(releaseStatus)) {
      return { ok: false, error: 'Invalid agentReleaseStatus; expected scheduled | released | cancelled', status: 400 }
    }
    updates.agentReleaseStatus = releaseStatus
  }
  if (body.agentReleasedAt !== undefined) {
    const releasedAt = cleanOptionalIsoDateTime(body.agentReleasedAt, 'agentReleasedAt')
    if (!releasedAt.ok) return releasedAt
    updates.agentReleasedAt = releasedAt.value
  }
  if (body.estimateMinutes !== undefined) {
    const estimate = cleanEstimate(body.estimateMinutes)
    if (!estimate.ok) return estimate
    updates.estimateMinutes = estimate.value
  }
  if (body.internalOnly !== undefined) updates.internalOnly = body.internalOnly === true
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
    if (body.columnId === undefined && agentStatus.value === 'done') {
      updates.columnId = 'review'
      updates.reviewStatus = 'pending'
    } else if (body.columnId === undefined && agentStatus.value === 'blocked') {
      updates.columnId = 'blocked'
    }
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
  if (body.reviewerIds !== undefined) updates.reviewerIds = cleanStringArray(body.reviewerIds)
  if (body.reviewerAgentId !== undefined) {
    const reviewerAgentId = cleanAgentId(body.reviewerAgentId, 'reviewerAgentId')
    if (!reviewerAgentId.ok) return reviewerAgentId
    updates.reviewerAgentId = reviewerAgentId.value
  }
  if (body.reviewStatus !== undefined) {
    const reviewStatus = cleanString(body.reviewStatus)
    if (reviewStatus && !['pending', 'in-progress', 'approved', 'changes-requested'].includes(reviewStatus)) {
      return { ok: false, error: 'Invalid reviewStatus; expected pending | in-progress | approved | changes-requested', status: 400 }
    }
    updates.reviewStatus = reviewStatus
  }
  if (body.approvalStatus !== undefined) {
    const approvalStatus = cleanString(body.approvalStatus)
    if (approvalStatus && !['pending', 'approved', 'rejected', 'denied'].includes(approvalStatus)) {
      return { ok: false, error: 'Invalid approvalStatus; expected pending | approved | rejected | denied', status: 400 }
    }
    updates.approvalStatus = approvalStatus
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

  const provenance = applyProvenanceFields(body, updates)
  if (!provenance.ok) return provenance

  return { ok: true, value: updates }
}

export function applyAgentColumnMoveState(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const hasAgent = typeof existing.assigneeAgentId === 'string' && existing.assigneeAgentId.trim().length > 0
  const columnId = typeof updates.columnId === 'string' ? updates.columnId : null
  const callerDidNotSetStatus = body.agentStatus === undefined
  const currentStatus = typeof existing.agentStatus === 'string' ? existing.agentStatus : null

  if (!hasAgent || !columnId || !callerDidNotSetStatus) return updates

  if (columnId === 'todo') {
    const requeueable = currentStatus === 'done' || currentStatus === 'blocked' || currentStatus === 'awaiting-input'
    if (!requeueable) return updates
    return {
      ...updates,
      agentStatus: 'pending',
      reviewStatus: 'changes-requested',
      agentOutput: null,
      agentConversationId: null,
      agentHeartbeatAt: null,
    }
  }

  if (columnId === 'in_progress') {
    return {
      ...updates,
      agentStatus: 'in-progress',
      reviewStatus: null,
    }
  }

  return updates
}

export const applyAgentTodoRequeue = applyAgentColumnMoveState
