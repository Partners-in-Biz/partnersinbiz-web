/**
 * GET /api/v1/admin/system/jobs
 *
 * Platform-wide queue / job dashboard. Aggregates REAL queues that exist in
 * Firestore — no synthetic numbers:
 *
 *   webhook_queue  — outbound webhook delivery queue
 *                    (pending | delivering | delivered | failed)
 *   emails         — email send queue; 'scheduled' rows are queued/pending,
 *                    'sent' = delivered, 'failed' = failed
 *   social_queue   — social post publish queue
 *                    (pending | processing | completed | failed | cancelled | blocked)
 *
 * Each queue is read as single-field status slices (no composite indexes),
 * counted in memory. Also returns a unified recent-jobs table and a
 * dead-letter list (failed items across all queues).
 *
 * Briefing / scheduled-cron jobs: there is no discrete queue collection for
 * these (cron is driven by Vercel cron hitting routes, not a Firestore queue),
 * so they are reported as `instrumented: false` rather than fabricated.
 */
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const WINDOW_MS = 24 * 60 * 60 * 1000
const SLICE_CAP = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMillis(value: any): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const p = Date.parse(value)
    return Number.isNaN(p) ? null : p
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value.toMillis === 'function') return value.toMillis()
  return null
}

interface UnifiedJob {
  id: string
  queue: string
  status: string
  attempts: number | null
  createdAtMs: number | null
  nextAttemptMs: number | null
  orgId: string
  label: string
  isFailed: boolean
}

interface QueueSummary {
  name: string
  collection: string
  instrumented: boolean
  pending: number
  processing: number
  failed: number
  deliveredLast24h: number
  total: number
  note?: string
}

export const GET = withAuth('admin', async () => {
  const nowMs = Date.now()
  const windowStartMs = nowMs - WINDOW_MS
  const windowTs = Timestamp.fromMillis(windowStartMs)

  const queues: QueueSummary[] = []
  const recentJobs: UnifiedJob[] = []
  const deadLetter: UnifiedJob[] = []

  // ---- webhook_queue ----
  {
    const base = adminDb.collection('webhook_queue')
    const [pendingSnap, deliveringSnap, failedSnap, deliveredSnap] = await Promise.all([
      base.where('status', '==', 'pending').limit(SLICE_CAP).get(),
      base.where('status', '==', 'delivering').limit(SLICE_CAP).get(),
      base.where('status', '==', 'failed').limit(SLICE_CAP).get(),
      base.where('deliveredAt', '>=', windowTs).limit(SLICE_CAP).get(),
    ])
    queues.push({
      name: 'Webhook delivery',
      collection: 'webhook_queue',
      instrumented: true,
      pending: pendingSnap.size,
      processing: deliveringSnap.size,
      failed: failedSnap.size,
      deliveredLast24h: deliveredSnap.docs.filter((d) => (d.data().status as string) === 'delivered').length,
      total: pendingSnap.size + deliveringSnap.size + failedSnap.size,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collect = (snap: any, status: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snap.docs.forEach((d: any) => {
        const data = d.data()
        const job: UnifiedJob = {
          id: d.id,
          queue: 'webhook_queue',
          status,
          attempts: typeof data.retryCount === 'number' ? data.retryCount : null,
          createdAtMs: toMillis(data.createdAt),
          nextAttemptMs: toMillis(data.nextAttemptAt),
          orgId: data.orgId ?? '',
          label: data.event ?? 'webhook',
          isFailed: status === 'failed',
        }
        recentJobs.push(job)
        if (status === 'failed') deadLetter.push(job)
      })
    collect(pendingSnap, 'pending')
    collect(deliveringSnap, 'delivering')
    collect(failedSnap, 'failed')
  }

  // ---- emails (send queue) ----
  {
    const base = adminDb.collection('emails')
    const [scheduledSnap, failedSnap, sentSnap] = await Promise.all([
      base.where('status', '==', 'scheduled').limit(SLICE_CAP).get(),
      base.where('status', '==', 'failed').limit(SLICE_CAP).get(),
      base.where('sentAt', '>=', windowTs).limit(SLICE_CAP).get(),
    ])
    queues.push({
      name: 'Email send',
      collection: 'emails',
      instrumented: true,
      pending: scheduledSnap.size,
      processing: 0,
      failed: failedSnap.size,
      deliveredLast24h: sentSnap.size,
      total: scheduledSnap.size + failedSnap.size,
      note: 'Pending = scheduled emails awaiting their send window. Sending is synchronous via Resend (no "processing" state).',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collect = (snap: any, status: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snap.docs.forEach((d: any) => {
        const data = d.data()
        const job: UnifiedJob = {
          id: d.id,
          queue: 'emails',
          status,
          attempts: null,
          createdAtMs: toMillis(data.createdAt),
          nextAttemptMs: toMillis(data.scheduledFor),
          orgId: data.orgId ?? '',
          label: data.subject ? String(data.subject).slice(0, 40) : 'email',
          isFailed: status === 'failed',
        }
        recentJobs.push(job)
        if (status === 'failed') deadLetter.push(job)
      })
    collect(scheduledSnap, 'scheduled')
    collect(failedSnap, 'failed')
  }

  // ---- social_queue ----
  {
    const base = adminDb.collection('social_queue')
    const [pendingSnap, processingSnap, failedSnap, completedSnap] = await Promise.all([
      base.where('status', '==', 'pending').limit(SLICE_CAP).get(),
      base.where('status', '==', 'processing').limit(SLICE_CAP).get(),
      base.where('status', '==', 'failed').limit(SLICE_CAP).get(),
      base.where('completedAt', '>=', windowTs).limit(SLICE_CAP).get(),
    ])
    queues.push({
      name: 'Social publish',
      collection: 'social_queue',
      instrumented: true,
      pending: pendingSnap.size,
      processing: processingSnap.size,
      failed: failedSnap.size,
      deliveredLast24h: completedSnap.docs.filter((d) => (d.data().status as string) === 'completed').length,
      total: pendingSnap.size + processingSnap.size + failedSnap.size,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collect = (snap: any, status: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snap.docs.forEach((d: any) => {
        const data = d.data()
        const job: UnifiedJob = {
          id: d.id,
          queue: 'social_queue',
          status,
          attempts: typeof data.attempts === 'number' ? data.attempts : null,
          createdAtMs: toMillis(data.createdAt) ?? toMillis(data.scheduledAt),
          nextAttemptMs: toMillis(data.nextRetryAt) ?? toMillis(data.scheduledAt),
          orgId: data.orgId ?? '',
          label: data.postId ? `post ${String(data.postId).slice(0, 10)}` : 'social',
          isFailed: status === 'failed',
        }
        recentJobs.push(job)
        if (status === 'failed') deadLetter.push(job)
      })
    collect(pendingSnap, 'pending')
    collect(processingSnap, 'processing')
    collect(failedSnap, 'failed')
  }

  // ---- briefings / scheduled cron — not a Firestore queue ----
  queues.push({
    name: 'Briefings / scheduled cron',
    collection: '(none)',
    instrumented: false,
    pending: 0,
    processing: 0,
    failed: 0,
    deliveredLast24h: 0,
    total: 0,
    note: 'Driven by Vercel cron hitting API routes on a schedule — there is no Firestore queue collection to count. Not instrumented as a job queue.',
  })

  recentJobs.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  deadLetter.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))

  return apiSuccess({
    queues,
    recentJobs: recentJobs.slice(0, 200),
    deadLetter: deadLetter.slice(0, 100),
    timestamp: new Date().toISOString(),
  })
})
