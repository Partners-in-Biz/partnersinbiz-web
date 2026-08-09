import { createHash, createPrivateKey, sign } from 'node:crypto'
import os from 'node:os'
import { MappingRegistry } from './bridge'
import { prepareTaskWorktree } from './repository-worktree'
import type { JSONValue } from './core'
import {
  isLocalHermesBrowserToolFailure,
  isLocalHermesCapacityError,
  isLocalHermesGatewayDrainingError,
  isLocalHermesNonTerminalExecutionError,
  isLocalHermesTransientInfrastructureError,
} from './hermes'

export type Job = {
  jobId: string
  requestId: string
  prompt: string
  images?: Array<{ url: string; contentType: string }>
  workspaceId: string
  projectId: string
  mappingId: string
  relativeFolder: string
  workingDirectory?: string
  attempt: number
  leaseToken: string
  agentId?: string
  model?: string
  provider?: string
  yolo?: boolean
  cancelled?: boolean
  /** Present only for watcher-dispatched Kanban tasks, never ordinary Messages chats. */
  kanbanTaskId?: string
  localHermesRunId?: string
}

type Device = { deviceId: string; credentialVersion: number; privateKey: string }
type HermesInput = {
  prompt: string
  images?: Array<{ url: string; contentType: string }>
  model?: string
  provider?: string
  working_directory: string
  yolo?: boolean
}
type QueueReason = 'runtime_capacity' | 'agent_capacity' | 'gateway_draining' | 'runtime_restarting'
type HermesHelpers = {
  onEvents?: (events: unknown[]) => void | Promise<void>
  onQueued?: (reason: Exclude<QueueReason, 'runtime_capacity'>) => void | Promise<void>
  onStarted?: (localHermesRunId: string) => void | Promise<void>
  resumeRunId?: string
}
type HermesRunner = (body: HermesInput, helpers?: HermesHelpers) => Promise<unknown>

const digest = (v: string) => createHash('sha256').update(v).digest('hex')

function receipt(
  job: Job,
  device: Device,
  event: 'queued' | 'accepted' | 'progress' | 'completed' | 'failed' | 'cancelled',
  outcome: 'queued' | 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled',
  acceptedAt: string,
  toolStartedAt: string,
  output: string,
  error: string,
  extra: { queueReason?: QueueReason; localHermesRunId?: string } = {},
) {
  const body = {
    jobId: job.jobId,
    requestId: job.requestId,
    deviceId: device.deviceId,
    mappingId: job.mappingId,
    credentialVersion: device.credentialVersion,
    attempt: job.attempt,
    leaseToken: job.leaseToken,
    event,
    outcome,
    timestamp: new Date().toISOString(),
    acceptedAt,
    toolStartedAt,
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.30',
    machineLabel: os.hostname(),
    outputSha256: digest(output),
    outputBytes: Buffer.byteLength(output),
    errorSha256: digest(error),
    errorBytes: Buffer.byteLength(error),
    ...extra,
  }
  const payload = [
    body.jobId, body.requestId, body.deviceId, body.mappingId, String(body.credentialVersion),
    String(body.attempt), body.leaseToken, body.event, body.outcome, body.timestamp,
    body.acceptedAt, body.toolStartedAt, body.runtimeVersion, body.machineLabel,
    body.outputSha256, String(body.outputBytes), body.errorSha256, String(body.errorBytes),
    ...(body.queueReason !== undefined || body.localHermesRunId !== undefined
      ? [body.queueReason ?? '', body.localHermesRunId ?? '']
      : []),
  ].join('\n')
  return {
    ...body,
    signature: sign(null, Buffer.from(payload), createPrivateKey(device.privateKey)).toString('base64url'),
  }
}

