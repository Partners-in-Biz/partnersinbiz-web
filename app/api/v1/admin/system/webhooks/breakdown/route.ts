/**
 * GET /api/v1/admin/system/webhooks/breakdown
 *
 * Aggregates recent `webhook_deliveries` for the system webhook dashboard:
 *   - byEvent:  delivery count per event type
 *   - byStatus: success (2xx) vs failed counts
 *   - perOrg:   delivery health per org (joined via outbound_webhooks.orgId)
 *
 * Reads a single-field orderBy slice (no composite index) and aggregates in
 * memory. Optional `from`/`to` ISO params bound the window.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

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

const SCAN_CAP = 2000

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const fromMs = toMillis(searchParams.get('from'))
  const toMs = toMillis(searchParams.get('to'))

  const snap = await adminDb
    .collection('webhook_deliveries')
    .orderBy('deliveredAt', 'desc')
    .limit(SCAN_CAP)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deliveries = snap.docs.map((d: any) => d.data() as Record<string, unknown>).filter((d) => {
    const ms = toMillis((d as { deliveredAt?: unknown }).deliveredAt)
    if (fromMs !== null && (ms === null || ms < fromMs)) return false
    if (toMs !== null && (ms === null || ms > toMs)) return false
    return true
  })

  // Resolve webhook → orgId.
  const webhookIds = Array.from(
    new Set(deliveries.map((d) => (d as { webhookId?: string }).webhookId).filter(Boolean) as string[]),
  )
  const webhookOrg = new Map<string, string>()
  const webhookName = new Map<string, string>()
  await Promise.all(
    webhookIds.map(async (id) => {
      const ws = await adminDb.collection('outbound_webhooks').doc(id).get()
      if (ws.exists) {
        const w = ws.data() as { orgId?: string; name?: string }
        webhookOrg.set(id, w.orgId ?? '')
        webhookName.set(id, w.name ?? '')
      }
    }),
  )

  const byEvent: Record<string, number> = {}
  let success = 0
  let failed = 0
  // orgId -> { total, success }
  const orgAgg = new Map<string, { total: number; success: number }>()

  for (const d of deliveries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dd = d as any
    const event = (dd.event as string) ?? 'unknown'
    byEvent[event] = (byEvent[event] ?? 0) + 1

    const respStatus: number | null = typeof dd.responseStatus === 'number' ? dd.responseStatus : null
    const isSuccess = respStatus !== null && respStatus >= 200 && respStatus < 300 && !dd.error
    if (isSuccess) success += 1
    else failed += 1

    const org = dd.webhookId ? webhookOrg.get(dd.webhookId) ?? '' : ''
    const key = org || '(unknown org)'
    const agg = orgAgg.get(key) ?? { total: 0, success: 0 }
    agg.total += 1
    if (isSuccess) agg.success += 1
    orgAgg.set(key, agg)
  }

  const byEventArr = Object.entries(byEvent)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count)

  const perOrg = Array.from(orgAgg.entries())
    .map(([orgId, agg]) => ({
      orgId,
      total: agg.total,
      success: agg.success,
      failed: agg.total - agg.success,
      successRate: agg.total > 0 ? Math.round((agg.success / agg.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.successRate - b.successRate || b.total - a.total)

  return apiSuccess({
    byEvent: byEventArr,
    byStatus: { success, failed, total: success + failed },
    perOrg,
    scanned: snap.docs.length,
    scanCapped: snap.docs.length >= SCAN_CAP,
    timestamp: new Date().toISOString(),
  })
})
