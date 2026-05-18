import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const webhookRef = adminDb.collection('outbound_webhooks').doc(id)
  const snap = await webhookRef.get()
  if (!snap.exists) return apiError('Webhook not found', 404)
  const webhook = snap.data() as { orgId?: string; deleted?: boolean }
  if (webhook.deleted || webhook.orgId !== ctx.orgId) return apiError('Webhook not found', 404)

  try {
    const queueRef = adminDb.collection('webhook_queue').doc()
    await queueRef.set({
      webhookId: id,
      orgId: ctx.orgId,
      event: 'test',
      payload: {
        message: 'This is a test from Partners in Biz',
        timestamp: new Date().toISOString(),
      },
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: new Date(),
      createdAt: FieldValue.serverTimestamp(),
      claimedAt: null,
    })
    return apiSuccess({ queued: true, queueItemId: queueRef.id })
  } catch (err) {
    console.error('[crm-webhook-test-error]', err)
    return apiError('Failed to queue test delivery', 500)
  }
})