export async function executeJob(
  job: Job,
  device: Device,
  registry: MappingRegistry,
  post: (path: string, body: JSONValue) => Promise<Response>,
  hermes: HermesRunner,
  options: { progressIntervalMs?: number } = {},
) {
  if (job.cancelled) return { cancelled: true }
  const sharedWorkingDirectory = registry.resolve(job.mappingId, job.relativeFolder, job.workingDirectory)
  // Kanban tasks may mutate a repository. Before Hermes is allowed to start, move
  // those jobs into a deterministic task branch/worktree. Ordinary Messages chats
  // retain their mapped directory because they are not watcher-owned code tasks.
  const worktree = job.kanbanTaskId
    ? prepareTaskWorktree({ repositoryRoot: sharedWorkingDirectory, taskId: job.kanbanTaskId })
    : null
  const preflightError = worktree && !worktree.ok && worktree.code !== 'not_git_repository'
    ? `TASK_WORKTREE_BLOCKED:${worktree.code}: ${worktree.message}`
    : null
  const working_directory = worktree?.ok ? worktree.workingDirectory : sharedWorkingDirectory
  let acceptedAt = new Date().toISOString()
  let toolStartedAt = acceptedAt
  // A claim has reached this runtime, but it has not yet been rejected by a
  // Hermes gateway. Do not present that normal hand-off as a capacity limit.
  let queueReason: QueueReason | undefined
  let started = false
  let localHermesRunId = job.localHermesRunId

  let renewal: Promise<void> = Promise.resolve()
  let leaseError: Error | undefined
  let eventFlush: Promise<void> = Promise.resolve()
  const initialQueue = await post(`/runs/${job.jobId}/progress`, {
    receipt: receipt(job, device, 'queued', 'queued', acceptedAt, toolStartedAt, '', '',
      queueReason ? { queueReason } : {}),
  })
  if (!initialQueue.ok && initialQueue.status !== 409) throw new Error('queued receipt rejected')
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      try {
        const response = await post(`/runs/${job.jobId}/progress`, {
          receipt: started
            ? receipt(job, device, 'progress', 'running', acceptedAt, toolStartedAt, '', '', { localHermesRunId })
            : receipt(job, device, 'queued', 'queued', acceptedAt, toolStartedAt, '', '',
              queueReason ? { queueReason } : {}),
        })
        if (!response.ok && response.status !== 409) leaseError = new Error('lease renewal rejected')
      } catch {
        leaseError = new Error('lease renewal failed')
      }
    })
  }, options.progressIntervalMs ?? 10_000)

  let output = ''
  let error = ''
  let status: 'completed' | 'failed' = 'completed'
  let abandonForReclaim: Error | undefined
  const runHermes = async (resumeRunId?: string) => hermes(
    {
      prompt: job.prompt,
      images: job.images,
      model: job.model,
      provider: job.provider,
      working_directory,
      ...(job.yolo ? { yolo: true } : {}),
    },
    {
      resumeRunId,
      onQueued: async (reason) => {
        queueReason = reason
        started = false
        const response = await post(`/runs/${job.jobId}/progress`, {
          receipt: receipt(job, device, 'queued', 'queued', acceptedAt, toolStartedAt, '', '', { queueReason }),
        })
        if (!response.ok && response.status !== 409) throw new Error('queued receipt rejected')
      },
      onStarted: async (runId) => {
        // Flip before awaiting the acceptance POST so a slow network cannot
        // emit a later queued renewal that regresses this started run.
        started = true
        localHermesRunId = runId
        acceptedAt = new Date().toISOString()
        toolStartedAt = acceptedAt
        const response = await post(`/runs/${job.jobId}/progress`, {
          receipt: receipt(job, device, 'accepted', 'accepted', acceptedAt, toolStartedAt, '', '', { localHermesRunId: runId }),
        })
        if (!response.ok && response.status !== 409) throw new Error('acceptance receipt rejected')
      },
      onEvents: (events) => {
        if (!Array.isArray(events) || events.length === 0) return
        eventFlush = eventFlush.then(async () => {
          const response = await post(`/runs/${job.jobId}/progress`, {
            receipt: receipt(job, device, 'progress', 'running', acceptedAt, toolStartedAt, '', '', { localHermesRunId }),
            events: events as JSONValue[],
          })
          if (!response.ok && response.status !== 409) leaseError = new Error('event progress rejected')
        }).catch(() => {
          leaseError = new Error('event progress failed')
        })
      },
    },
  )
  try {
    let result: unknown
    if (preflightError) throw new Error(preflightError)
    try {
      result = await runHermes(job.localHermesRunId)
    } catch (firstErr) {
      // Browser/CDP tool death ends the Hermes run. Retry once with a fresh
      // local run so the conversation never surfaces a permanent interrupt.
      if (isLocalHermesBrowserToolFailure(firstErr)) {
        started = false
        localHermesRunId = undefined
        queueReason = 'runtime_restarting'
        await post(`/runs/${job.jobId}/progress`, {
          receipt: receipt(job, device, 'queued', 'queued', acceptedAt, toolStartedAt, '', '', { queueReason }),
        }).catch(() => undefined)
        result = await runHermes(undefined)
      } else {
        throw firstErr
      }
    }
    output = typeof result === 'string' ? result : JSON.stringify(result) ?? 'null'
  } catch (err) {
    // Drain / capacity / runtime upgrade / gateway bounce: do not hard-fail the
    // conversation. Drop the lease so the same job can be reclaimed and reattached.
    if (
      isLocalHermesGatewayDrainingError(err)
      || isLocalHermesCapacityError(err)
      || isLocalHermesTransientInfrastructureError(err)
      || isLocalHermesNonTerminalExecutionError(err)
    ) {
      abandonForReclaim = err instanceof Error ? err : new Error(String(err ?? 'gateway draining'))
    } else {
      status = 'failed'
      const message = err instanceof Error ? err.message.replace(/\s+/g, ' ').trim() : ''
      error = message && message.length <= 400
        ? message
        : message
          ? `${message.slice(0, 399)}…`
          : 'Local Hermes execution failed'
    }
  } finally {
    clearInterval(timer)
    await renewal
    await eventFlush
  }
  if (abandonForReclaim) throw abandonForReclaim
  if (leaseError) throw leaseError

  const terminal = receipt(job, device, status, status, acceptedAt, toolStartedAt, output, error, { localHermesRunId })
  let response: Response | undefined
  for (let n = 0; n < 3; n++) {
    response = await post(`/runs/${job.jobId}/complete`, { outcome: status, output, error, receipt: terminal })
    if (response.ok || response.status === 409) break
    await new Promise((r) => setTimeout(r, 100 * (2 ** n)))
  }
  if (!response?.ok && response?.status !== 409) throw new Error('completion retry exhausted')
  return { status, output, error, receipt: terminal }
}

