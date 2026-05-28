import { randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const ref = adminDb.collection('outbound_webhooks').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Webhook not found', 404)
  const data = doc.data() as { orgId?: string; deleted?: boolean }
  if (data.deleted || data.orgId !== ctx.orgId) return apiError('Webhook not found', 404)

  const secret = randomBytes(32).toString('hex')

  try {
    await ref.update({
      secret,
      secretRotatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.actor.uid,
      updatedByRef: ctx.actor,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ id, secretOnce: secret, secret: '***' })
  } catch (err) {
    console.error('[crm-webhook-rotate-secret-error]', err)
    return apiError('Failed to rotate webhook secret', 500)
  }
})
