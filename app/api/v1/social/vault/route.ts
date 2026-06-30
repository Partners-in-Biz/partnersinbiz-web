/**
 * GET /api/v1/social/vault — list posts visible in the content vault
 *
 * Vault visibility = status ∈ VAULT_VISIBLE_STATUSES.
 * Optional filters: ?platform=, ?from=, ?to=, ?label=, ?deliveryMode=
 *
 * Sorted by approvedAt desc (fall back to updatedAt) in-memory because
 * Firestore can't combine `in` with `orderBy` cleanly without composite indexes.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { VAULT_VISIBLE_STATUSES } from '@/lib/social/approval'
import type { DeliveryMode, SocialPlatformType } from '@/lib/social/providers'

export const dynamic = 'force-dynamic'

type RawPost = Record<string, unknown> & {
  id: string
  platforms?: SocialPlatformType[]
  labels?: string[]
  deliveryMode?: DeliveryMode
  approvedAt?: Timestamp | null
  scheduledAt?: Timestamp | null
  publishedAt?: Timestamp | null
  updatedAt?: Timestamp | null
  status?: string
  hashtags?: string[]
  media?: unknown[]
  content?: { text?: string } | string
}

const VALID_DELIVERY_MODES: DeliveryMode[] = ['auto_publish', 'download_only', 'both']

function tsSeconds(ts: Timestamp | null | undefined): number {
  return ts?.seconds ?? 0
}

const PERSONAL_SCOPE = 'personal'

export const GET = withAuth('client', withTenant(async (req, user, orgId) => {
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const label = searchParams.get('label')
  const deliveryMode = searchParams.get('deliveryMode') as DeliveryMode | null
  const personalScope = searchParams.get('scope') === PERSONAL_SCOPE

  // Firestore `in` accepts up to 30 values; VAULT_VISIBLE_STATUSES has 6.
  const snap = await adminDb
    .collection('social_posts')
    .where('orgId', '==', orgId)
    .where('status', 'in', VAULT_VISIBLE_STATUSES)
    .get()

  let posts: RawPost[] = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })).filter((post: RawPost) => {
    if (personalScope) return post.accountScope === PERSONAL_SCOPE && post.ownerUid === user.uid
    return post.accountScope !== PERSONAL_SCOPE
  })

  if (platform) {
    posts = posts.filter((p) => Array.isArray(p.platforms) && p.platforms.includes(platform as SocialPlatformType))
  }

  if (label) {
    posts = posts.filter((p) => Array.isArray(p.labels) && p.labels.includes(label))
  }

  if (deliveryMode && VALID_DELIVERY_MODES.includes(deliveryMode)) {
    posts = posts.filter((p) => p.deliveryMode === deliveryMode)
  }

  if (from) {
    const fromDate = new Date(from)
    if (!isNaN(fromDate.getTime())) {
      const fromTs = Timestamp.fromDate(fromDate)
      posts = posts.filter((p) => {
        const sf = p.approvedAt ?? p.scheduledAt ?? p.updatedAt
        return sf ? sf.seconds >= fromTs.seconds : false
      })
    }
  }

  if (to) {
    const toDate = new Date(to)
    if (!isNaN(toDate.getTime())) {
      const toTs = Timestamp.fromDate(toDate)
      posts = posts.filter((p) => {
        const sf = p.approvedAt ?? p.scheduledAt ?? p.updatedAt
        return sf ? sf.seconds <= toTs.seconds : false
      })
    }
  }

  // Sort by approvedAt desc, falling back to updatedAt.
  posts.sort((a, b) => {
    const aTs = tsSeconds(a.approvedAt) || tsSeconds(a.updatedAt)
    const bTs = tsSeconds(b.approvedAt) || tsSeconds(b.updatedAt)
    return bTs - aTs
  })

  const shaped = posts.map((p) => ({
    id: p.id,
    content: p.content ?? null,
    platforms: p.platforms ?? [],
    hashtags: p.hashtags ?? [],
    deliveryMode: p.deliveryMode ?? null,
    approvedAt: p.approvedAt ?? null,
    scheduledAt: p.scheduledAt ?? null,
    publishedAt: p.publishedAt ?? null,
    status: p.status ?? null,
    media: p.media ?? [],
    labels: p.labels ?? [],
  }))

  return apiSuccess(shaped, 200, { total: shaped.length, page: 1, limit: shaped.length })
}))
