import type { CronJobSpec } from './types'

let seq = 0

export function parseCronSchedule(input: string): { kind: 'cron' | 'natural'; schedule: string } {
  const raw = input.trim()
  if (!raw) throw new Error('Schedule is required')
  // 5-field cron or @daily/@hourly
  if (/^(@(yearly|annually|monthly|weekly|daily|hourly|reboot)|(\S+\s+){4}\S+)$/i.test(raw)) {
    return { kind: 'cron', schedule: raw }
  }
  // natural language accepted as-is (Hermes NL schedules)
  return { kind: 'natural', schedule: raw }
}

export function createCronJob(input: {
  orgId: string
  agentId: string
  name: string
  schedule: string
  prompt: string
  skillIds?: string[]
  id?: string
}): CronJobSpec {
  if (!input.name.trim()) throw new Error('Cron job name is required')
  if (!input.prompt.trim()) throw new Error('Cron prompt is required')
  const parsed = parseCronSchedule(input.schedule)
  const now = new Date().toISOString()
  seq += 1
  return {
    id: input.id || `cron_${Date.now()}_${seq}`,
    orgId: input.orgId,
    agentId: input.agentId,
    name: input.name.trim(),
    schedule: parsed.schedule,
    prompt: input.prompt.trim(),
    skillIds: input.skillIds ? [...input.skillIds] : undefined,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export function pauseCronJob(job: CronJobSpec): CronJobSpec {
  return { ...job, status: 'paused', updatedAt: new Date().toISOString() }
}

export function resumeCronJob(job: CronJobSpec): CronJobSpec {
  return { ...job, status: 'active', updatedAt: new Date().toISOString() }
}

export function editCronJob(
  job: CronJobSpec,
  patch: Partial<Pick<CronJobSpec, 'name' | 'schedule' | 'prompt' | 'skillIds' | 'agentId'>>,
): CronJobSpec {
  const next = { ...job }
  if (patch.name != null) {
    if (!patch.name.trim()) throw new Error('Cron job name is required')
    next.name = patch.name.trim()
  }
  if (patch.schedule != null) {
    next.schedule = parseCronSchedule(patch.schedule).schedule
  }
  if (patch.prompt != null) {
    if (!patch.prompt.trim()) throw new Error('Cron prompt is required')
    next.prompt = patch.prompt.trim()
  }
  if (patch.skillIds != null) next.skillIds = [...patch.skillIds]
  if (patch.agentId != null) next.agentId = patch.agentId
  next.updatedAt = new Date().toISOString()
  return next
}
