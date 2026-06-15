/**
 * GET /api/cron/conversation-runs
 *
 * Reconciles pending unified-chat Hermes runs from the server so answers are
 * written back even when the mobile/web client sleeps before polling finalize.
 */
import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { reconcilePendingConversationRuns } from '@/lib/conversations/run-finalizer'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_RECONCILE_INTERVAL_MS = 60_000
let lastReconcileStartedAt = 0

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  const authorized =
    (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) ||
    Boolean(vercelCron)

  if (!authorized) return apiError('Unauthorized', 401)

  try {
    const now = Date.now()
    if (now - lastReconcileStartedAt < MIN_RECONCILE_INTERVAL_MS) {
      return apiSuccess({ skipped: true, reason: 'recently_checked' })
    }
    lastReconcileStartedAt = now

    const summary = await runWithFirestoreReadAudit('api/cron/conversation-runs', () =>
      reconcilePendingConversationRuns({
        conversationLimit: 80,
        messageScanLimit: 20,
        maxRuns: 25,
      }),
    )
    return apiSuccess(summary)
  } catch (err) {
    console.error('[conversation-run-cron-error]', err)
    return apiError('Conversation run reconciler failed', 500)
  }
}
