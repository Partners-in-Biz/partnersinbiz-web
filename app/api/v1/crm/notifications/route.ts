/**
 * GET /api/v1/crm/notifications?limit=20
 * Auth: withCrmAuth('viewer') — returns notifications for current org (optionally filtered to user)
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Notification } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

async function handler(req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const rawLimit = parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  const uid = ctx.actor.uid

  // Fetch notifications for this org filtered to this user or org-wide (userId == null)
  // Uses the existing index: orgId ASC, userId ASC, status ASC, createdAt DESC
  let snap
  try {
    snap = await adminDb
      .collection('notifications')
      .where('orgId', '==', ctx.orgId)
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
  } catch {
    // Fallback: query without userId filter if index not available yet
    try {
      snap = await adminDb
        .collection('notifications')
        .where('orgId', '==', ctx.orgId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
    } catch (err) {
      console.error('notifications query failed', err)
      return apiError('Failed to load notifications', 500)
    }
  }

  const notifications: (Notification & { id: string })[] = snap.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<Notification, 'id'>),
  }))

  const unreadCount = notifications.filter(n => n.status === 'unread').length

  return apiSuccess({ notifications, unreadCount })
}

export const GET = withCrmAuth('viewer', handler)
