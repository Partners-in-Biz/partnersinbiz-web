/**
 * GET /api/v1/social/posts/pending — fetch pending approval posts
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object') {
    const source = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toMillis === 'function') {
      try { return source.toMillis() } catch { return 0 }
    }
    if (typeof source.toDate === 'function') {
      try { return source.toDate().getTime() } catch { return 0 }
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export const GET = withAuth('admin', async (req) => {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 100)

  try {
    // Keep this query index-safe for the cross-client admin dashboard.
    const query = adminDb
      .collection('social_posts')
      .where('status', '==', 'pending_approval')
      .limit(100)

    const snapshot = await query.get()
    const docs = [...snapshot.docs].sort((a, b) => {
      const aData = a.data()
      const bData = b.data()
      return timestampMillis(aData.scheduledAt ?? aData.scheduledFor) - timestampMillis(bData.scheduledAt ?? bData.scheduledFor)
    }).slice(0, limit)

    // Build result with org names
    const posts = await Promise.all(
      docs.map(async (doc) => {
        const data = doc.data()
        let orgName = 'Unknown'

        // Look up organization name
        if (data.orgId) {
          const orgDoc = await adminDb.collection('organizations').doc(data.orgId).get()
          if (orgDoc.exists) {
            orgName = orgDoc.data()?.name || 'Unknown'
          }
        }

        return {
          id: doc.id,
          content: (data.content?.text || data.content || '').substring(0, 120),
          platform: data.platform || 'unknown',
          orgId: data.orgId,
          orgName,
          scheduledAt: data.scheduledAt || data.scheduledFor,
        }
      })
    )

    return apiSuccess(posts)
  } catch (err) {
    console.error('[pending-posts-error]', err)
    return apiError('Failed to fetch pending approvals', 500)
  }
})
