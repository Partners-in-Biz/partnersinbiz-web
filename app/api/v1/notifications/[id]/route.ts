/**
 * /api/v1/notifications/[id] — single-notification CRUD.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  VALID_NOTIFICATION_PRIORITIES,
  VALID_NOTIFICATION_STATUSES,
  type NotificationPriority,
  type NotificationStatus,
} from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function canAccessNotification(user: Parameters<typeof canAccessOrg>[0], data: FirebaseFirestore.DocumentData | undefined): boolean {
  return canAccessOrg(user, data?.orgId)
}

export const GET = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const doc = await adminDb.collection('notifications').doc(id).get()
  if (!doc.exists) return apiError('Notification not found', 404)
  if (!canAccessNotification(user, doc.data())) return apiError('Forbidden', 403)
  return apiSuccess({ id: doc.id, ...doc.data() })
})

export const PATCH = withAuth('client', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))

  const ref = adminDb.collection('notifications').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return apiError('Notification not found', 404)
  if (!canAccessNotification(user, doc.data())) return apiError('Forbidden', 403)

  const updates: Record<string, unknown> = { ...lastActorFrom(user) }

  if (body.status !== undefined) {
    if (!VALID_NOTIFICATION_STATUSES.includes(body.status as NotificationStatus)) {
      return apiError(
        `Invalid status. Must be one of: ${VALID_NOTIFICATION_STATUSES.join(', ')}`,
        400,
      )
    }
    updates.status = body.status
    if (body.status === 'read') {
      updates.readAt = FieldValue.serverTimestamp()
    }
  }

  if (body.priority !== undefined) {
    if (!VALID_NOTIFICATION_PRIORITIES.includes(body.priority as NotificationPriority)) {
      return apiError(
        `Invalid priority. Must be one of: ${VALID_NOTIFICATION_PRIORITIES.join(', ')}`,
        400,
      )
    }
    updates.priority = body.priority
  }

  if (body.snoozedUntil !== undefined) {
    updates.snoozedUntil = body.snoozedUntil
  }

  try {
    await ref.update(updates)
    return apiSuccess({ id })
  } catch (err) {
    console.error('[notifications-patch-error]', err)
    return apiError('Failed to update notification', 500)
  }
})

export const DELETE = withAuth('admin', async (req, user, ctx) => {
  const { id } = await (ctx as RouteContext).params
  try {
    await adminDb.collection('notifications').doc(id).delete()
    return apiSuccess({ deleted: true })
  } catch (err) {
    console.error('[notifications-delete-error]', err)
    return apiError('Failed to delete notification', 500)
  }
})
