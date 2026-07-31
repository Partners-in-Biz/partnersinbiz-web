/**
 * GET /api/cron/hermes-features — process due Hermes Features cron jobs (fire via /v1/runs).
 * Protect with CRON_SECRET like other platform crons.
 */
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { hermesFeaturesService } from '@/lib/hermes-features/service'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const orgId = new URL(req.url).searchParams.get('orgId')
  if (!orgId) return apiError('orgId query required', 400)
  try {
    const fired = await hermesFeaturesService.processDueCron(orgId)
    return apiSuccess({
      orgId,
      firedCount: fired.length,
      jobs: fired.map((j) => ({
        id: j.id,
        lastFireRunId: (j as { lastFireRunId?: string }).lastFireRunId,
        lastFireError: (j as { lastFireError?: string }).lastFireError,
        nextRunAt: (j as { nextRunAt?: string }).nextRunAt,
      })),
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500)
  }
}
