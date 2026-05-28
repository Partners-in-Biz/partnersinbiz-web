import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { buildProjectTaskCreateData } from '@/lib/projects/taskPayload'

export type ProjectPlaybookRecord = Record<string, unknown> & {
  id?: string
  deleted?: unknown
}

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

export function playbookTemplateSteps(value: unknown): string[] {
  return cleanStringArray(value)
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
  if (playbookTemplateSteps(playbook.templateSteps).length === 0) return false
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
  const steps = playbookTemplateSteps(input.playbook.templateSteps)
  if (steps.length === 0) {
    return { ok: false as const, error: 'Playbook has no reusable template steps to run', status: 400 }
  }

  const projectRef = adminDb.collection('projects').doc(input.projectId)
  const tasksRef = projectRef.collection('tasks')
  const orgId = cleanString(input.project.orgId) || projectOwnerOrgId(input.project) || undefined
  const createdTaskIds: string[] = []
  const runId = `${input.playbookId}_${Date.now()}`

  for (let index = 0; index < steps.length; index += 1) {
    const task = buildProjectTaskCreateData({
      title: steps[index],
      description: `Created from playbook: ${title}`,
      columnId: 'todo',
      priority: 'medium',
      labels: ['playbook', `playbook:${input.playbookId}`],
      order: Date.now() + index,
    }, input.projectId, orgId)
    if (!task.ok) return { ok: false as const, error: task.error, status: task.status ?? 400 }

    const ref = await tasksRef.add({
      ...task.value,
      sourcePlaybookId: input.playbookId,
      sourcePlaybookRunId: runId,
      sourcePlaybookTitle: title,
      reporterId: input.actorUid,
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    createdTaskIds.push(ref.id)
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
