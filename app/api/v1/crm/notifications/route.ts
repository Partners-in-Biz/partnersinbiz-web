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

function toMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().getTime()
  const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
  return typeof seconds === 'number' ? seconds * 1000 : 0
}

async function handler(req: NextRequest, ctx: CrmAuthContext): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const rawLimit = parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  const uid = ctx.actor.uid

  try {
    const snap = await adminDb
      .collection('notifications')
      .where('orgId', '==', ctx.orgId)
      .limit(Math.max(limit * 5, 50))
      .get()

    const notifications: (Notification & { id: string })[] = snap.docs
      .map(doc => ({
        id: doc.id,
        ...(doc.data() as Omit<Notification, 'id'>),
      }))
      .filter((n) => n.userId === uid || n.userId === null || typeof n.userId === 'undefined')
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, limit)

    const unreadCount = notifications.filter(n => n.status === 'unread').length

    return apiSuccess({ notifications, unreadCount })
  } catch (err) {
    console.error('notifications query failed', err)
    return apiError('Failed to load notifications', 500)
  }
}

export const GET = withCrmAuth('viewer', handler)
