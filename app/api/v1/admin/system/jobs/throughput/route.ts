/**
 * GET /api/v1/admin/system/jobs/throughput
 *
 * Hourly delivered-webhook counts for the last 24h, bucketed by
 * `webhook_queue.deliveredAt`. Powers the throughput chart on the jobs
 * dashboard. Single-field range query (deliveredAt) — no composite index.
 */
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const HOURS = 24
const WINDOW_MS = HOURS * 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMillis(value: any): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.toMillis === 'function') return value.toMillis()
  return null
}

export const GET = withAuth('admin', async () => {
  const nowMs = Date.now()
  const startMs = nowMs - WINDOW_MS
  const startTs = Timestamp.fromMillis(startMs)

  const snap = await adminDb
    .collection('webhook_queue')
    .where('deliveredAt', '>=', startTs)
    .limit(5000)
    .get()

  // Build 24 hourly buckets aligned to the top of each hour.
  const bucketBaseMs = Math.floor(startMs / (60 * 60 * 1000)) * (60 * 60 * 1000)
  const buckets: { hourStartMs: number; delivered: number; failed: number }[] = []
  for (let i = 0; i <= HOURS; i++) {
    buckets.push({ hourStartMs: bucketBaseMs + i * 60 * 60 * 1000, delivered: 0, failed: 0 })
  }

  for (const d of snap.docs) {
    const data = d.data()
    const ms = toMillis(data.deliveredAt)
    if (ms === null) continue
    const idx = Math.floor((ms - bucketBaseMs) / (60 * 60 * 1000))
    if (idx < 0 || idx >= buckets.length) continue
    if ((data.status as string) === 'delivered') buckets[idx].delivered += 1
    else if ((data.status as string) === 'failed') buckets[idx].failed += 1
  }

  return apiSuccess({
    source: 'webhook_queue.deliveredAt',
    buckets: buckets.map((b) => ({
      hourStart: new Date(b.hourStartMs).toISOString(),
      delivered: b.delivered,
      failed: b.failed,
    })),
    totalDelivered: buckets.reduce((s, b) => s + b.delivered, 0),
    timestamp: new Date().toISOString(),
  })
})