// Cap idle claim polls at 5s (was 1s). Each claim is a signed device request
// that writes a Firestore nonce + later TTL delete. Two always-on devices at
// 1s idle created material write/delete spend without improving latency.
const MAX_IDLE_CLAIM_BASE_DELAY_MS = 5_000

/** A healthy Hermes profile has its own ten-session admission budget. */
export const LINKED_RUN_MAX_CONCURRENCY_PER_AGENT = 10
/**
 * Default host protection. The effective total is this ceiling or ten times
 * the number of healthy profiles, whichever is lower.
 */
export const LINKED_RUN_DEFAULT_MAX_TOTAL_CONCURRENCY = 64

export type LinkedRunClaimCapacity = {
  /** Hermes profiles whose local ten-session budget is fully reserved. */
  saturatedAgentIds: string[]
}

function linkedRunAgentId(job: Pick<Job, 'agentId'> | { agentId?: string }): string {
  const agentId = typeof job.agentId === 'string' ? job.agentId.trim().toLowerCase() : ''
  return agentId || 'pip'
}

/**
 * Shared local admission state. A reservation begins immediately after a
 * claim, before its asynchronous Hermes call begins, preventing a rapid
 * series of claims from overbooking one profile.
 */
export class LinkedRunProfileCapacity {
  private readonly active = new Map<string, number>()
  private healthyAgentIds = new Set<string>(['pip'])
  private readonly changeListeners = new Set<() => void>()

  constructor(
    readonly maxPerAgent = LINKED_RUN_MAX_CONCURRENCY_PER_AGENT,
    readonly maxTotal = LINKED_RUN_DEFAULT_MAX_TOTAL_CONCURRENCY,
  ) {}

  setHealthyAgentIds(agentIds: readonly string[]): void {
    const normalized = agentIds
      .map((agentId) => linkedRunAgentId({ agentId }))
      .filter(Boolean)
    const next = new Set(normalized.length ? normalized : ['pip'])
    const changed = next.size !== this.healthyAgentIds.size
      || Array.from(next).some((agentId) => !this.healthyAgentIds.has(agentId))
    this.healthyAgentIds = next
    if (changed) {
      for (const listener of this.changeListeners) listener()
      this.changeListeners.clear()
    }
  }

