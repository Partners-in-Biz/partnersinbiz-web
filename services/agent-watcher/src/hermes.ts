/**
 * Hermes dispatch — POST /v1/runs and poll until terminal status.
 * Mirrors the call pattern in lib/hermes/server.ts (createHermesRun).
 */
import type { AgentConfig } from './config'
import { logger } from './logger'
import { buildAgentRunTelemetry, type AgentRunTelemetry } from './run-telemetry'

const POLL_INTERVAL_MS = 2_000
const MAX_NOT_FOUND_POLLS = 5
const MAX_RETRYABLE_HTTP_POLLS = 5
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504])

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'succeeded', 'success', 'error', 'cancelled', 'canceled', 'interrupted'])
const FAILURE_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'interrupted'])

export interface RunResult {
  runId: string | null
  output: string | null
  error: string | null
  telemetry: AgentRunTelemetry
}

export interface TaskDispatchInput {
  taskId: string
  orgId: string
  agentId: string
  spec: string
  context?: Record<string, unknown>
  constraints?: string[]
  agentEffort?: string | null
  agentModel?: string | null
  agentProvider?: string | null
  llmCredentialSource?: string | null
  llmResolvedSource?: string | null
  llmConnectionId?: string | null
  llmCredentialBindingId?: string | null
  runtimeTargetId?: string | null
}

