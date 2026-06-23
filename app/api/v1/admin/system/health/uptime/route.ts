/**
 * GET /api/v1/admin/system/health/uptime
 *
 * Computes 30-day uptime % per service from the `health_checks` collection
 * (written by GET /api/v1/admin/system/health on every probe). Also derives an
 * incidents list = contiguous runs where a service was down/degraded.
 *
 * On a fresh install the data is sparse — uptime is labelled with the number of
 * recorded checks it is based on. We avoid composite indexes by reading a
 * single single-field-filtered slice (checkedAtMs >= cutoff) and aggregating in
 * memory.
 *
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { HEALTH_CHECKS_COLLECTION } from '@/lib/observability/health-probe'

export const dynamic = 'force-dynamic'

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

type CheckRow = {
  service?: string
  name?: string
  status?: string
  latencyMs?: number | null
  checkedAtMs?: number
}

interface Incident {
  service: string
  serviceName: string
  startedAt: string
  endedAt: string | null // null = ongoing
  worstStatus: 'degraded' | 'down'
  checks: number
}

export const GET = withAuth('admin', async (_req: NextRequest) => {
  const cutoff = Date.now() - WINDOW_MS

  // Single-field range filter — no composite index needed.
  const snap = await adminDb
    .collection(HEALTH_CHECKS_COLLECTION)
    .where('checkedAtMs', '>=', cutoff)
    .get()

  const rows: CheckRow[] = snap.docs.map((d) => d.data() as CheckRow)

  // Group by service.
  const byService = new Map<string, CheckRow[]>()
  const names = new Map<string, string>()
  for (const row of rows) {
    if (!row.service) continue
    if (!byService.has(row.service)) byService.set(row.service, [])
    byService.get(row.service)!.push(row)
    if (row.name) names.set(row.service, row.name)
  }

  const uptime: Array<{
    service: string
    serviceName: string
    totalChecks: number
    okChecks: number
    uptimePct: number | null
    avgLatencyMs: number | null
  }> = []

  const incidents: Incident[] = []

  for (const [service, checks] of byService.entries()) {
    checks.sort((a, b) => (a.checkedAtMs ?? 0) - (b.checkedAtMs ?? 0))
    const total = checks.length
    const okCount = checks.filter((c) => c.status === 'ok').length

    const latencies = checks.map((c) => c.latencyMs).filter((n): n is number => typeof n === 'number')
    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length)
      : null

    uptime.push({
      service,
      serviceName: names.get(service) ?? service,
      totalChecks: total,
      okChecks: okCount,
      uptimePct: total > 0 ? Math.round((okCount / total) * 1000) / 10 : null,
      avgLatencyMs: avgLatency,
    })

    // Derive incidents: contiguous runs of down/degraded.
    let current: Incident | null = null
    for (const c of checks) {
      const bad = c.status === 'down' || c.status === 'degraded'
      const at = new Date(c.checkedAtMs ?? 0).toISOString()
      if (bad) {
        if (!current) {
          current = {
            service,
            serviceName: names.get(service) ?? service,
            startedAt: at,
            endedAt: null,
            worstStatus: c.status === 'down' ? 'down' : 'degraded',
            checks: 1,
          }
        } else {
          current.checks += 1
          if (c.status === 'down') current.worstStatus = 'down'
        }
      } else if (current) {
        current.endedAt = at
        incidents.push(current)
        current = null
      }
    }
    if (current) incidents.push(current) // ongoing
  }

  incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  return apiSuccess({
    windowDays: 30,
    totalRecordedChecks: rows.length,
    uptime,
    incidents,
    note:
      rows.length === 0
        ? 'No health checks recorded yet — uptime populates as the health probe runs.'
        : `Based on ${rows.length} recorded check${rows.length === 1 ? '' : 's'} across the last 30 days.`,
  })
})
