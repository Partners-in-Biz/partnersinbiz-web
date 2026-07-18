import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type RuntimeEnv = Record<string, string | undefined>

export type LocalHermesRoute = {
  agentId: string
  baseUrl: string
  apiKey?: string
}

export type LocalHermesProbe = {
  availableAgentIds: string[]
  hermesVersion?: string
  healthReason?: 'hermes_unavailable' | 'no_agents_available'
}

const AGENT_ID = /^[a-z][a-z0-9-]{0,63}$/

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

function defaultLocalHermesApiKey(env: RuntimeEnv): string | undefined {
  if (env.PIB_LOCAL_HERMES_API_KEY) return env.PIB_LOCAL_HERMES_API_KEY
  const hermesHome = env.HERMES_HOME || path.join(os.homedir(), '.hermes')
  try {
    const line = fs.readFileSync(path.join(hermesHome, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith('API_SERVER_KEY='))
    if (!line) return undefined
    const raw = line.slice('API_SERVER_KEY='.length).trim()
    const value = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw
    return value || undefined
  } catch { return undefined }
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
  let routes: LocalHermesRoute[]
  try { routes = localHermesRoutes(env) } catch { return { availableAgentIds: [], healthReason: 'hermes_unavailable' } }
  if (routes.length === 0) return { availableAgentIds: [], healthReason: 'no_agents_available' }
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
    : { availableAgentIds: [], healthReason: 'hermes_unavailable' }
}

export async function callLocalHermes(
  agentId: string,
  body: { prompt: string; model?: string; provider?: string; working_directory: string },
  env: RuntimeEnv = process.env,
  fetcher: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<unknown> {
  const cleanAgent = cleanAgentId(agentId)
  const route = localHermesRoutes(env).find((candidate) => candidate.agentId === cleanAgent)
  if (!route) throw new Error(`Hermes agent ${cleanAgent} is not installed on this computer`)
  const response = await fetcher(`${route.baseUrl}/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(route) },
    body: JSON.stringify({
      input: body.prompt,
      ...(body.model ? { model: body.model } : {}),
      ...(body.provider ? { provider: body.provider } : {}),
      working_directory: body.working_directory,
    }),
  })
  if (!response.ok) throw new Error('Local Hermes execution failed')
  const started = await response.json().catch(() => null) as Record<string, unknown> | null
  const runId = typeof started?.run_id === 'string' ? started.run_id : typeof started?.id === 'string' ? started.id : ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new Error('Local Hermes execution failed')
  const rawTimeout = Number(env.PIB_LOCAL_HERMES_RUN_TIMEOUT_MS ?? 30 * 60_000)
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(Math.max(rawTimeout, 30_000), 24 * 60 * 60_000) : 30 * 60_000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runResponse = await fetcher(`${route.baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: authHeaders(route),
      signal: AbortSignal.timeout(15_000),
    })
    if (!runResponse.ok) throw new Error('Local Hermes execution failed')
    const run = await runResponse.json().catch(() => null) as Record<string, unknown> | null
    if (run?.status === 'completed') {
      if (typeof run.output === 'string') return run.output
      const result = run.result && typeof run.result === 'object' ? run.result as Record<string, unknown> : null
      if (typeof result?.output === 'string') return result.output
      return run
    }
    if (run?.status === 'failed' || run?.status === 'cancelled') throw new Error('Local Hermes execution failed')
    await wait(1_000)
  }
  throw new Error('Local Hermes execution timed out')
}