function runTimeoutMs(): number | null {
  const raw = Number(process.env.HERMES_RUN_TIMEOUT_MS)
  // Long-running local work is controlled by the runtime's health/heartbeat
  // and explicit cancellation, not an arbitrary watcher wall-clock limit.
  // A positive value keeps the optional operator-imposed timeout.
  return Number.isFinite(raw) && raw > 0
    ? Math.max(raw, 5 * 60 * 1_000)
    : null
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function extractRunId(payload: Record<string, unknown>): string | null {
  const raw = payload.run_id ?? payload.runId ?? payload.id ?? null
  if (raw == null) return null
  return String(raw)
}

function extractStatus(payload: Record<string, unknown>): string {
  const raw = payload.status ?? payload.state ?? null
  return raw == null ? '' : String(raw).toLowerCase()
}

function extractOutput(payload: Record<string, unknown>): string {
  // Best-effort extraction — Hermes shape may carry the result under any of these keys.
  for (const key of ['output', 'result', 'response', 'summary', 'message']) {
    const v = payload[key]
    if (typeof v === 'string' && v.trim()) return v
    if (v && typeof v === 'object') {
      try {
        return JSON.stringify(v)
      } catch {
        // fall through
      }
    }
  }
  // Fallback: dump the whole payload so the operator can inspect downstream.
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}

function extractError(payload: Record<string, unknown>): string {
  for (const key of ['error', 'errorMessage', 'message', 'reason']) {
    const v = payload[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return 'Hermes run ended with a failure status (no message)'
}

function responseCorrelation(res: Response): string {
  // Preserve a safe request trail across watcher, proxy, and gateway without
  // logging credentials or the original task payload.
  const values = ['x-request-id', 'x-correlation-id', 'traceparent']
    .map((name) => {
      const value = res.headers.get(name)?.trim()
      return value ? `${name}=${value.slice(0, 256)}` : ''
    })
    .filter(Boolean)
  return values.length > 0 ? ` [correlation: ${values.join(', ')}]` : ''
}

async function postRun(cfg: AgentConfig, input: TaskDispatchInput): Promise<{ runId: string; data: Record<string, unknown> }> {
  const url = joinUrl(cfg.baseUrl, '/v1/runs')
  const body = {
    input: `[Task ${input.taskId}] ${input.spec}`,
    ...(input.agentEffort ? { reasoning_effort: input.agentEffort } : {}),
    ...(input.agentModel ? { model: input.agentModel } : {}),
    ...(input.agentProvider ? { provider: input.agentProvider } : {}),
    metadata: {
      taskId: input.taskId,
      orgId: input.orgId,
      agentId: input.agentId,
      ...(input.llmCredentialSource ? { llmCredentialSource: input.llmCredentialSource } : {}),
      ...(input.llmResolvedSource ? { llmResolvedSource: input.llmResolvedSource } : {}),
      ...(input.llmConnectionId ? { llmConnectionId: input.llmConnectionId } : {}),
      ...(input.llmCredentialBindingId ? { llmCredentialBindingId: input.llmCredentialBindingId } : {}),
      ...(input.runtimeTargetId ? { runtimeTargetId: input.runtimeTargetId } : {}),
      ...(input.context ? { context: input.context } : {}),
      ...(input.constraints && input.constraints.length ? { constraints: input.constraints } : {}),
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  let data: Record<string, unknown> = {}
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = { raw: text }
    }
  }

  if (!res.ok) {
    throw new Error(`Hermes /v1/runs returned ${res.status}${responseCorrelation(res)}: ${text.slice(0, 500)}`)
  }

  const runId = extractRunId(data)
  if (!runId) {
    throw new Error(`Hermes /v1/runs did not return a run id; payload=${text.slice(0, 500)}`)
  }
  return { runId, data }
}

async function pollRun(cfg: AgentConfig, runId: string, signal: { aborted: boolean }): Promise<Record<string, unknown>> {
  const url = joinUrl(cfg.baseUrl, `/v1/runs/${encodeURIComponent(runId)}`)
  const timeoutMs = runTimeoutMs()
  const deadline = timeoutMs === null ? null : Date.now() + timeoutMs
  let notFoundPolls = 0
  let retryableHttpPolls = 0

  while (!signal.aborted) {
    if (deadline !== null && timeoutMs !== null && Date.now() > deadline) {
      throw new Error(`Hermes run ${runId} timed out after ${Math.round(timeoutMs / 1000)}s`)
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      })
    } catch (err) {
      logger.warn('Hermes poll fetch failed; retrying', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      })
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    const text = await res.text()
    let data: Record<string, unknown> = {}
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>
      } catch {
        data = { raw: text }
      }
    }

    if (!res.ok) {
      // A brief 404 can happen directly after dispatch. Repeated 404s mean Hermes
      // has lost/expired the run, so stop heartbeating the ticket as "working".
      if (res.status === 404) {
        notFoundPolls += 1
        if (notFoundPolls >= MAX_NOT_FOUND_POLLS) {
          throw new Error(`Hermes run ${runId} was not found on the agent gateway`)
        }
        retryableHttpPolls = 0
      } else if (RETRYABLE_HTTP_STATUSES.has(res.status)) {
        retryableHttpPolls += 1
        notFoundPolls = 0
        if (retryableHttpPolls >= MAX_RETRYABLE_HTTP_POLLS) {
          throw new Error(`Hermes run ${runId} returned ${res.status} repeatedly while polling`)
        }
      } else {
        notFoundPolls = 0
        retryableHttpPolls = 0
      }
      logger.warn('Hermes poll returned non-OK', { runId, status: res.status })
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    notFoundPolls = 0
    retryableHttpPolls = 0

    const status = extractStatus(data)
    if (status && TERMINAL_STATUSES.has(status)) {
      return data
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Hermes run ${runId} aborted before completion`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runAndPoll(
  cfg: AgentConfig,
  input: TaskDispatchInput,
  onRunCreated?: (runId: string) => void | Promise<void>,
): Promise<RunResult> {
  const signal = { aborted: false }
  let capturedRunId: string | null = null
  let createdPayload: Record<string, unknown> | null = null
  const startedAtMs = Date.now()
  const telemetry = (finalPayload?: Record<string, unknown> | null) => buildAgentRunTelemetry({
    requestedModel: input.agentModel,
    requestedReasoningEffort: input.agentEffort,
    startedAtMs,
    completedAtMs: Date.now(),
    payloads: [finalPayload, createdPayload],
  })
  try {
    const { runId, data } = await postRun(cfg, input)
    capturedRunId = runId
    createdPayload = data
    logger.info('Hermes run created', { taskId: input.taskId, runId, agentId: input.agentId })

    // Notify caller of runId immediately so it can persist agentConversationId before polling.
    if (onRunCreated) {
      try {
        await onRunCreated(runId)
      } catch (cbErr) {
        logger.warn('onRunCreated callback threw', {
          runId,
          error: cbErr instanceof Error ? cbErr.message : String(cbErr),
        })
      }
    }

    const final = await pollRun(cfg, runId, signal)
    const status = extractStatus(final)
    if (FAILURE_STATUSES.has(status)) {
      return { runId: capturedRunId, output: null, error: extractError(final), telemetry: telemetry(final) }
    }
    return { runId: capturedRunId, output: extractOutput(final), error: null, telemetry: telemetry(final) }
  } catch (err) {
    signal.aborted = true
    return { runId: capturedRunId, output: null, error: err instanceof Error ? err.message : String(err), telemetry: telemetry(null) }
  }
}
