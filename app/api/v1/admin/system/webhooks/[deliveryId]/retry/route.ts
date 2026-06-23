/**
 * POST /api/v1/admin/system/webhooks/[deliveryId]/retry  (super-admin)
 *
 * Requeue a webhook delivery platform-wide. Mirrors the per-webhook replay
 * logic in app/api/v1/webhooks/[id]/deliveries/[deliveryId]/replay/route.ts:
 * it recovers the original {event, payload} from the linked queue item and
 * enqueues a fresh `webhook_queue` doc for the worker to pick up.
 *
 * Unlike the per-webhook replay, the webhookId is resolved from the delivery
 * doc itself, so this works from the admin delivery log without a webhook id.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ deliveryId: string }> }

export const POST = withAuth('admin', async (_req, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  const { deliveryId } = await (ctx as RouteContext).params

  const deliverySnap = await adminDb.collection('webhook_deliveries').doc(deliveryId).get()
  if (!deliverySnap.exists) return apiError('Delivery not found', 404)
  const delivery = deliverySnap.data() as {
    webhookId?: string
    queueItemId?: string
    event?: string
  }

  if (!delivery.queueItemId) {
    return apiError('Delivery has no linked queue item — cannot recover payload for retry', 422)
  }

  // Recover the exact payload from the original queue item.
  const queueSnap = await adminDb.collection('webhook_queue').doc(delivery.queueItemId).get()
  if (!queueSnap.exists) {
    return apiError('Original queue item not found — cannot recover payload for retry', 404)
  }
  const original = queueSnap.data() as {
    webhookId?: string
    orgId?: string
    event?: string
    payload?: Record<string, unknown>
  }

  const webhookId = original.webhookId ?? delivery.webhookId
  if (!webhookId) return apiError('Could not resolve webhook for this delivery', 422)

  // Confirm the webhook still exists / is not deleted before requeueing.
  const webhookSnap = await adminDb.collection('outbound_webhooks').doc(webhookId).get()
  if (!webhookSnap.exists) return apiError('Webhook no longer exists', 404)
  const webhook = webhookSnap.data() as { deleted?: boolean }
  if (webhook.deleted) return apiError('Webhook has been deleted', 404)

  const qRef = adminDb.collection('webhook_queue').doc()
  await qRef.set({
    webhookId,
    orgId: original.orgId ?? '',
    event: original.event ?? delivery.event ?? 'test',
    payload: original.payload ?? {},
    status: 'pending',
    retryCount: 0,
    nextAttemptAt: new Date(),
    createdAt: FieldValue.serverTimestamp(),
    claimedAt: null,
    replayOf: deliveryId,
    requeuedBy: user.uid ?? 'admin',
  })

  return apiSuccess({ requeued: true, newQueueItemId: qRef.id, webhookId })
})
