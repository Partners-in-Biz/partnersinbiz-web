/**
 * GET /api/v1/campaigns/[id]/assets
 *
 * Returns the CampaignAssets roll-up: social_posts and seo_content (with
 * draft data joined where present) attached to this campaignId. Videos are
 * split out as the subset of social_posts with media[0].type === 'video'.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import {
  assertMarketingHandlerAccess,
  extractPartnerLinkId,
} from '@/lib/cross-org/marketing-handler-access'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { buildCampaignAssets } from '@/lib/campaigns/assets'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const campaignSnap = await adminDb.collection('campaigns').doc(id).get()
  if (!campaignSnap.exists) return apiError('Campaign not found', 404)
  const campaign = campaignSnap.data()!
  if (campaign.deleted) return apiError('Campaign not found', 404)
  const access = await assertMarketingHandlerAccess({
    user,
    module: 'campaigns',
    resourceId: id,
    resourceOwnerOrgId: (campaign.orgId as string | undefined) ?? null,
    operation: 'read',
    partnerLinkId: extractPartnerLinkId(req),
  })
  if (!access.ok) return apiError(access.error, access.status)
  const scope = { ok: true as const, orgId: access.orgId }
  const assets = await buildCampaignAssets(id)
  return apiSuccess(assets)
})
