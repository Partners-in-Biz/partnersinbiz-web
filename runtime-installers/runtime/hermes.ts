import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveHermesBinary } from './hermes-profile-lifecycle'

type RuntimeEnv = Record<string, string | undefined>

export type LocalHermesRoute = {
  agentId: string
  baseUrl: string
  apiKey?: string
}

export type LocalHermesProbe = {
  availableAgentIds: string[]
  hermesVersion?: string
  healthReason?: 'hermes_unavailable' | 'hermes_binary_missing' | 'no_agents_available'
}

const AGENT_ID = /^[a-z][a-z0-9._-]{0,39}$/

function cleanAgentId(value: unknown): string {
  const clean = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!AGENT_ID.test(clean)) throw new Error('invalid local Hermes agent id')
  return clean
}

function loopbackBaseUrl(value: unknown): string {
  const clean = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  const url = new URL(clean)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('local Hermes route must use loopback HTTP')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid local Hermes route')
  return url.toString().replace(/\/$/, '')
}

function configuredAgentIds(env: RuntimeEnv): string[] {
  const values = (env.PIB_LOCAL_HERMES_AGENTS || env.PIB_LOCAL_HERMES_AGENT_ID || 'pip')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(cleanAgentId)
  return [...new Set(values)]
}

function hermesHome(env: RuntimeEnv): string {
  return env.PIB_HERMES_HOME || env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

function envFileValue(file: string, key: string): string | undefined {
  try {
    const line = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${key}=`))
    if (!line) return undefined
    const raw = line.slice(key.length + 1).trim()
    const value = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw
    return value || undefined
  } catch { return undefined }
}

function defaultLocalHermesApiKey(env: RuntimeEnv): string | undefined {
  return env.PIB_LOCAL_HERMES_API_KEY || envFileValue(path.join(hermesHome(env), '.env'), 'API_SERVER_KEY')
}

function localPort(value: unknown, fallback?: number): number | null {
  const port = Number(value ?? fallback)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
}

/** Discover named Hermes profiles without copying their keys into PiB state. */
function discoveredHermesRoutes(env: RuntimeEnv): LocalHermesRoute[] {
  const home = hermesHome(env)
  const routes = new Map<string, LocalHermesRoute>()
  const defaultAgentId = cleanAgentId(env.PIB_LOCAL_HERMES_AGENT_ID || 'pip')
  const defaultEnvFile = path.join(home, '.env')
  const defaultPort = localPort(envFileValue(defaultEnvFile, 'API_SERVER_PORT'), 8755)
  if (defaultPort) {
    const apiKey = env.PIB_LOCAL_HERMES_API_KEY || envFileValue(defaultEnvFile, 'API_SERVER_KEY')
    routes.set(defaultAgentId, { agentId: defaultAgentId, baseUrl: `http://127.0.0.1:${defaultPort}`, ...(apiKey ? { apiKey } : {}) })
  }
  try {
    for (const entry of fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !AGENT_ID.test(entry.name)) continue
      const profileEnv = path.join(home, 'profiles', entry.name, '.env')
      const port = localPort(envFileValue(profileEnv, 'API_SERVER_PORT'))
      if (!port) continue
      const apiKey = envFileValue(profileEnv, 'API_SERVER_KEY')
      // A named profile is the explicit agent identity. Prefer it over a
      // same-named default gateway so linked computers cannot silently route
      // into a personal/global Hermes policy (for example manual approvals)
      // when the PiB-managed profile has a different policy and port.
      routes.set(entry.name, { agentId: entry.name, baseUrl: `http://127.0.0.1:${port}`, ...(apiKey ? { apiKey } : {}) })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return Array.from(routes.values()).sort((left, right) => left.agentId.localeCompare(right.agentId))
}

export function localHermesRoutes(env: RuntimeEnv = process.env): LocalHermesRoute[] {
  const fallbackApiKey = defaultLocalHermesApiKey(env)
  const rawRoutes = env.PIB_LOCAL_HERMES_ROUTES?.trim()
  if (rawRoutes) {
    let parsed: unknown
    try { parsed = JSON.parse(rawRoutes) } catch { throw new Error('PIB_LOCAL_HERMES_ROUTES must be valid JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PIB_LOCAL_HERMES_ROUTES must be an object')
    return Object.entries(parsed as Record<string, unknown>).map(([rawAgentId, value]) => {
      const agentId = cleanAgentId(rawAgentId)
      if (typeof value === 'string') return { agentId, baseUrl: loopbackBaseUrl(value), ...(fallbackApiKey ? { apiKey: fallbackApiKey } : {}) }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid local Hermes route for ${agentId}`)
      const row = value as Record<string, unknown>
      return {
        agentId,
        baseUrl: loopbackBaseUrl(row.baseUrl),
        ...(typeof row.apiKey === 'string' && row.apiKey ? { apiKey: row.apiKey } : fallbackApiKey ? { apiKey: fallbackApiKey } : {}),
      }
    })
  }

  if (!env.PIB_LOCAL_HERMES && !env.PIB_LOCAL_HERMES_AGENTS && env.PIB_LOCAL_HERMES_AUTO_DISCOVER !== '0') {
    return discoveredHermesRoutes(env)
  }

  const baseTemplate = env.PIB_LOCAL_HERMES || 'http://127.0.0.1:8755'
  const agentIds = configuredAgentIds(env)
  if (!baseTemplate.includes('{agent}') && agentIds.length > 1) {
    throw new Error('multiple local Hermes agents require PIB_LOCAL_HERMES_ROUTES or an {agent} URL template')
  }
  return agentIds.map((agentId) => ({
    agentId,
    baseUrl: loopbackBaseUrl(baseTemplate.replaceAll('{agent}', agentId)),
    ...(fallbackApiKey ? { apiKey: fallbackApiKey } : {}),
  }))
}

function authHeaders(route: LocalHermesRoute): Record<string, string> {
  return route.apiKey ? { authorization: `Bearer ${route.apiKey}` } : {}
}

export async function probeLocalHermes(
  env: RuntimeEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<LocalHermesProbe> {
  const hermesBin = resolveHermesBinary(env as NodeJS.ProcessEnv)
  let routes: LocalHermesRoute[]
  try {
    routes = localHermesRoutes(env)
  } catch {
    return {
      availableAgentIds: [],
      healthReason: hermesBin ? 'hermes_unavailable' : 'hermes_binary_missing',
    }
  }
  if (routes.length === 0) {
    return {
      availableAgentIds: [],
      healthReason: hermesBin ? 'no_agents_available' : 'hermes_binary_missing',
    }
  }
  const healthy: string[] = []
  let hermesVersion: string | undefined
  await Promise.all(routes.map(async (route) => {
    try {
      const response = await fetcher(`${route.baseUrl}/v1/health`, {
        headers: authHeaders(route),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return
      healthy.push(route.agentId)
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      const version = typeof body?.version === 'string' ? body.version.trim() : ''
      if (!hermesVersion && version && version.length <= 64) hermesVersion = version
    } catch { /* An unavailable profile is omitted from the advertised inventory. */ }
  }))
  healthy.sort()
  return healthy.length > 0
    ? { availableAgentIds: healthy, ...(hermesVersion ? { hermesVersion } : {}) }
    : {
        availableAgentIds: [],
        healthReason: hermesBin ? 'hermes_unavailable' : 'hermes_binary_missing',
      }
}

function truncateDetail(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function hermesFailureDetail(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return ''
  for (const key of ['error', 'errorMessage', 'message', 'reason', 'detail']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return truncateDetail(value)
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>
      for (const nestedKey of ['message', 'code', 'type']) {
        if (typeof nested[nestedKey] === 'string' && nested[nestedKey].trim()) {
          return truncateDetail(String(nested[nestedKey]))
        }
      }
    }
  }
  if (typeof payload.status === 'string' && payload.status.trim()) {
    return truncateDetail(`status=${payload.status}`)
  }
  return ''
}

function hermesHttpFailure(status: number, bodyText: string, fallback: string): Error {
  const detail = truncateDetail(bodyText)
  return new Error(detail ? `${fallback} (HTTP ${status}: ${detail})` : `${fallback} (HTTP ${status})`)
}

/** True when Hermes is finishing existing work and will accept new turns after a short wait. */
export function isLocalHermesGatewayDrainingBody(status: number, bodyText: string): boolean {
  if (status !== 503) return false
  const clean = bodyText.replace(/\s+/g, ' ').toLowerCase()
  return clean.includes('gateway_draining') || clean.includes('draining existing work')
}

/** True when a linked-runtime start error is a temporary gateway drain (retry / reclaim, do not hard-fail chat). */
export function isLocalHermesGatewayDrainingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /gateway_draining|draining existing work/i.test(message)
}

export function isLocalHermesCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /rate_limit_exceeded|capacity window|runtime capacity|runtime restarting/i.test(message)
}

/** Match the server's durable queue-start deadline. */
export const LOCAL_HERMES_START_RETRY_DEFAULT_MS = 45 * 60_000

function localHermesStartRetryBudgetMs(env: RuntimeEnv): number {
  const raw = Number(env.PIB_LOCAL_HERMES_START_RETRY_MS ?? LOCAL_HERMES_START_RETRY_DEFAULT_MS)
  if (!Number.isFinite(raw)) return LOCAL_HERMES_START_RETRY_DEFAULT_MS
  // 0 disables retries (tests / fail-fast). Never exceed the public queue window.
  return Math.min(Math.max(0, Math.floor(raw)), 45 * 60_000)
}

function gatewayDrainRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const asNumber = Number(retryAfter)
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.min(Math.max(Math.floor(asNumber * 1000), 200), 5_000)
    }
  }
  // 1s, 2s, 4s, then cap at 5s — Hermes advertises Retry-After: 1 for drain.
  return Math.min(1_000 * (2 ** Math.min(Math.max(attempt, 0), 3)), 5_000)
}

export async function callLocalHermes(
  agentId: string,
  body: { prompt: string; images?: Array<{ url: string; contentType: string }>; model?: string; provider?: string; working_directory: string; yolo?: boolean },
  env: RuntimeEnv = process.env,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  helpersOrOnEvents: {
    onEvents?: (events: unknown[]) => void | Promise<void>
    onQueued?: (reason: 'agent_capacity' | 'gateway_draining' | 'runtime_restarting') => void | Promise<void>
    onStarted?: (localHermesRunId: string) => void | Promise<void>
    resumeRunId?: string
  } | ((events: unknown[]) => void | Promise<void>) = {},
): Promise<unknown> {
  const helpers = typeof helpersOrOnEvents === 'function'
    ? { onEvents: helpersOrOnEvents }
    : helpersOrOnEvents
  const cleanAgent = cleanAgentId(agentId)
  const route = localHermesRoutes(env).find((candidate) => candidate.agentId === cleanAgent)
  if (!route) throw new Error(`Hermes agent ${cleanAgent} is not installed on this computer`)
  const startBody = JSON.stringify({
    input: body.images?.length ? [{
      role: 'user',
      content: [
        { type: 'text', text: body.prompt },
        ...body.images.map((image) => ({ type: 'image_url', image_url: { url: image.url } })),
      ],
    }] : body.prompt,
    ...(body.model ? { model: body.model } : {}),
    ...(body.provider ? { provider: body.provider } : {}),
    ...(body.yolo ? { yolo: true } : {}),
    working_directory: body.working_directory,
  })
  const startRetryBudgetMs = localHermesStartRetryBudgetMs(env)
  const startDeadline = Date.now() + startRetryBudgetMs
  let startText = ''
  let drainAttempts = 0
  let runId = ''
  if (helpers.resumeRunId && /^[A-Za-z0-9_-]{1,128}$/.test(helpers.resumeRunId)) {
    while (!runId) {
      let resumed: Response
      try {
        resumed = await fetcher(`${route.baseUrl}/v1/runs/${encodeURIComponent(helpers.resumeRunId)}`, {
          headers: authHeaders(route),
          signal: AbortSignal.timeout(15_000),
        })
      } catch {
        if (Date.now() >= startDeadline) throw new Error(`Local Hermes ${cleanAgent} runtime restarting; reattachment retry window exhausted`)
        await helpers.onQueued?.('runtime_restarting')
        await wait(Math.min(1_000 * (2 ** Math.min(drainAttempts, 3)), 5_000))
        drainAttempts += 1
        continue
      }
      if (resumed.ok) {
        runId = helpers.resumeRunId
      } else if (resumed.status === 404) {
        break
      } else {
        const detail = await resumed.text().catch(() => '')
        const draining = isLocalHermesGatewayDrainingBody(resumed.status, detail)
        if (draining && Date.now() < startDeadline) {
          await helpers.onQueued?.('gateway_draining')
          await wait(gatewayDrainRetryDelayMs(resumed, drainAttempts))
          drainAttempts += 1
          continue
        }
        throw hermesHttpFailure(resumed.status, detail, `Local Hermes ${cleanAgent} reattachment failed`)
      }
    }
  }
  while (!runId) {
    let response: Response
    try {
      response = await fetcher(`${route.baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(route) },
        body: startBody,
      })
    } catch {
      if (Date.now() >= startDeadline) throw new Error(`Local Hermes ${cleanAgent} runtime restarting; start retry window exhausted`)
      await helpers.onQueued?.('runtime_restarting')
      await wait(Math.min(1_000 * (2 ** Math.min(drainAttempts, 3)), 5_000))
      drainAttempts += 1
      continue
    }
    startText = await response.text().catch(() => '')
    if (response.ok) {
      const started = (() => {
        try { return startText ? JSON.parse(startText) as Record<string, unknown> : null } catch { return null }
      })()
      runId = typeof started?.run_id === 'string' ? started.run_id : typeof started?.id === 'string' ? started.id : ''
      break
    }
    const draining = isLocalHermesGatewayDrainingBody(response.status, startText)
    const atCapacity = response.status === 429 && /rate_limit_exceeded|capacity/i.test(startText)
    if ((draining || atCapacity) && Date.now() < startDeadline) {
      await helpers.onQueued?.(draining ? 'gateway_draining' : 'agent_capacity')
      await wait(gatewayDrainRetryDelayMs(response, drainAttempts))
      drainAttempts += 1
      continue
    }
    throw hermesHttpFailure(response.status, startText, `Local Hermes ${cleanAgent} refused to start`)
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) {
    const detail = truncateDetail(startText)
    throw new Error(detail
      ? `Local Hermes ${cleanAgent} did not return a run id (${detail})`
      : `Local Hermes ${cleanAgent} did not return a run id`)
  }
  await helpers.onStarted?.(runId)
  const rawTimeout = Number(env.PIB_LOCAL_HERMES_RUN_TIMEOUT_MS ?? 30 * 60_000)
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(Math.max(rawTimeout, 30_000), 24 * 60 * 60_000) : 30 * 60_000
  const deadline = Date.now() + timeoutMs
  const abort = new AbortController()
  const autoApprove = Boolean(body.yolo)
  const eventsTask = helpers.onEvents || autoApprove
    ? forwardLocalHermesEvents(route, runId, fetcher, abort.signal, async (events) => {
      if (autoApprove) {
        for (const raw of events) {
          const event = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
          const type = typeof event.event === 'string' ? event.event : typeof event.type === 'string' ? event.type : ''
          if (type === 'approval.required' || type === 'approval_required') {
            await fetcher(`${route.baseUrl}/v1/runs/${encodeURIComponent(runId)}/approval`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...authHeaders(route) },
              body: JSON.stringify({ choice: 'always' }),
            }).catch(() => undefined)
          }
        }
      }
      if (helpers.onEvents) await helpers.onEvents(events)
    })
    : Promise.resolve()
  try {
    while (Date.now() < deadline) {
      const runResponse = await fetcher(`${route.baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
        headers: authHeaders(route),
        signal: AbortSignal.timeout(15_000),
      })
      const runText = await runResponse.text().catch(() => '')
      if (!runResponse.ok) throw hermesHttpFailure(runResponse.status, runText, `Local Hermes ${cleanAgent} poll failed`)
      const run = (() => {
        try { return runText ? JSON.parse(runText) as Record<string, unknown> : null } catch { return null }
      })()
      if (run?.status === 'completed') {
        if (typeof run.output === 'string') return run.output
        const result = run.result && typeof run.result === 'object' ? run.result as Record<string, unknown> : null
        if (typeof result?.output === 'string') return result.output
        return run
      }
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        const detail = hermesFailureDetail(run) || String(run?.status || 'failed')
        throw new Error(`Local Hermes ${cleanAgent} ${detail}`)
      }
      await wait(1_000)
    }
    throw new Error(`Local Hermes ${cleanAgent} timed out after ${Math.round(timeoutMs / 1000)}s`)
  } finally {
    abort.abort()
    await eventsTask.catch(() => undefined)
  }
}

export async function listLocalHermesModels(
  agentId: string,
  env: RuntimeEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const cleanAgent = cleanAgentId(agentId)
  const route = localHermesRoutes(env).find((candidate) => candidate.agentId === cleanAgent)
  if (!route) throw new Error(`Hermes agent ${cleanAgent} is not installed on this computer`)
  const response = await fetcher(`${route.baseUrl}/v1/models`, {
    headers: authHeaders(route),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) throw new Error(`Local Hermes ${cleanAgent} model catalogue failed (HTTP ${response.status})`)
  const entries = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  return [...new Set(entries.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : typeof row.model === 'string' ? row.model : ''
    return id ? [id] : []
  }))].slice(0, 256)
}

async function forwardLocalHermesEvents(
  route: LocalHermesRoute,
  runId: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  onEvents: (events: unknown[]) => void | Promise<void>,
): Promise<void> {
  try {
    const response = await fetcher(`${route.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: { ...authHeaders(route), accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok || !response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let batch: unknown[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = async () => {
      if (batch.length === 0) return
      const events = batch
      batch = []
      await onEvents(events)
    }

    const scheduleFlush = () => {
      if (flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        void flush().catch(() => undefined)
      }, 400)
    }

    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data || data === '[DONE]') continue
        try {
          batch.push(JSON.parse(data))
          if (batch.length >= 8) await flush()
          else scheduleFlush()
        } catch {
          // Ignore malformed SSE chunks from local Hermes.
        }
      }
    }
    if (flushTimer) clearTimeout(flushTimer)
    await flush()
  } catch {
    // Event forwarding is best-effort; run completion still comes from status polling.
  }
}
