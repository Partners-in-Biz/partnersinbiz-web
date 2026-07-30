/**
 * POST /api/v1/crm/notifications/:id/open
 * Marks a single notification read and returns the best destination href.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveNotificationDestination } from '@/lib/notifications/resolve-destination'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withCrmAuth<RouteCtx>('viewer', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  if (!id?.trim()) return apiError('Notification id is required', 400)

  const ref = adminDb.collection('notifications').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Notification not found', 404)

  const data = doc.data() as {
    orgId?: string
    userId?: string | null
    status?: string
    link?: string | null
    type?: string
    data?: Record<string, unknown> | null
  }

  if (data.orgId !== ctx.orgId) return apiError('Forbidden', 403)
  const uid = ctx.actor.uid
  const userId = data.userId
  if (!(userId === uid || userId === null || typeof userId === 'undefined')) {
    return apiError('Forbidden', 403)
  }

  const href = await resolveNotificationDestination({
    db: adminDb,
    notification: {
      type: data.type,
      link: data.link ?? null,
      data: data.data ?? null,
      orgId: data.orgId,
    },
    surface: 'portal',
  })

  if (data.status === 'unread') {
    await ref.update({
      status: 'read',
      readAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({
    id,
    href: href || data.link || null,
    status: 'read' as const,
  })
})
