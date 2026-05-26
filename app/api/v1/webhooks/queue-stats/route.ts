/**
 * GET /api/v1/webhooks/queue-stats
 *
 * Observability snapshot of the outbound webhook queue + worker health.
 * Scoped by orgId when passed; otherwise returns platform-wide totals
 * (AI/admin see everything).
 *
 * Response:
 *   {
 *     byStatus: { pending: N, delivering: N, delivered: N, failed: N },
 *     oldestPendingAgeSeconds: N | null,
 *     stuckDeliveringCount: N,  // claimed > 5 min ago — stuck worker signal
 *     deliveredLast24h: N,
 *     failedLast24h: N,
 *     webhooks: { active: N, autoDisabled: N, total: N }
 *   }
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { Timestamp } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const STUCK_MS = 5 * 60 * 1000
const WINDOW_MS = 24 * 60 * 60 * 1000

type QueueStatus = 'pending' | 'delivering' | 'delivered' | 'failed'

type QueueItem = {
  orgId?: string
  status?: QueueStatus
  nextAttemptAt?: Timestamp | Date | number | string | null
  deliveredAt?: Timestamp | Date | number | string | null
  claimedAt?: Timestamp | Date | number | string | null
}

type WebhookDoc = {
  orgId?: string
  active?: boolean
  deleted?: boolean
  autoDisabledAt?: unknown
}

function toMillis(value: QueueItem['nextAttemptAt']): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value.toMillis === 'function') return value.toMillis()
  return null
}

export const GET = withAuth('admin', async (req) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')

  const queueBase = adminDb.collection('webhook_queue')
  const webhooksBase = adminDb.collection('outbound_webhooks')
  const nowMs = Date.now()
  const windowStartMs = nowMs - WINDOW_MS
  const stuckCutoffMs = nowMs - STUCK_MS

  let queueItems: QueueItem[]
  let deliveredWindowItems: QueueItem[] = []
  let stuckItems: QueueItem[] = []

  if (orgId) {
    // Keep the org-scoped health route independent from composite Firestore indexes:
    // read one single-field slice and derive all counters in memory. The previous
    // status+orgId/status+date aggregate queries returned HTTP 500 when indexes
    // were not present in production.
    const scopedQueueSnap = await queueBase.where('orgId', '==', orgId).get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queueItems = scopedQueueSnap.docs.map((doc: any) => doc.data() as QueueItem)
  } else {
    const [pendingSnap, deliveringSnap, failedSnap, deliveredWindowSnap, stuckSnap] = await Promise.all([
      queueBase.where('status', '==', 'pending').get(),
      queueBase.where('status', '==', 'delivering').get(),
      queueBase.where('status', '==', 'failed').get(),
      queueBase.where('deliveredAt', '>=', Timestamp.fromMillis(windowStartMs)).get(),
      queueBase.where('claimedAt', '<=', Timestamp.fromMillis(stuckCutoffMs)).get(),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deliveredWindowItems = deliveredWindowSnap.docs.map((doc: any) => doc.data() as QueueItem)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stuckItems = stuckSnap.docs.map((doc: any) => doc.data() as QueueItem)

    queueItems = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...pendingSnap.docs.map((doc: any) => doc.data() as QueueItem),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...deliveringSnap.docs.map((doc: any) => doc.data() as QueueItem),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...failedSnap.docs.map((doc: any) => doc.data() as QueueItem),
    ]
  }

  const byStatus = queueItems.reduce<Record<QueueStatus, number>>(
    (acc, item) => {
      if (item.status && item.status in acc) acc[item.status] += 1
      return acc
    },
    { pending: 0, delivering: 0, delivered: 0, failed: 0 },
  )

  let oldestPendingAgeSeconds: number | null = null
  for (const item of queueItems) {
    if (item.status !== 'pending') continue
    const nextAttemptMs = toMillis(item.nextAttemptAt)
    if (nextAttemptMs === null) continue
    const age = Math.max(0, Math.floor((nowMs - nextAttemptMs) / 1000))
    oldestPendingAgeSeconds = oldestPendingAgeSeconds === null ? age : Math.max(oldestPendingAgeSeconds, age)
  }

  const deliveredMetricItems = orgId ? queueItems : deliveredWindowItems
  const deliveredLast24h = deliveredMetricItems.filter((item) => {
    if (item.status !== 'delivered') return false
    const deliveredAtMs = toMillis(item.deliveredAt)
    return deliveredAtMs !== null && deliveredAtMs >= windowStartMs
  }).length

  const stuckMetricItems = orgId ? queueItems : stuckItems
  const stuckDeliveringCount = stuckMetricItems.filter((item) => {
    if (item.status !== 'delivering') return false
    const claimedAtMs = toMillis(item.claimedAt)
    return claimedAtMs !== null && claimedAtMs <= stuckCutoffMs
  }).length

  const webhooksSnap = orgId
    ? await webhooksBase.where('orgId', '==', orgId).get()
    : await webhooksBase.where('deleted', '==', false).get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webhooks: WebhookDoc[] = webhooksSnap.docs.map((d: any) => d.data() as WebhookDoc).filter((w) => w.deleted !== true)
  const totalWebhooks = webhooks.length
  const activeWebhooks = webhooks.filter((w) => w.active === true).length
  const autoDisabled = webhooks.filter((w) => Boolean(w.autoDisabledAt)).length

  return apiSuccess({
    byStatus: {
      pending: byStatus.pending,
      delivering: byStatus.delivering,
      failed: byStatus.failed,
      deliveredLast24h,
    },
    oldestPendingAgeSeconds,
    stuckDeliveringCount,
    webhooks: {
      total: totalWebhooks,
      active: activeWebhooks,
      autoDisabled,
    },
    timestamp: new Date().toISOString(),
  })
})
