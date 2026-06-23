/**
 * GET /api/v1/admin/system/webhooks
 *
 * Platform-wide webhook delivery log (admin). Reads a slice of
 * `webhook_deliveries`, joins each delivery to its `outbound_webhooks` doc for
 * org + webhook context, and filters in memory to avoid composite indexes.
 *
 * Query params (all optional):
 *   orgId      — restrict to a single org
 *   webhookId  — restrict to a single webhook
 *   event      — restrict to a single event type
 *   status     — 'success' (2xx) | 'failed' (non-2xx or error)
 *   from, to   — ISO date strings (deliveredAt range)
 *   limit      — max rows returned after filtering (default 100, cap 500)
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

// How many recent deliveries to scan before filtering. We read newest-first
// (single-field orderBy, no composite index) then filter in memory.
const SCAN_CAP = 1500

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')?.trim() || null
  const webhookId = searchParams.get('webhookId')?.trim() || null
  const event = searchParams.get('event')?.trim() || null
  const status = searchParams.get('status')?.trim() || null
  const fromMs = toMillis(searchParams.get('from'))
  const toMsRaw = toMillis(searchParams.get('to'))
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500)

  // Single-field orderBy — no composite index required.
  const snap = await adminDb
    .collection('webhook_deliveries')
    .orderBy('deliveredAt', 'desc')
    .limit(SCAN_CAP)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDeliveries = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))

  // Resolve webhook context (org + name) for the webhookIds we actually saw.
  const webhookIds = Array.from(
    new Set(rawDeliveries.map((d) => (d as { webhookId?: string }).webhookId).filter(Boolean) as string[]),
  )
  const webhookMeta = new Map<string, { orgId: string; name: string; url: string }>()
  await Promise.all(
    webhookIds.map(async (id) => {
      const ws = await adminDb.collection('outbound_webhooks').doc(id).get()
      if (ws.exists) {
        const w = ws.data() as { orgId?: string; name?: string; url?: string }
        webhookMeta.set(id, { orgId: w.orgId ?? '', name: w.name ?? '', url: w.url ?? '' })
      }
    }),
  )

  const rows = rawDeliveries
    .map((d) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dd = d as any
      const meta = dd.webhookId ? webhookMeta.get(dd.webhookId) : undefined
      const respStatus: number | null = typeof dd.responseStatus === 'number' ? dd.responseStatus : null
      const isSuccess = respStatus !== null && respStatus >= 200 && respStatus < 300 && !dd.error
      return {
        id: dd.id as string,
        webhookId: (dd.webhookId as string) ?? '',
        webhookName: meta?.name ?? '',
        webhookUrl: meta?.url ?? '',
        queueItemId: (dd.queueItemId as string) ?? '',
        orgId: meta?.orgId ?? '',
        event: (dd.event as string) ?? '',
        payloadHash: (dd.payloadHash as string) ?? '',
        responseStatus: respStatus,
        responseBody: (dd.responseBody as string) ?? '',
        durationMs: typeof dd.durationMs === 'number' ? dd.durationMs : null,
        attemptNumber: typeof dd.attemptNumber === 'number' ? dd.attemptNumber : null,
        error: (dd.error as string) ?? null,
        deliveredAtMs: toMillis(dd.deliveredAt),
        isSuccess,
      }
    })
    .filter((r) => {
      if (orgId && r.orgId !== orgId) return false
      if (webhookId && r.webhookId !== webhookId) return false
      if (event && r.event !== event) return false
      if (status === 'success' && !r.isSuccess) return false
      if (status === 'failed' && r.isSuccess) return false
      if (fromMs !== null && (r.deliveredAtMs === null || r.deliveredAtMs < fromMs)) return false
      if (toMsRaw !== null && (r.deliveredAtMs === null || r.deliveredAtMs > toMsRaw)) return false
      return true
    })

  const total = rows.length
  const limited = rows.slice(0, limit)

  return apiSuccess({
    deliveries: limited,
    total,
    scanned: rawDeliveries.length,
    scanCapped: rawDeliveries.length >= SCAN_CAP,
    timestamp: new Date().toISOString(),
    _note:
      rawDeliveries.length >= SCAN_CAP
        ? `Filtered over the ${SCAN_CAP} most-recent deliveries (scan cap). Narrow with date range for older rows.`
        : undefined,
  })
})
