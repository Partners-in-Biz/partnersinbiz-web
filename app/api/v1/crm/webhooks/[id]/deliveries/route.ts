/**
 * GET /api/v1/crm/webhooks/[id]/deliveries — the most recent delivery attempts
 *     for one outbound webhook (US-096). Returns up to `limit` (default 10,
 *     max 50) records ordered newest-first, each with the event, response code,
 *     duration, attempt number, error (if any) and timestamp.
 *
 * Delivery records live in the top-level `webhook_deliveries` collection, written
 * by the webhook worker (lib/webhooks/worker.ts). They are keyed by `webhookId`,
 * so we authorise by loading the parent webhook and confirming it belongs to the
 * caller's org before exposing its deliveries.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

// Firestore Timestamp → ISO string (best-effort; passes through plain values).
function toIso(v: unknown): string | null {
  if (!v) return null
  const t = v as { toDate?: () => Date }
  if (typeof t.toDate === 'function') {
    try {
      return t.toDate().toISOString()
    } catch {
      return null
    }
  }
  return typeof v === 'string' ? v : null
}

export const GET = withCrmAuth<RouteCtx>('admin', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params

  // Authorise: the webhook must exist and belong to the caller's org.
  const whSnap = await adminDb.collection('outbound_webhooks').doc(id).get()
  if (!whSnap.exists) return apiError('Webhook not found', 404)
  const webhook = whSnap.data() as { orgId?: string; deleted?: boolean }
  if (webhook.deleted === true || webhook.orgId !== ctx.orgId) {
    return apiError('Webhook not found', 404)
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10) || 10))

  // Order newest-first by deliveredAt. Fall back to an unordered scan if the
  // composite index isn't ready yet (then sort + slice in memory).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base: any = adminDb.collection('webhook_deliveries').where('webhookId', '==', id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await base.orderBy('deliveredAt', 'desc').limit(limit).get()
  } catch {
    snap = await base.limit(200).get()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deliveries = snap.docs.map((d: any) => {
    const data = d.data() ?? {}
    const status: number | null =
      typeof data.responseStatus === 'number' ? data.responseStatus : null
    const success = status !== null && status >= 200 && status < 300
    return {
      id: d.id,
      event: typeof data.event === 'string' ? data.event : 'unknown',
      responseStatus: status,
      success,
      durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
      attemptNumber: typeof data.attemptNumber === 'number' ? data.attemptNumber : null,
      error: typeof data.error === 'string' ? data.error : null,
      deliveredAt: toIso(data.deliveredAt),
    }
  })

  // In-memory ordering for the fallback path (and harmless on the indexed path).
  deliveries.sort((a: { deliveredAt: string | null }, b: { deliveredAt: string | null }) => {
    const at = a.deliveredAt ? Date.parse(a.deliveredAt) : 0
    const bt = b.deliveredAt ? Date.parse(b.deliveredAt) : 0
    return bt - at
  })
  deliveries = deliveries.slice(0, limit)

  return apiSuccess({ deliveries, total: deliveries.length })
})
