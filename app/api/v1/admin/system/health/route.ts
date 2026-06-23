/**
 * GET /api/v1/admin/system/health
 *
 * Real per-service health probe with measured latency (US-266). Probes
 * Firestore, Firebase Auth, PayPal, and the social-account mesh, persists each
 * run to `health_checks` (so uptime can be computed over time), and returns
 * the per-service snapshot.
 *
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { probeAllServices, recordHealthChecks } from '@/lib/observability/health-probe'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req: NextRequest) => {
  const services = await probeAllServices()

  // Persist this probe run for uptime aggregation (best-effort, non-blocking
  // for correctness but awaited so the record is durable before we respond).
  await recordHealthChecks(services)

  const overall = services.some((s) => s.status === 'down')
    ? 'down'
    : services.some((s) => s.status === 'degraded')
      ? 'degraded'
      : 'ok'

  return apiSuccess({
    overall,
    services,
    checkedAt: new Date().toISOString(),
  })
})
