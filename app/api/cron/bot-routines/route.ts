/**
 * GET /api/cron/bot-routines — fire due PiB-owned schedule routines.
 * Protect with CRON_SECRET like other platform crons.
 */
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { processDueRoutines } from '@/lib/routines/service'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  try {
    const fired = await processDueRoutines(Date.now())
    return apiSuccess({
      firedCount: fired.length,
      runs: fired.map((r) => ({
        runId: r.runId,
        routineId: r.routineId,
        orgId: r.orgId,
        status: r.status,
      })),
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), 500)
  }
}
