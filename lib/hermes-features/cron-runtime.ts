/**
 * Cron that actually reaches Hermes: durable store + optional admin sidecar sync + fire via /v1/runs.
 */
import type { CronJobSpec } from './types'
import { createCronJob, editCronJob, pauseCronJob, resumeCronJob } from './cron'
import type { HermesFeaturesRepository } from './repository'

export interface CronHermesSyncDeps {
  /** Proxy to Hermes admin cron (callAgentPath style). */
  syncToHermes?: (agentId: string, body: Record<string, unknown>) => Promise<{ ok: boolean; detail?: string }>
  /** Create a Hermes run for a due job. */
  createRun?: (input: {
    orgId: string
    agentId: string
    prompt: string
    jobId: string
  }) => Promise<{ ok: boolean; runId?: string; error?: string }>
  now?: () => Date
}

export type CronJobRuntime = CronJobSpec & {
  hermesSynced?: boolean
  hermesSyncDetail?: string
  nextRunAt?: string
  lastFireRunId?: string
  lastFireError?: string
}

function computeNextRunAt(schedule: string, from: Date): string | undefined {
  const s = schedule.trim().toLowerCase()
  const next = new Date(from.getTime())
  if (s === '@hourly' || s.startsWith('every hour')) {
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next.toISOString()
  }
  if (s === '@daily' || s.includes('every day') || s.includes('daily')) {
    next.setHours(8, 0, 0, 0)
    if (next <= from) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }
  // 5-field cron: rough "next hour" placeholder when expression present
  if (/^(\S+\s+){4}\S+$/.test(schedule.trim())) {
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next.toISOString()
  }
  // Natural language: first fire opportunity in 5 minutes (Hermes may own schedule if synced)
  return new Date(from.getTime() + 5 * 60_000).toISOString()
}

export async function createAndScheduleCron(
  input: {
    orgId: string
    agentId: string
    name: string
    schedule: string
    prompt: string
    skillIds?: string[]
    id?: string
  },
  repo: HermesFeaturesRepository,
  deps: CronHermesSyncDeps = {},
): Promise<CronJobRuntime> {
  const base = createCronJob(input)
  const now = deps.now?.() ?? new Date()
  let job: CronJobRuntime = {
    ...base,
    nextRunAt: computeNextRunAt(base.schedule, now),
    hermesSynced: false,
  }

  if (deps.syncToHermes) {
    try {
      const sync = await deps.syncToHermes(input.agentId, {
        name: job.name,
        schedule: job.schedule,
        prompt: job.prompt,
        skill_ids: job.skillIds,
        id: job.id,
      })
      job = {
        ...job,
        hermesSynced: sync.ok,
        hermesSyncDetail: sync.detail,
      }
    } catch (err) {
      job = {
        ...job,
        hermesSynced: false,
        hermesSyncDetail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return repo.upsertCron(job) as Promise<CronJobRuntime>
}

export async function pauseCronRuntime(
  orgId: string,
  id: string,
  repo: HermesFeaturesRepository,
): Promise<CronJobRuntime> {
  const job = (await repo.listCron(orgId)).find((j) => j.id === id)
  if (!job) throw new Error('Cron job not found')
  return repo.upsertCron(pauseCronJob(job)) as Promise<CronJobRuntime>
}

export async function resumeCronRuntime(
  orgId: string,
  id: string,
  repo: HermesFeaturesRepository,
): Promise<CronJobRuntime> {
  const job = (await repo.listCron(orgId)).find((j) => j.id === id)
  if (!job) throw new Error('Cron job not found')
  const resumed = resumeCronJob(job) as CronJobRuntime
  resumed.nextRunAt = computeNextRunAt(resumed.schedule, new Date())
  return repo.upsertCron(resumed) as Promise<CronJobRuntime>
}

export async function editCronRuntime(
  orgId: string,
  id: string,
  patch: Partial<Pick<CronJobSpec, 'name' | 'schedule' | 'prompt' | 'skillIds' | 'agentId'>>,
  repo: HermesFeaturesRepository,
): Promise<CronJobRuntime> {
  const job = (await repo.listCron(orgId)).find((j) => j.id === id)
  if (!job) throw new Error('Cron job not found')
  const edited = editCronJob(job, patch) as CronJobRuntime
  if (patch.schedule) edited.nextRunAt = computeNextRunAt(edited.schedule, new Date())
  return repo.upsertCron(edited) as Promise<CronJobRuntime>
}

/** Fire a single job now via Hermes /v1/runs (observable run id). */
export async function fireCronJob(
  orgId: string,
  id: string,
  repo: HermesFeaturesRepository,
  deps: CronHermesSyncDeps,
): Promise<CronJobRuntime> {
  const job = (await repo.listCron(orgId)).find((j) => j.id === id) as CronJobRuntime | undefined
  if (!job) throw new Error('Cron job not found')
  if (job.status !== 'active') throw new Error('Cron job is paused')
  if (!deps.createRun) throw new Error('createRun dependency required to fire cron on Hermes')

  const result = await deps.createRun({
    orgId,
    agentId: job.agentId,
    jobId: job.id,
    prompt: [
      '[Hermes scheduled task — PiB cron fire]',
      `job: ${job.name} (${job.id})`,
      `schedule: ${job.schedule}`,
      '',
      job.prompt,
    ].join('\n'),
  })

  const now = deps.now?.() ?? new Date()
  const next: CronJobRuntime = {
    ...job,
    lastRunAt: now.toISOString(),
    nextRunAt: computeNextRunAt(job.schedule, now),
    lastFireRunId: result.runId,
    lastFireError: result.ok ? undefined : result.error,
    updatedAt: now.toISOString(),
  }
  return repo.upsertCron(next) as Promise<CronJobRuntime>
}

/** Process all due active jobs for an org (or all jobs when orgId omitted via caller loop). */
export async function processDueCronJobs(
  orgId: string,
  repo: HermesFeaturesRepository,
  deps: CronHermesSyncDeps,
): Promise<CronJobRuntime[]> {
  const now = deps.now?.() ?? new Date()
  const jobs = await repo.listCron(orgId)
  const fired: CronJobRuntime[] = []
  for (const job of jobs) {
    const runtime = job as CronJobRuntime
    if (runtime.status !== 'active') continue
    if (runtime.nextRunAt && new Date(runtime.nextRunAt) > now) continue
    try {
      fired.push(await fireCronJob(orgId, job.id, repo, deps))
    } catch {
      /* continue other jobs */
    }
  }
  return fired
}
