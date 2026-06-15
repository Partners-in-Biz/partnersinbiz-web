/**
 * /api/v1/notifications — persistent notifications feed.
 *
 *  - GET: list notifications with filters + cursor pagination.
 *  - POST: create a notification (at least one of userId/agentId, or org-wide).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { actorFrom } from '@/lib/api/actor'
import {
  VALID_NOTIFICATION_PRIORITIES,
  VALID_NOTIFICATION_STATUSES,
  type NotificationPriority,
  type NotificationStatus,
} from '@/lib/notifications/types'
import { sendPushToUser } from '@/lib/notifications/push'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  const statusParam = searchParams.get('status') ?? 'unread'
  const userId = searchParams.get('userId')
  const agentId = searchParams.get('agentId')
  const type = searchParams.get('type')
  const cursor = searchParams.get('cursor')

  const rawLimit = parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  if (statusParam && !VALID_NOTIFICATION_STATUSES.includes(statusParam as NotificationStatus)) {
    return apiError(`Invalid status. Must be one of: ${VALID_NOTIFICATION_STATUSES.join(', ')}`, 400)
  }

  try {
    let query = adminDb
      .collection('notifications')
      .where('orgId', '==', orgId) as FirebaseFirestore.Query

    if (statusParam) query = query.where('status', '==', statusParam)
    if (userId) query = query.where('userId', '==', userId)
    if (agentId) query = query.where('agentId', '==', agentId)
    if (type) query = query.where('type', '==', type)

    query = query.orderBy('createdAt', 'desc')

    if (cursor) {
      const cursorDoc = await adminDb.collection('notifications').doc(cursor).get()
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc)
      }
    }

    // Fetch limit+1 so we can detect whether more results exist.
    const snapshot = await query.limit(limit + 1).get()
    const docs = snapshot.docs
    const hasMore = docs.length > limit
    const pageDocs = hasMore ? docs.slice(0, limit) : docs
    const items = pageDocs.map((d) => ({ id: d.id, ...d.data() }))
    const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null

    return apiSuccess({ items, nextCursor }, 200, {
      total: items.length,
      page: 1,
      limit,
    })
  } catch (err) {
    console.error('[notifications-list-error]', err)
    return apiError('Failed to list notifications', 500)
  }
})

export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))

  const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  if (!body.type) return apiError('type is required', 400)
  if (!body.title) return apiError('title is required', 400)

  const priority = (body.priority ?? 'normal') as NotificationPriority
  if (!VALID_NOTIFICATION_PRIORITIES.includes(priority)) {
    return apiError(
      `Invalid priority. Must be one of: ${VALID_NOTIFICATION_PRIORITIES.join(', ')}`,
      400,
    )
  }

  const status = (body.status ?? 'unread') as NotificationStatus
  if (!VALID_NOTIFICATION_STATUSES.includes(status)) {
    return apiError(
      `Invalid status. Must be one of: ${VALID_NOTIFICATION_STATUSES.join(', ')}`,
      400,
    )
  }

  const doc = {
    orgId: scope.orgId,
    userId: body.userId ?? null,
    agentId: body.agentId ?? null,
    type: String(body.type),
    title: String(body.title),
    body: body.body ? String(body.body) : '',
    link: body.link ?? null,
    data: body.data ?? null,
    priority,
    status,
    snoozedUntil: body.snoozedUntil ?? null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
    ...actorFrom(user),
  }

  try {
    const ref = await adminDb.collection('notifications').add(doc)

    // Fire-and-forget web push to the targeted user. We deliberately don't
    // await — push failures shouldn't block the in-app feed write.
    if (doc.userId && priority !== 'low') {
      sendPushToUser(String(doc.userId), {
        title: doc.title,
        body: doc.body,
        link: doc.link ?? undefined,
        data: { notificationId: ref.id, type: doc.type, priority },
      }).catch((err) => console.error('[notifications-push-error]', err))
    }

    return apiSuccess({ id: ref.id }, 201)
  } catch (err) {
    console.error('[notifications-create-error]', err)
    return apiError('Failed to create notification', 500)
  }
})
