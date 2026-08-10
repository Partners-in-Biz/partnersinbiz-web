/**
 * POST /api/v1/campaigns/[id]/approve-all
 *
 * Body: { type?: 'social' | 'seo_content' | 'video' | 'all' }  (default 'all')
 *
 * Fan-out helper. Queries assets joined to this campaign by `campaignId` and
 * flips them to the same approved/published state the per-asset endpoints
 * would set:
 *   - social_posts in `pending_approval` -> `approved`
 *   - seo_content  in `idea` | `review`  -> `live`
 *   - videos = subset of social_posts where media[0].type === 'video'
 *
 * Idempotency-keyed.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
type ApproveType = 'social' | 'seo_content' | 'video' | 'all'

const SOCIAL_PENDING = ['pending_approval'] as const
const SEO_PENDING = ['idea', 'review'] as const

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { id } = await (context as Params).params
    const body = await req.json().catch(() => ({}))
    const type: ApproveType = (body?.type as ApproveType) ?? 'all'

    if (!['social', 'seo_content', 'video', 'all'].includes(type)) {
      return apiError('type must be one of: social, seo_content, video, all', 400)
    }

    // Verify campaign exists + tenant
    const campaignSnap = await adminDb.collection('campaigns').doc(id).get()
    if (!campaignSnap.exists) return apiError('Campaign not found', 404)
    const campaign = campaignSnap.data()!
    if (campaign.deleted) return apiError('Campaign not found', 404)
    const access = await assertMarketingHandlerAccess({
      user,
      module: 'campaigns',
      resourceId: id,
      resourceOwnerOrgId: (campaign.orgId as string | undefined) ?? null,
      operation: 'approve',
      partnerLinkId: extractPartnerLinkId(req),
    })
    if (!access.ok) return apiError(access.error, access.status)
    const scope = { ok: true as const, orgId: access.orgId }
    const wantSocial = type === 'social' || type === 'video' || type === 'all'
    const wantSeo = type === 'seo_content' || type === 'all'

    let socialApproved = 0
    let videoApproved = 0
    let seoApproved = 0

    if (wantSocial) {
      const snap = await adminDb
        .collection('social_posts')
        .where('campaignId', '==', id)
        .get()
      const batch = adminDb.batch()
      let writes = 0
      for (const doc of snap.docs) {
        const data = doc.data()
        if (!SOCIAL_PENDING.includes(data.status)) continue
        const isVideo = Array.isArray(data.media) && data.media[0]?.type === 'video'
        if (type === 'video' && !isVideo) continue
        if (type === 'social' && isVideo) continue
        batch.update(doc.ref, {
          status: 'approved',
          approvedBy: user.uid,
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (isVideo) videoApproved++
        else socialApproved++
        writes++
      }
      if (writes > 0) await batch.commit()
    }

    if (wantSeo) {
      const snap = await adminDb
        .collection('seo_content')
        .where('campaignId', '==', id)
        .get()
      const batch = adminDb.batch()
      let writes = 0
      for (const doc of snap.docs) {
        const data = doc.data()
        if (data.deleted) continue
        if (!SEO_PENDING.includes(data.status)) continue
        batch.update(doc.ref, {
          status: 'live',
          publishDate: data.publishDate ?? new Date().toISOString(),
          publishedAt: FieldValue.serverTimestamp(),
          ...lastActorFrom(user),
        })
        seoApproved++
        writes++
      }
      if (writes > 0) await batch.commit()
    }

    logActivity({
      orgId: campaign.orgId,
      type: 'campaign_approve_all',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Approved all posts in campaign',
      entityId: id,
      entityType: 'campaign',
      entityTitle: campaign.name ?? undefined,
    }).catch(() => {})

    return apiSuccess({
      campaignId: id,
      type,
      approved: {
        social: socialApproved,
        videos: videoApproved,
        seo_content: seoApproved,
        total: socialApproved + videoApproved + seoApproved,
      },
    })
  }),
)
