/**
 * POST /api/v1/notifications/:id/open
 * Marks a single notification read and returns the best destination href (admin surface).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { resolveNotificationDestination } from '@/lib/notifications/resolve-destination'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
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

  if (!canAccessOrg(user, data.orgId)) return apiError('Forbidden', 403)

  const href = await resolveNotificationDestination({
    db: adminDb,
    notification: {
      type: data.type,
      link: data.link ?? null,
      data: data.data ?? null,
      orgId: data.orgId,
    },
    surface: 'admin',
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
