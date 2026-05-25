import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAdminManageNotificationPreference, normaliseAdminNotificationPreference, preferenceDocId, sanitisePreferenceUpdate } from '@/lib/notifications/adminPreferences'

export const dynamic = 'force-dynamic'

const COLLECTION = 'admin_notification_preferences'

function orgIdFrom(req: Request): string | null {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  return orgId && orgId.trim() ? orgId.trim() : null
}

export const GET = withAuth('admin', async (req, user) => {
  const orgId = orgIdFrom(req)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAdminManageNotificationPreference(user, orgId)) return apiError('Forbidden', 403)

  try {
    const snap = await adminDb.collection(COLLECTION).doc(preferenceDocId(user.uid, orgId)).get()
    const preference = normaliseAdminNotificationPreference(snap.exists ? snap.data() : undefined, user.uid, orgId)
    return apiSuccess({ preference })
  } catch (err) {
    console.error('[admin-notification-preferences-get-error]', err)
    return apiError('Failed to load notification preferences', 500)
  }
})

export const PATCH = withAuth('admin', async (req, user) => {
  const orgId = orgIdFrom(req)
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAdminManageNotificationPreference(user, orgId)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({}))
  const update = sanitisePreferenceUpdate(body)

  try {
    const ref = adminDb.collection(COLLECTION).doc(preferenceDocId(user.uid, orgId))
    const snap = await ref.get()
    const existing = normaliseAdminNotificationPreference(snap.exists ? snap.data() : undefined, user.uid, orgId)
    const preference = normaliseAdminNotificationPreference(
      {
        ...existing,
        channels: update.channels ?? existing.channels,
        eventClasses: {
          ...existing.eventClasses,
          ...(update.eventClasses ?? {}),
        },
      },
      user.uid,
      orgId,
    )

    await ref.set(
      {
        ...preference,
        createdAt: snap.exists ? existing.createdAt ?? null : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
        updatedByType: user.role === 'ai' ? 'agent' : 'user',
      },
      { merge: true },
    )

    return apiSuccess({ preference })
  } catch (err) {
    console.error('[admin-notification-preferences-patch-error]', err)
    return apiError('Failed to save notification preferences', 500)
  }
})
