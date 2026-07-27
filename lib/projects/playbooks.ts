import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'
import { planningMutationBlocker } from '@/lib/projects/planningDiscovery'

export type ProjectPlaybookRecord = Record<string, unknown> & {
  id?: string
  deleted?: unknown
}

export type ProjectPlaybookTaskTemplateV1 = {
  stepId: string
  title: string
  spec: string
  description?: string
  assigneeAgentId?: string
  dependsOnStepIds: string[]
  reviewerAgentId?: string
  requiredCapability?: string
  riskLevel?: string
  approvalGateTaskId?: string
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
    return value
      .split(',')
      .map((item) => cleanString(item))
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
}

function projectOwnerOrgId(data: Record<string, unknown>): string {
  return cleanString(data.ownerOrgId) || cleanString(data.sourceOrgId) || cleanString(data.issuerOrgId) || cleanString(data.orgId)
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeProjectPlaybookTemplate(value: unknown): ProjectPlaybookTemplateV1 {
  const source = cleanRecord(value)
  const structured = Array.isArray(source.steps) ? source.steps : []
  if (structured.length > 0) {
    return {
      schemaVersion: 1,
      steps: structured.map((raw, index) => {
        const step = cleanRecord(raw)
        const title = cleanString(step.title) || cleanString(step.spec) || `Step ${index + 1}`
        return {
          stepId: cleanString(step.stepId) || `step-${index + 1}`,
          title,
          spec: cleanString(step.spec) || title,
          description: cleanString(step.description) || undefined,
          assigneeAgentId: cleanString(step.assigneeAgentId) || undefined,
          dependsOnStepIds: cleanStringArray(step.dependsOnStepIds),
          reviewerAgentId: cleanString(step.reviewerAgentId) || undefined,
          requiredCapability: cleanString(step.requiredCapability) || undefined,
          riskLevel: cleanString(step.riskLevel) || undefined,
          approvalGateTaskId: cleanString(step.approvalGateTaskId) || undefined,
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
      title,
      spec: title,
      dependsOnStepIds: index === 0 ? [] : [`step-${index}`],
      expectedArtifacts: [],
      verifierChecklist: [],
      labels: [],
    })),
  }
}

export function validateProjectPlaybookTemplate(template: ProjectPlaybookTemplateV1): { ok: true } | { ok: false; error: string } {
  if (template.steps.length === 0) return { ok: false, error: 'Playbook requires at least one step' }
  const ids = template.steps.map((step) => step.stepId)
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Playbook step ids must be unique' }
  const known = new Set(ids)
  for (const step of template.steps) {
    if (!step.stepId || !step.title || !step.spec) return { ok: false, error: 'Every playbook step requires stepId, title, and spec' }
    if (step.dependsOnStepIds.some((id) => !known.has(id))) return { ok: false, error: `Unknown step dependency in ${step.stepId}` }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(template.steps.map((step) => [step.stepId, step]))
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    for (const dependencyId of byId.get(id)?.dependsOnStepIds ?? []) if (!visit(dependencyId)) return false
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
  nextRunAt?: string | null
  disableAutoCreateTasks?: boolean
}) {
  const title = cleanString(input.playbook.title) || 'Project playbook'
  const planningBlocker = planningMutationBlocker(input.project)
  if (planningBlocker) return { ok: false as const, error: planningBlocker.message, status: 409, code: planningBlocker.code }
  const template = normalizeProjectPlaybookTemplate(input.playbook.template ?? input.playbook)
  const validation = validateProjectPlaybookTemplate(template)
  if (!validation.ok) return { ok: false as const, error: validation.error, status: 400 }
  const steps = template.steps

  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const tasksRef = projectRef.collection('tasks')
  const orgId = cleanString(input.project.orgId) || projectOwnerOrgId(input.project) || undefined
  const createdTaskIds: string[] = []
  const createdTaskIdsByStep = new Map<string, string>()
  const runId = `${input.playbookId}_${Date.now()}`

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const dependsOn = [
      ...step.dependsOnStepIds.map((stepId) => createdTaskIdsByStep.get(stepId)).filter((id): id is string => Boolean(id)),
      ...(step.approvalGateTaskId ? [step.approvalGateTaskId] : []),
    ]
    const task = buildProjectTaskCreateData({
      title: step.title,
      description: step.description || `Created from playbook: ${title}`,
      columnId: 'todo',
      priority: step.priority || 'medium',
      labels: ['playbook', `playbook:${input.playbookId}`, ...step.labels],
      assigneeAgentId: step.assigneeAgentId,
      agentEffort: step.agentEffort,
      agentModel: step.agentModel,
      reviewerAgentId: step.reviewerAgentId,
      requiredCapability: step.requiredCapability,
      riskLevel: step.riskLevel,
      approvalGateTaskId: step.approvalGateTaskId,
      expectedArtifacts: step.expectedArtifacts,
      verifierChecklist: step.verifierChecklist,
      dependsOn,
      agentInput: step.assigneeAgentId ? {
        spec: step.spec,
        context: {
          sourcePlaybookId: input.playbookId,
          sourcePlaybookRunId: runId,
          sourcePlaybookStepId: step.stepId,
          expectedArtifacts: step.expectedArtifacts,
        },
      } : undefined,
      order: Date.now() + index,
    }, input.projectId, orgId)
    if (!task.ok) return { ok: false as const, error: task.error, status: task.status ?? 400 }

    const ref = await tasksRef.add({
      ...task.value,
      sourcePlaybookId: input.playbookId,
      sourcePlaybookRunId: runId,
      sourcePlaybookStepId: step.stepId,
      sourcePlaybookSchemaVersion: template.schemaVersion,
      sourcePlaybookTitle: title,
      reporterId: input.actorUid,
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    createdTaskIds.push(ref.id)
    createdTaskIdsByStep.set(step.stepId, ref.id)
  }

  const playbookUpdates: Record<string, unknown> = {
    lastRunAt: FieldValue.serverTimestamp(),
    lastRunBy: input.actorUid,
    lastRunId: runId,
    lastRunTaskIds: createdTaskIds,
    runCount: (typeof input.playbook.runCount === 'number' ? input.playbook.runCount : 0) + 1,
    updatedBy: input.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (Object.prototype.hasOwnProperty.call(input, 'nextRunAt')) playbookUpdates.nextRunAt = input.nextRunAt
  if (input.disableAutoCreateTasks) playbookUpdates.autoCreateTasks = false

  await projectRef.collection('playbooks').doc(input.playbookId).update(playbookUpdates)

  await projectRef.collection('audit').add({
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
  })

  return {
    ok: true as const,
    data: {
      playbookId: input.playbookId,
      playbookRunId: runId,
      createdTaskIds,
      taskCount: createdTaskIds.length,
    },
  }
}
