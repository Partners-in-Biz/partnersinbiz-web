import { createHash, randomUUID } from 'node:crypto'
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'

export type ProjectPlaybookRecord = Record<string, unknown> & {
  id?: string
  deleted?: unknown
}

export type ProjectPlaybookTaskTemplateV1 = {
  stepId: string
  taskKind: 'agent' | 'approval-gate' | 'human'
  title: string
  description?: string
  assigneeAgentId?: string
  agentInput?: {
    spec: string
    context?: Record<string, unknown>
    constraints?: string[]
  }
  dependsOnStepIds: string[]
  reviewerAgentId?: string
  requiredCapability?: string
  riskLevel?: string
  approvalGate?: string
  approvalGateStepId?: string
  expectedArtifacts: string[]
  verifierChecklist: string[]
  labels: string[]
  priority?: string
  agentEffort?: string
  agentModel?: string
}

export type ProjectPlaybookTemplateV1 = { schemaVersion: 1; steps: ProjectPlaybookTaskTemplateV1[] }

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return Array.from(new Set(value
      .split(',')
      .map((item) => cleanString(item))
      .filter(Boolean)))
  }
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => cleanString(item))
    .filter(Boolean)))
}

function projectOwnerOrgId(data: Record<string, unknown>): string {
  return cleanString(data.ownerOrgId) || cleanString(data.sourceOrgId) || cleanString(data.issuerOrgId) || cleanString(data.orgId)
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanAgentInput(step: Record<string, unknown>): ProjectPlaybookTaskTemplateV1['agentInput'] {
  const source = cleanRecord(step.agentInput)
  const spec = cleanString(source.spec) || cleanString(step.spec)
  if (!spec) return undefined
  const context = cleanRecord(source.context)
  const constraints = cleanStringArray(source.constraints)
  return {
    spec,
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
  }
}

export function normalizeProjectPlaybookTemplate(value: unknown): ProjectPlaybookTemplateV1 {
  const source = cleanRecord(value)
  const structured = Array.isArray(source.steps) ? source.steps : []
  if (structured.length > 0) {
    return {
      schemaVersion: 1,
      steps: structured.map((raw, index) => {
        const step = cleanRecord(raw)
        const nestedInput = cleanRecord(step.agentInput)
        const title = cleanString(step.title) || cleanString(nestedInput.spec) || cleanString(step.spec) || `Step ${index + 1}`
        const taskKind = (cleanString(step.taskKind) || (cleanString(step.approvalGate) ? 'approval-gate' : 'agent')) as ProjectPlaybookTaskTemplateV1['taskKind']
        return {
          stepId: cleanString(step.stepId) || `step-${index + 1}`,
          taskKind,
          title,
          description: cleanString(step.description) || undefined,
          assigneeAgentId: cleanString(step.assigneeAgentId) || undefined,
          agentInput: cleanAgentInput(step),
          dependsOnStepIds: cleanStringArray(step.dependsOnStepIds),
          reviewerAgentId: cleanString(step.reviewerAgentId) || undefined,
          requiredCapability: cleanString(step.requiredCapability) || undefined,
          riskLevel: cleanString(step.riskLevel) || undefined,
          approvalGate: cleanString(step.approvalGate) || undefined,
          // Pre-v1 drafts used approvalGateTaskId for a local step key. Read it,
          // but validate it as a sibling step reference before any task write.
          approvalGateStepId: cleanString(step.approvalGateStepId ?? step.approvalGateTaskId) || undefined,
          expectedArtifacts: cleanStringArray(step.expectedArtifacts),
          verifierChecklist: cleanStringArray(step.verifierChecklist),
          labels: cleanStringArray(step.labels),
          priority: cleanString(step.priority) || undefined,
          agentEffort: cleanString(step.agentEffort) || undefined,
          agentModel: cleanString(step.agentModel) || undefined,
        }
      }),
    }
  }
  const legacy = cleanStringArray(Array.isArray(value) ? value : source.templateSteps)
  return {
    schemaVersion: 1,
    steps: legacy.map((title, index) => ({
      stepId: `step-${index + 1}`,
      taskKind: 'human',
      title,
      dependsOnStepIds: index === 0 ? [] : [`step-${index}`],
      expectedArtifacts: [],
      verifierChecklist: [],
      labels: [],
    })),
  }
}

export function validateProjectPlaybookTemplate(template: ProjectPlaybookTemplateV1): { ok: true } | { ok: false; error: string } {
  if (template.steps.length === 0) return { ok: false, error: 'Playbook requires at least one step' }
  // One run also writes a run record, playbook update, and audit record. Keep
  // comfortably below Firestore's 500-write transaction limit.
  if (template.steps.length > 450) return { ok: false, error: 'Playbook cannot exceed 450 steps' }

  const ids = template.steps.map((step) => step.stepId)
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Playbook step ids must be unique' }
  const known = new Set(ids)
  const byId = new Map(template.steps.map((step) => [step.stepId, step]))

  for (const step of template.steps) {
    if (!step.stepId || !step.title) return { ok: false, error: 'Every playbook step requires stepId and title' }
    if (!['agent', 'approval-gate', 'human'].includes(step.taskKind)) return { ok: false, error: `Invalid taskKind in ${step.stepId}` }
    if (step.dependsOnStepIds.some((id) => !known.has(id))) return { ok: false, error: `Unknown step dependency in ${step.stepId}` }

    if (step.taskKind === 'agent') {
      if (!step.assigneeAgentId) return { ok: false, error: `Agent step ${step.stepId} requires assigneeAgentId` }
      if (!step.agentInput?.spec) return { ok: false, error: `Agent step ${step.stepId} requires agentInput.spec` }
      if (!step.requiredCapability) return { ok: false, error: `Agent step ${step.stepId} requires requiredCapability` }
      if (!step.reviewerAgentId) return { ok: false, error: `Agent step ${step.stepId} requires reviewerAgentId` }
      if (!step.riskLevel) return { ok: false, error: `Agent step ${step.stepId} requires riskLevel` }
      if (step.expectedArtifacts.length === 0) return { ok: false, error: `Agent step ${step.stepId} requires expectedArtifacts` }
      if (step.verifierChecklist.length === 0) return { ok: false, error: `Agent step ${step.stepId} requires verifierChecklist` }
      if (step.approvalGate) return { ok: false, error: `Agent step ${step.stepId} must link an approval gate by approvalGateStepId` }
    }

    if (step.taskKind === 'approval-gate') {
      if (!step.approvalGate || step.approvalGate === 'none') return { ok: false, error: `Approval gate step ${step.stepId} requires approvalGate` }
      if (!step.riskLevel) return { ok: false, error: `Approval gate step ${step.stepId} requires riskLevel` }
      if (step.expectedArtifacts.length === 0) return { ok: false, error: `Approval gate step ${step.stepId} requires expectedArtifacts` }
      if (step.verifierChecklist.length === 0) return { ok: false, error: `Approval gate step ${step.stepId} requires verifierChecklist` }
      if (step.approvalGateStepId) return { ok: false, error: `Approval gate step ${step.stepId} cannot depend on another approval gate` }
    }

    if (step.approvalGateStepId) {
      const gate = byId.get(step.approvalGateStepId)
      if (!gate) return { ok: false, error: `Unknown approval gate step in ${step.stepId}` }
      if (gate.taskKind !== 'approval-gate' || !gate.approvalGate || gate.approvalGate === 'none') {
        return { ok: false, error: `Approval gate reference in ${step.stepId} must target an approval-gate step` }
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    const step = byId.get(id)
    const dependencies = [...(step?.dependsOnStepIds ?? []), ...(step?.approvalGateStepId ? [step.approvalGateStepId] : [])]
    for (const dependencyId of dependencies) if (!visit(dependencyId)) return false
    visiting.delete(id)
    visited.add(id)
    return true
  }
  for (const id of ids) if (!visit(id)) return { ok: false, error: 'Playbook step dependencies must not contain a cycle' }
  return { ok: true }
}

export function playbookTemplateSteps(value: unknown): string[] {
  return normalizeProjectPlaybookTemplate(value).steps.map((step) => step.title)
}

function parseDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string') {
    const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) ? date : null
  }
  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof maybeTimestamp.toDate === 'function') {
      const date = maybeTimestamp.toDate()
      return Number.isFinite(date.getTime()) ? date : null
    }
    const seconds = maybeTimestamp.seconds ?? maybeTimestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseRecurrenceRule(rule: unknown): { freq: string; interval: number } | null {
  const raw = cleanString(rule)
  if (!raw) return null
  const parts = new Map<string, string>()
  for (const token of raw.split(';')) {
    const [key, value] = token.split('=')
    if (key && value) parts.set(key.trim().toUpperCase(), value.trim())
  }
  const freq = (parts.get('FREQ') || '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return null
  const interval = Math.max(1, Number.parseInt(parts.get('INTERVAL') || '1', 10) || 1)
  return { freq, interval }
}

function addRecurrenceInterval(date: Date, recurrence: { freq: string; interval: number }): Date {
  const next = new Date(date.getTime())
  if (recurrence.freq === 'DAILY') next.setUTCDate(next.getUTCDate() + recurrence.interval)
  if (recurrence.freq === 'WEEKLY') next.setUTCDate(next.getUTCDate() + (7 * recurrence.interval))
  if (recurrence.freq === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + recurrence.interval)
  return next
}

export function playbookIsDue(playbook: ProjectPlaybookRecord, now = new Date()): boolean {
  if (playbook.deleted === true) return false
  const status = cleanString(playbook.status)
  if (status === 'archived' || status === 'inactive' || status === 'revoked') return false
  if (playbook.autoCreateTasks !== true) return false
  if (normalizeProjectPlaybookTemplate(playbook.template ?? playbook).steps.length === 0) return false
  const nextRunAt = parseDate(playbook.nextRunAt)
  return Boolean(nextRunAt && nextRunAt.getTime() <= now.getTime())
}

export function nextPlaybookRunAt(playbook: ProjectPlaybookRecord, now = new Date()): string | null {
  const recurrence = parseRecurrenceRule(playbook.recurrenceRule)
  if (!recurrence) return null
  let next = parseDate(playbook.nextRunAt) || new Date(now.getTime())
  do {
    next = addRecurrenceInterval(next, recurrence)
  } while (next.getTime() <= now.getTime())
  return formatDateOnly(next)
}

export async function runProjectPlaybookTemplate(input: {
  projectId: string
  playbookId: string
  playbook: ProjectPlaybookRecord
  project: Record<string, unknown>
  actorUid: string
  runKey?: string
  nextRunAt?: string | null
  disableAutoCreateTasks?: boolean
}) {
  const title = cleanString(input.playbook.title) || 'Project playbook'
  const template = normalizeProjectPlaybookTemplate(input.playbook.template ?? input.playbook)
  const validation = validateProjectPlaybookTemplate(template)
  if (!validation.ok) return { ok: false as const, error: validation.error, status: 400 }
  const steps = template.steps

  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const tasksRef = projectRef.collection('tasks')
  const orgId = cleanString(input.project.orgId) || projectOwnerOrgId(input.project)
  if (!orgId) return { ok: false as const, error: 'Project organisation is required to run a playbook', status: 400 }

  const explicitRunKey = cleanString(input.runKey)
  const scheduledRunKey = Object.prototype.hasOwnProperty.call(input, 'nextRunAt')
    ? `scheduled:${cleanString(input.playbook.nextRunAt)}`
    : ''
  const suppliedRunKey = explicitRunKey || scheduledRunKey
  const runToken = suppliedRunKey || `${Date.now()}:${randomUUID()}`
  const runId = `${input.playbookId}_${createHash('sha256').update(runToken).digest('hex').slice(0, 32)}`
  const runRef = projectRef.collection('playbookRuns').doc(runId)
  const playbookRef = projectRef.collection('playbooks').doc(input.playbookId)
  const auditRef = projectRef.collection('audit').doc()
  const planningEventRef = projectRef.collection('planningDiscoveryEvents').doc()
  const taskRefsByStep = new Map(steps.map((step) => [step.stepId, tasksRef.doc()]))
  const createdTaskIds = steps.map((step) => taskRefsByStep.get(step.stepId)!.id)
  const taskWrites: Array<{ ref: DocumentReference; value: Record<string, unknown> }> = []
  const baseOrder = Date.now()

  // Build and validate every task before opening the transaction. Because ids
  // are already allocated, forward dependencies resolve without partial writes.
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const approvalGateTaskId = step.approvalGateStepId ? taskRefsByStep.get(step.approvalGateStepId)?.id : undefined
    const dependencyStepIds = Array.from(new Set([
      ...step.dependsOnStepIds,
      ...(step.approvalGateStepId ? [step.approvalGateStepId] : []),
    ]))
    const dependsOn = dependencyStepIds.map((stepId) => taskRefsByStep.get(stepId)!.id)
    const isAgentTask = step.taskKind === 'agent'
    const isApprovalGate = step.taskKind === 'approval-gate'
    const task = buildProjectTaskCreateData({
      title: step.title,
      description: step.description || `Created from playbook: ${title}`,
      columnId: approvalGateTaskId ? 'blocked' : 'todo',
      priority: step.priority || 'medium',
      labels: ['playbook', `playbook:${input.playbookId}`, ...(isApprovalGate ? ['approval-gate'] : []), ...step.labels],
      assigneeAgentId: isAgentTask ? step.assigneeAgentId : undefined,
      agentStatus: approvalGateTaskId ? 'awaiting-input' : undefined,
      agentEffort: step.agentEffort,
      agentModel: step.agentModel,
      reviewerAgentId: step.reviewerAgentId,
      requiredCapability: step.requiredCapability,
      riskLevel: step.riskLevel,
      approvalGate: isApprovalGate ? step.approvalGate : undefined,
      approvalGateTaskId,
      expectedArtifacts: step.expectedArtifacts,
      verifierChecklist: step.verifierChecklist,
      dependsOn,
      agentInput: isAgentTask && step.agentInput ? {
        ...step.agentInput,
        context: {
          ...(step.agentInput.context ?? {}),
          sourcePlaybookId: input.playbookId,
          sourcePlaybookRunId: runId,
          sourcePlaybookStepId: step.stepId,
          expectedArtifacts: step.expectedArtifacts,
          verifierChecklist: step.verifierChecklist,
          ...(approvalGateTaskId ? { approvalGateTaskId } : {}),
        },
      } : undefined,
      order: baseOrder + index,
    }, input.projectId, orgId)
    if (!task.ok) return { ok: false as const, error: task.error, status: task.status ?? 400 }

    taskWrites.push({
      ref: taskRefsByStep.get(step.stepId)!,
      value: {
        ...task.value,
        ...(isApprovalGate ? { approvalStatus: 'pending' } : {}),
        sourcePlaybookId: input.playbookId,
        sourcePlaybookRunId: runId,
        sourcePlaybookStepId: step.stepId,
        sourcePlaybookTaskKind: step.taskKind,
        sourcePlaybookSchemaVersion: template.schemaVersion,
        sourcePlaybookTitle: title,
        reporterId: input.actorUid,
        createdBy: input.actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    })
  }

  const playbookUpdates: Record<string, unknown> = {
    lastRunAt: FieldValue.serverTimestamp(),
    lastRunBy: input.actorUid,
    lastRunId: runId,
    lastRunTaskIds: createdTaskIds,
    runCount: FieldValue.increment(1),
    updatedBy: input.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (Object.prototype.hasOwnProperty.call(input, 'nextRunAt')) playbookUpdates.nextRunAt = input.nextRunAt
  if (input.disableAutoCreateTasks) playbookUpdates.autoCreateTasks = false

  const auditRecord = {
    type: 'audit',
    eventType: 'playbook_run',
    itemType: 'playbook',
    itemId: input.playbookId,
    title: `Ran ${title}`,
    actorUid: input.actorUid,
    taskCount: createdTaskIds.length,
    createdTaskIds,
    playbookRunId: runId,
    createdAt: FieldValue.serverTimestamp(),
  }
  const runRecord = {
    projectId: input.projectId,
    orgId,
    playbookId: input.playbookId,
    playbookRunId: runId,
    runKey: suppliedRunKey || null,
    status: 'created',
    taskCount: createdTaskIds.length,
    createdTaskIds,
    createdBy: input.actorUid,
    createdAt: FieldValue.serverTimestamp(),
  }

  return adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(runRef)
    if (existing.exists) {
      const data = existing.data() ?? {}
      const existingTaskIds = Array.isArray(data.createdTaskIds)
        ? data.createdTaskIds.filter((id): id is string => typeof id === 'string')
        : []
      return {
        ok: true as const,
        data: {
          playbookId: input.playbookId,
          playbookRunId: runId,
          createdTaskIds: existingTaskIds,
          taskCount: typeof data.taskCount === 'number' ? data.taskCount : existingTaskIds.length,
          deduplicated: true,
        },
      }
    }

    const liveProject = await transaction.get(projectRef)
    if (!liveProject.exists) {
      return { ok: false as const, error: 'Project not found', status: 404 }
    }
    const projectData = (liveProject.data() ?? {}) as Record<string, unknown>
    const planning = planningContextMutationTransition(projectData, {
      uid: input.actorUid,
      now: new Date().toISOString(),
      reason: 'project_playbook.run',
    })
    if (planning.state) {
      transaction.update(projectRef, { planningDiscovery: planning.state, updatedAt: FieldValue.serverTimestamp() })
    }
    if (planning.event) {
      transaction.set(planningEventRef, {
        ...planning.event,
        projectId: input.projectId,
        orgId: projectData.orgId ?? input.project.orgId ?? null,
        schemaVersion: 1,
        reason: 'project_playbook.run',
      })
    }
    if (!planning.allowed) {
      return { ok: false as const, error: planning.blocker.message, status: 409, code: planning.blocker.code }
    }

    for (const taskWrite of taskWrites) transaction.set(taskWrite.ref, taskWrite.value)
    transaction.set(runRef, runRecord)
    transaction.update(playbookRef, playbookUpdates)
    transaction.set(auditRef, auditRecord)

    return {
      ok: true as const,
      data: {
        playbookId: input.playbookId,
        playbookRunId: runId,
        createdTaskIds,
        taskCount: createdTaskIds.length,
        deduplicated: false,
      },
    }
  })
}
