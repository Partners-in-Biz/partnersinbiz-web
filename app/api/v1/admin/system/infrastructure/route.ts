/**
 * GET /api/v1/admin/system/infrastructure
 *
 * Per-host / per-agent infrastructure status (US-284). For every agent in the
 * `agent_team` registry we ping its Hermes sidecar on the VPS, trying the
 * candidate metrics endpoints (/admin/health, /admin/metrics, /admin/status)
 * and pulling whatever REAL fields the sidecar returns (uptime, pid, restart
 * count, last heartbeat, requests, RAM/CPU/disk). Anything the sidecar does NOT
 * return is reported as `null` so the UI can show "not instrumented" — we never
 * fabricate metrics.
 *
 * Hosts are derived from each agent's baseUrl. We also include the platform
 * `/api/v1/health` service probes so the page covers app-tier infra too.
 *
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { listAgents, callAgentPath } from '@/lib/agents/team'
import { probeAllServices } from '@/lib/observability/health-probe'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

const PROBE_PATHS = ['/admin/health', '/admin/metrics', '/admin/status', '/v1/health']
const PROBE_TIMEOUT_MS = 6000

type Metrics = {
  ramMB: number | null
  cpuPct: number | null
  diskPct: number | null
  loadAvg: number | null
  pid: number | null
  restartCount: number | null
  requestsToday: number | null
  uptimeSeconds: number | null
}

const NULL_METRICS: Metrics = {
  ramMB: null,
  cpuPct: null,
  diskPct: null,
  loadAvg: null,
  pid: null,
  restartCount: null,
  requestsToday: null,
  uptimeSeconds: null,
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Pull metric fields from an arbitrary sidecar JSON payload (best-effort, tolerant of shape). */
function extractMetrics(payload: unknown): Metrics {
  if (!payload || typeof payload !== 'object') return { ...NULL_METRICS }
  // Sidecars may nest under data/metrics; flatten one level for lookups.
  const root = payload as Record<string, unknown>
  const sources: Record<string, unknown>[] = [root]
  for (const k of ['data', 'metrics', 'health', 'stats', 'system']) {
    if (root[k] && typeof root[k] === 'object') sources.push(root[k] as Record<string, unknown>)
  }
  const pick = (...keys: string[]): unknown => {
    for (const src of sources) {
      for (const key of keys) {
        if (src[key] !== undefined && src[key] !== null) return src[key]
      }
    }
    return undefined
  }
  return {
    ramMB: num(pick('ramMB', 'ram_mb', 'memoryMB', 'rssMB', 'memMB')),
    cpuPct: num(pick('cpuPct', 'cpu_pct', 'cpu', 'cpuPercent')),
    diskPct: num(pick('diskPct', 'disk_pct', 'disk', 'diskPercent')),
    loadAvg: num(pick('loadAvg', 'load_avg', 'load', 'load1')),
    pid: num(pick('pid', 'processId')),
    restartCount: num(pick('restartCount', 'restart_count', 'restarts')),
    requestsToday: num(pick('requestsToday', 'requests_today', 'requestsToday', 'reqToday')),
    uptimeSeconds: num(pick('uptimeSeconds', 'uptime_seconds', 'uptime', 'uptimeSec')),
  }
}

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

export const GET = withAuth('admin', async (_req: NextRequest) => {
  const agents = await listAgents()

  const servers = await Promise.all(
    agents.map(async (agent) => {
      const host = hostFromBaseUrl(agent.baseUrl)
      let status: 'ok' | 'degraded' | 'down' = 'down'
      let metrics: Metrics = { ...NULL_METRICS }
      let probedPath: string | null = null
      const rawHeartbeat: unknown = agent.lastHealthCheck ?? null
      let lastHeartbeat: string | null =
        typeof rawHeartbeat === 'string'
          ? rawHeartbeat
          : ((rawHeartbeat as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null)
      let error: string | null = null

      for (const path of PROBE_PATHS) {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
          let result
          try {
            result = await callAgentPath(agent.agentId as AgentId, path, {
              method: 'GET',
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timer)
          }
          if (result.response.ok) {
            probedPath = path
            const extracted = extractMetrics(result.data)
            // Merge: keep first non-null value seen across endpoints.
            metrics = {
              ramMB: metrics.ramMB ?? extracted.ramMB,
              cpuPct: metrics.cpuPct ?? extracted.cpuPct,
              diskPct: metrics.diskPct ?? extracted.diskPct,
              loadAvg: metrics.loadAvg ?? extracted.loadAvg,
              pid: metrics.pid ?? extracted.pid,
              restartCount: metrics.restartCount ?? extracted.restartCount,
              requestsToday: metrics.requestsToday ?? extracted.requestsToday,
              uptimeSeconds: metrics.uptimeSeconds ?? extracted.uptimeSeconds,
            }
            status = 'ok'
            lastHeartbeat = new Date().toISOString()
            break
          } else {
            status = 'degraded'
            error = `HTTP ${result.response.status} on ${path}`
          }
        } catch (e) {
          error = e instanceof Error ? e.message : 'unreachable'
        }
      }

      // Which metrics came back null → "not instrumented" for this host.
      const notInstrumented = (Object.keys(metrics) as (keyof Metrics)[]).filter(
        (k) => metrics[k] === null,
      )

      return {
        kind: 'agent' as const,
        agentId: agent.agentId,
        name: agent.name,
        baseUrl: agent.baseUrl,
        host,
        enabled: agent.enabled,
        status,
        probedPath,
        lastHeartbeat,
        metrics,
        notInstrumented,
        error: status === 'ok' ? null : error,
      }
    }),
  )

  // App-tier services from the platform health probe.
  const platformServices = (await probeAllServices()).map((s) => ({
    kind: 'service' as const,
    key: s.key,
    name: s.name,
    status: s.status,
    latencyMs: s.latencyMs,
    latencyInstrumented: s.latencyInstrumented,
    detail: s.detail,
    lastCheckedAt: s.lastCheckedAt,
  }))

  return apiSuccess({
    servers,
    platformServices,
    checkedAt: new Date().toISOString(),
  })
})
