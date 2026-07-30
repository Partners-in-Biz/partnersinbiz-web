import { createHash, createPrivateKey, sign } from 'node:crypto'
import os from 'node:os'
import { MappingRegistry } from './bridge'
import type { JSONValue } from './core'
import { isLocalHermesGatewayDrainingError } from './hermes'

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
type HermesHelpers = { onEvents?: (events: unknown[]) => void | Promise<void> }
type HermesRunner = (body: HermesInput, helpers?: HermesHelpers) => Promise<unknown>

const digest = (v: string) => createHash('sha256').update(v).digest('hex')

function receipt(
  job: Job,
  device: Device,
  event: 'accepted' | 'progress' | 'completed' | 'failed' | 'cancelled',
  outcome: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled',
  acceptedAt: string,
  toolStartedAt: string,
  output: string,
  error: string,
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
    runtimeVersion: process.env.PIB_RUNTIME_VERSION || '1.1.13',
    machineLabel: os.hostname(),
    outputSha256: digest(output),
    outputBytes: Buffer.byteLength(output),
    errorSha256: digest(error),
    errorBytes: Buffer.byteLength(error),
  }
  const payload = [
    body.jobId, body.requestId, body.deviceId, body.mappingId, String(body.credentialVersion),
    String(body.attempt), body.leaseToken, body.event, body.outcome, body.timestamp,
    body.acceptedAt, body.toolStartedAt, body.runtimeVersion, body.machineLabel,
    body.outputSha256, String(body.outputBytes), body.errorSha256, String(body.errorBytes),
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
  const working_directory = registry.resolve(job.mappingId, job.relativeFolder, job.workingDirectory)
  const acceptedAt = new Date().toISOString()
  const toolStartedAt = new Date().toISOString()
  const acceptance = receipt(job, device, 'accepted', 'accepted', acceptedAt, toolStartedAt, '', '')
  const progress = await post(`/runs/${job.jobId}/progress`, { receipt: acceptance })
  if (!progress.ok && progress.status !== 409) throw new Error('acceptance receipt rejected')

  let renewal: Promise<void> = Promise.resolve()
  let leaseError: Error | undefined
  let eventFlush: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      try {
        const response = await post(`/runs/${job.jobId}/progress`, {
          receipt: receipt(job, device, 'progress', 'running', acceptedAt, toolStartedAt, '', ''),
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
  try {
    const result = await hermes(
      {
        prompt: job.prompt,
        images: job.images,
        model: job.model,
        provider: job.provider,
        working_directory,
        ...(job.yolo ? { yolo: true } : {}),
      },
      {
        onEvents: (events) => {
          if (!Array.isArray(events) || events.length === 0) return
          eventFlush = eventFlush.then(async () => {
            const response = await post(`/runs/${job.jobId}/progress`, {
              receipt: receipt(job, device, 'progress', 'running', acceptedAt, toolStartedAt, '', ''),
              events: events as JSONValue[],
            })
            if (!response.ok && response.status !== 409) leaseError = new Error('event progress rejected')
          }).catch(() => {
            leaseError = new Error('event progress failed')
          })
        },
      },
    )
    output = typeof result === 'string' ? result : JSON.stringify(result) ?? 'null'
  } catch (err) {
    // Gateway drain after the short start-retry window: do not hard-fail the
    // conversation. Drop the lease so the same job can be reclaimed once the
    // agent is accepting turns again (queued message before agent finished).
    if (isLocalHermesGatewayDrainingError(err)) {
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

  const terminal = receipt(job, device, status, status, acceptedAt, toolStartedAt, output, error)
  let response: Response | undefined
  for (let n = 0; n < 3; n++) {
    response = await post(`/runs/${job.jobId}/complete`, { outcome: status, output, error, receipt: terminal })
    if (response.ok || response.status === 409) break
    await new Promise((r) => setTimeout(r, 100 * (2 ** n)))
  }
  if (!response?.ok && response?.status !== 409) throw new Error('completion retry exhausted')
  return { status, output, error, receipt: terminal }
}

const MAX_IDLE_CLAIM_BASE_DELAY_MS = 1_000
/** Bound device-wide chat parallelism while allowing independent agent gateways to stay productive. */
export const LINKED_RUN_MAX_CONCURRENCY = 8

export function linkedRunPollDelay(delay: number, random: () => number = Math.random) {
  const bounded = Math.min(Math.max(250, delay), MAX_IDLE_CLAIM_BASE_DELAY_MS)
  return bounded + Math.floor(random() * bounded)
}

/** One Hermes gateway per agent — serialize same-agent jobs so the next turn waits for the prior one (and any drain) to settle. */
export function linkedRunAgentKey(job: Pick<Job, 'jobId' | 'agentId'>): string {
  const agent = typeof job.agentId === 'string' ? job.agentId.trim().toLowerCase() : ''
  if (agent) return `agent:${agent}`
  // Unknown agent: isolate by job so we never invent false sharing across chats.
  return `job:${job.jobId}`
}

export async function pollForever(
  claim: () => Promise<Job | null>,
  run: (job: Job) => Promise<unknown>,
  stop: () => boolean = () => false,
  options: { maxConcurrency?: number } = {},
) {
  const requestedConcurrency = options.maxConcurrency ?? LINKED_RUN_MAX_CONCURRENCY
  const maxConcurrency = Math.min(
    LINKED_RUN_MAX_CONCURRENCY,
    Math.max(1, Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : LINKED_RUN_MAX_CONCURRENCY),
  )
  const inFlight = new Set<Promise<void>>()
  /** Tail of the per-agent run chain; next same-agent job awaits this before starting Hermes. */
  const agentTails = new Map<string, Promise<void>>()
  let delay = 250
  while (!stop()) {
    if (inFlight.size >= maxConcurrency) {
      await Promise.race(inFlight)
      continue
    }
    const job = await claim().catch(() => null)
    if (job) {
      delay = 250
      const agentKey = linkedRunAgentKey(job)
      const previous = agentTails.get(agentKey) ?? Promise.resolve()
      const task: Promise<void> = previous
        .catch(() => undefined)
        .then(() => run(job))
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => inFlight.delete(task))
      inFlight.add(task)
      agentTails.set(agentKey, task)
    } else {
      await new Promise((r) => setTimeout(r, linkedRunPollDelay(delay)))
      delay = Math.min(delay * 2, MAX_IDLE_CLAIM_BASE_DELAY_MS)
    }
  }
  await Promise.allSettled(inFlight)
}
