/**
 * POST /api/v1/admin/system/jobs/[jobId]/cancel?queue=<collection>  (super-admin)
 *
 * Cancel a queued/pending job so the worker skips it. Sets status to
 * 'cancelled' and clears any lock/claim. Supported queues: webhook_queue,
 * social_queue, emails (an email is cancelled by marking it failed with a
 * cancellation reason, since EmailStatus has no 'cancelled' member).
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

  if (queue === 'emails') {
    // EmailStatus has no 'cancelled' — mark failed with an explicit reason.
    await ref.update({
      status: 'failed',
      error: 'Cancelled by admin',
      cancelledBy: user.uid ?? 'admin',
      cancelledAt: FieldValue.serverTimestamp(),
    })
  } else {
    await ref.update({
      status: 'cancelled',
      claimedAt: null,
      lockedBy: null,
      lockedAt: null,
      cancelledBy: user.uid ?? 'admin',
      cancelledAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({ cancelled: true, queue, jobId })
})
