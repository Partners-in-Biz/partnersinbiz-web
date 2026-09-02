/**
 * GET  /api/v1/social/rss/feeds  — list RSS feeds
 * POST /api/v1/social/rss/feeds  — create an RSS feed automation
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  clientVisibilityFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', withTenant(async (req, user, orgId) => {
  const scope = resolveWorkScopeFromSearchParams(new URL(req.url).searchParams, user.uid)
  const snapshot = await adminDb.collection('social_rss_feeds')
    .where('orgId', '==', orgId)
    .get()

  const feeds = snapshot.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((f: Record<string, unknown>) => recordVisibleForWorkScope(f, scope))

  return apiSuccess(feeds, 200, { total: feeds.length, page: 1, limit: feeds.length })
}))

export const POST = withAuth('admin', withTenant(async (req, user, orgId) => {
  const body = await req.json()

  if (!body.name?.trim()) return apiError('name is required')
  if (!body.feedUrl?.trim()) return apiError('feedUrl is required')

  // Validate URL
  try {
    new URL(body.feedUrl)
  } catch {
    return apiError('feedUrl must be a valid URL')
  }

  if (!body.targetPlatforms?.length) return apiError('targetPlatforms[] is required')

  const doc = {
    orgId,
    name: body.name.trim(),
    feedUrl: body.feedUrl.trim(),
    status: 'active' as const,
    targetAccountIds: body.targetAccountIds ?? [],
    targetPlatforms: body.targetPlatforms,
    postTemplate: body.postTemplate?.trim() || '{{title}} {{url}}',
    includeImage: body.includeImage ?? false,
    autoSchedule: body.autoSchedule ?? false,
    schedulingStrategy: body.schedulingStrategy ?? 'queue',
    lastCheckedAt: null,
    lastPublishedItemUrl: null,
    itemsPublished: 0,
    checkIntervalMinutes: Math.max(15, body.checkIntervalMinutes ?? 60),
    consecutiveErrors: 0,
    lastError: null,
    ...workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body, uid: user.uid })),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_rss_feeds').add(doc)

  return apiSuccess({ id: docRef.id, ...doc }, 201)
}))
