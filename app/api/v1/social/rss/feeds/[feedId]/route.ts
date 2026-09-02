/**
 * GET    /api/v1/social/rss/feeds/:feedId  — get feed details
 * PATCH  /api/v1/social/rss/feeds/:feedId  — update feed config
 * DELETE /api/v1/social/rss/feeds/:feedId  — delete feed
 * POST   /api/v1/social/rss/feeds/:feedId  — trigger actions (check/pause/resume)
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { checkFeed } from '@/lib/social/rss'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

function getFeedId(req: NextRequest): string {
  const parts = req.nextUrl.pathname.split('/')
  return parts[parts.length - 1]
}

export const GET = withAuth('admin', withTenant(async (req, _user, orgId) => {
  const feedId = getFeedId(req)
  const doc = await adminDb.collection('social_rss_feeds').doc(feedId).get()
  if (!doc.exists) return apiError('Feed not found', 404)

  const feed = doc.data()
  if (feed?.orgId !== orgId) return apiError('Feed not found', 404)

  return apiSuccess({ id: doc.id, ...feed })
}))

export const PATCH = withAuth('admin', withTenant(async (req, _user, orgId) => {
  const feedId = getFeedId(req)
  const doc = await adminDb.collection('social_rss_feeds').doc(feedId).get()
  if (!doc.exists) return apiError('Feed not found', 404)
  if (doc.data()?.orgId !== orgId) return apiError('Feed not found', 404)

  const body = await req.json()
  const allowed = ['name', 'feedUrl', 'targetAccountIds', 'targetPlatforms', 'postTemplate',
    'includeImage', 'autoSchedule', 'schedulingStrategy', 'checkIntervalMinutes']

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = key === 'checkIntervalMinutes' ? Math.max(15, body[key]) : body[key]
    }
  }
  if ('clientVisibility' in body) Object.assign(updates, clientVisibilityFieldsForWrite(body.clientVisibility))

  await adminDb.collection('social_rss_feeds').doc(feedId).update(updates)
  const updated = await adminDb.collection('social_rss_feeds').doc(feedId).get()

  return apiSuccess({ id: updated.id, ...updated.data() })
}))

export const DELETE = withAuth('admin', withTenant(async (req, _user, orgId) => {
  const feedId = getFeedId(req)
  const doc = await adminDb.collection('social_rss_feeds').doc(feedId).get()
  if (!doc.exists) return apiError('Feed not found', 404)
  if (doc.data()?.orgId !== orgId) return apiError('Feed not found', 404)

  await adminDb.collection('social_rss_feeds').doc(feedId).delete()

  return apiSuccess({ success: true })
}))

export const POST = withAuth('admin', withTenant(async (req, _user, orgId) => {
  const feedId = getFeedId(req)
  const doc = await adminDb.collection('social_rss_feeds').doc(feedId).get()
  if (!doc.exists) return apiError('Feed not found', 404)
  if (doc.data()?.orgId !== orgId) return apiError('Feed not found', 404)

  const body = await req.json().catch(() => ({}))
  const action = body.action as string

  if (action === 'pause') {
    await adminDb.collection('social_rss_feeds').doc(feedId).update({
      status: 'paused',
      updatedAt: FieldValue.serverTimestamp(),
    })
    const updated = await adminDb.collection('social_rss_feeds').doc(feedId).get()
    return apiSuccess({ id: updated.id, ...updated.data() })
  }

  if (action === 'resume') {
    await adminDb.collection('social_rss_feeds').doc(feedId).update({
      status: 'active',
      consecutiveErrors: 0,
      lastError: null,
      updatedAt: FieldValue.serverTimestamp(),
    })
    const updated = await adminDb.collection('social_rss_feeds').doc(feedId).get()
    return apiSuccess({ id: updated.id, ...updated.data() })
  }

  // Default: trigger a manual check
  const result = await checkFeed(feedId)
  return apiSuccess(result)
}))
