/**
 * GET /api/v1/social/stats?orgId={id}  — get social analytics for an org
 */
import type { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type PostStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'failed' | 'cancelled'

interface SocialStats {
  total: number
  byStatus: {
    draft: number
    pending_approval: number
    approved: number
    scheduled: number
    published: number
    failed: number
    cancelled: number
  }
  byPlatform: Record<string, number>
  approvalRate: number
  last30Days: number
  last30DaysSeries: { label: string; value: number }[]
}

interface SocialPostData {
  id: string
  status?: string
  platforms?: unknown
  platform?: unknown
  createdAt?: Timestamp | string | Date | null
  updatedAt?: Timestamp | string | Date | null
  scheduledAt?: Timestamp | string | Date | null
  scheduledFor?: Timestamp | string | Date | null
  publishedAt?: Timestamp | string | Date | null
}

const TREND_BUCKETS = 7
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function emptyLast30DaysSeries() {
  return Array.from({ length: TREND_BUCKETS }, (_, i) => ({
    label: `W${i + 1}`,
    value: 0,
  }))
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toDate?: () => Date
      seconds?: number
      _seconds?: number
    }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function trendBucketIndex(date: Date, now = Date.now()): number {
  const ageMs = now - date.getTime()
  if (ageMs < 0 || ageMs > THIRTY_DAYS_MS) return -1

  const bucketSize = THIRTY_DAYS_MS / TREND_BUCKETS
  const bucketFromNewest = Math.min(TREND_BUCKETS - 1, Math.floor(ageMs / bucketSize))
  return TREND_BUCKETS - 1 - bucketFromNewest
}

function trendDateForPost(post: SocialPostData): Date | null {
  const status = post.status ?? 'draft'
  if (status === 'published' || status === 'partially_published') {
    return toDate(post.publishedAt) ?? toDate(post.scheduledAt) ?? toDate(post.scheduledFor) ?? toDate(post.updatedAt) ?? toDate(post.createdAt)
  }
  if (status === 'scheduled' || status === 'publishing') {
    return toDate(post.scheduledAt) ?? toDate(post.scheduledFor) ?? toDate(post.updatedAt) ?? toDate(post.createdAt)
  }
  return null
}

export const GET = withAuth('client', withTenant(async (req, _user, orgId) => {
  const snapshot = await adminDb.collection('social_posts').where('orgId', '==', orgId).get()

  const posts: SocialPostData[] = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<SocialPostData, 'id'>),
  }))

  // Initialize stats
  const stats: SocialStats = {
    total: posts.length,
    byStatus: {
      draft: 0,
      pending_approval: 0,
      approved: 0,
      scheduled: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
    },
    byPlatform: {},
    approvalRate: 0,
    last30Days: 0,
    last30DaysSeries: emptyLast30DaysSeries(),
  }

  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS)

  // Count by status and platform, calculate last 30 days
  posts.forEach((post) => {
    const status = (post.status || 'draft') as PostStatus
    if (status in stats.byStatus) {
      stats.byStatus[status]++
    }

    // Count platforms
    const platforms = Array.isArray(post.platforms)
      ? post.platforms
      : post.platform
        ? [post.platform]
        : []
    platforms.forEach((platform) => {
      if (typeof platform !== 'string') return
      stats.byPlatform[platform] = (stats.byPlatform[platform] ?? 0) + 1
    })

    // Publishing trend should follow when the post went out or was scheduled,
    // not when the draft record was first created.
    const trendDate = trendDateForPost(post)
    if (trendDate && trendDate > thirtyDaysAgo) {
      const bucket = trendBucketIndex(trendDate)
      if (bucket < 0) return
      stats.last30Days++
      stats.last30DaysSeries[bucket].value++
    }
  })

  // Calculate approval rate (approved / (approved + rejected))
  const approved = stats.byStatus.approved
  const rejected = stats.byStatus.draft // When rejected, status is set back to draft
  const totalReviewable = approved + rejected
  stats.approvalRate = totalReviewable > 0 ? Math.round((approved / totalReviewable) * 100) : 0

  return apiSuccess(stats)
}))