  /**
   * Lets the poller wake immediately when a heartbeat discovers another
   * healthy Hermes profile. Without this, a cold runtime could reach its
   * provisional ten-Pip limit and wait for a long chat to finish even after
   * Theo and the rest of the machine were known to be healthy.
   */
  watchForChange(): { promise: Promise<void>; cancel: () => void } {
    let listener: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
      listener = () => {
        this.changeListeners.delete(listener)
        resolve()
      }
      this.changeListeners.add(listener)
    })
    return {
      promise,
      cancel: () => this.changeListeners.delete(listener),
    }
  }

  activeCount(agentId: string): number {
    return this.active.get(linkedRunAgentId({ agentId })) ?? 0
  }

  totalConcurrencyLimit(): number {
    return Math.max(1, Math.min(this.maxTotal, this.healthyAgentIds.size * this.maxPerAgent))
  }

  saturatedAgentIds(): string[] {
    return Array.from(this.active.entries())
      .filter(([, count]) => count >= this.maxPerAgent)
      .map(([agentId]) => agentId)
      .sort()
  }

  tryReserve(job: Pick<Job, 'agentId'>): (() => void) | null {
    const agentId = linkedRunAgentId(job)
    const active = this.activeCount(agentId)
    if (active >= this.maxPerAgent) return null
    this.active.set(agentId, active + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = (this.active.get(agentId) ?? 1) - 1
      if (remaining > 0) this.active.set(agentId, remaining)
      else this.active.delete(agentId)
    }
  }
}

export function linkedRunPollDelay(delay: number, random: () => number = Math.random) {
  const bounded = Math.min(Math.max(250, delay), MAX_IDLE_CLAIM_BASE_DELAY_MS)
  return bounded + Math.floor(random() * bounded)
}

export async function pollForever(
  claim: (capacity: LinkedRunClaimCapacity) => Promise<Job | null>,
  run: (job: Job) => Promise<unknown>,
  stop: () => boolean = () => false,
  options: { maxConcurrency?: number; capacity?: LinkedRunProfileCapacity } = {},
) {
  const capacity = options.capacity ?? new LinkedRunProfileCapacity()
  const inFlight = new Set<Promise<void>>()
  let delay = 250
  while (!stop()) {
    // Subscribe before reading the limit so no just-arrived heartbeat can be
    // missed between checking capacity and going to sleep.
    const capacityChange = capacity.watchForChange()
    const maxConcurrency = options.maxConcurrency === undefined
      ? capacity.totalConcurrencyLimit()
      : Math.max(1, Number.isFinite(options.maxConcurrency) ? Math.floor(options.maxConcurrency) : 1)
    if (inFlight.size >= maxConcurrency) {
      await Promise.race([Promise.race(inFlight), capacityChange.promise])
      capacityChange.cancel()
      continue
    }
    capacityChange.cancel()
    const job = await claim({ saturatedAgentIds: capacity.saturatedAgentIds() }).catch(() => null)
    if (job) {
      delay = 250
      const release = capacity.tryReserve(job)
      // The control plane receives saturatedAgentIds before claiming. If an
      // older or misconfigured server ignores that signed admission hint, do
      // not overload Hermes or tear down the entire runtime. Leave the lease
      // to expire/reclaim and wait for a local slot or a fresh profile
      // heartbeat before asking again. The current control plane has a
      // durable server-side guard, so this is a safe mixed-version fallback.
      if (!release) {
        const nextCapacityChange = capacity.watchForChange()
        if (inFlight.size > 0) {
          await Promise.race([Promise.race(inFlight), nextCapacityChange.promise])
        } else {
          await new Promise((resolve) => setTimeout(resolve, linkedRunPollDelay(delay)))
          delay = Math.min(delay * 2, MAX_IDLE_CLAIM_BASE_DELAY_MS)
        }
        nextCapacityChange.cancel()
        continue
      }
      const task: Promise<void> = Promise.resolve()
        .then(() => run(job))
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          release()
          inFlight.delete(task)
        })
      inFlight.add(task)
    } else {
      await new Promise((r) => setTimeout(r, linkedRunPollDelay(delay)))
      delay = Math.min(delay * 2, MAX_IDLE_CLAIM_BASE_DELAY_MS)
    }
  }
  await Promise.allSettled(inFlight)
}
