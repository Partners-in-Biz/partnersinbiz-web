/**
 * POST /api/v1/admin/system/jobs/[jobId]/retry?queue=<collection>  (super-admin)
 *
 * Requeue a failed job by resetting its status back to pending and clearing
 * the lock/claim fields so the worker re-picks it on the next tick.
 *
 * Supported queues: webhook_queue, social_queue, emails. The reset fields
 * differ per queue (each has its own worker contract), so the patch is
 * tailored. Defaults to webhook_queue when ?queue= is omitted.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ jobId: string }> }

const ALLOWED_QUEUES = new Set(['webhook_queue', 'social_queue', 'emails'])

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  const { jobId } = await (ctx as RouteContext).params
  const queue = new URL(req.url).searchParams.get('queue') || 'webhook_queue'
  if (!ALLOWED_QUEUES.has(queue)) return apiError(`Unsupported queue "${queue}"`, 400)

  const ref = adminDb.collection(queue).doc(jobId)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Job not found', 404)

  if (queue === 'webhook_queue') {
    await ref.update({
      status: 'pending',
      nextAttemptAt: new Date(),
      claimedAt: null,
      retriedBy: user.uid ?? 'admin',
      retriedAt: FieldValue.serverTimestamp(),
    })
  } else if (queue === 'social_queue') {
    await ref.update({
      status: 'pending',
      lockedBy: null,
      lockedAt: null,
      nextRetryAt: new Date(),
      scheduledAt: new Date(),
      error: null,
      retriedBy: user.uid ?? 'admin',
      retriedAt: FieldValue.serverTimestamp(),
    })
  } else {
    // emails — push back to scheduled so the send worker picks it up now.
    await ref.update({
      status: 'scheduled',
      scheduledFor: new Date(),
      retriedBy: user.uid ?? 'admin',
      retriedAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({ retried: true, queue, jobId })
})
