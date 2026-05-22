// app/api/v1/ads/ad-sets/[id]/launch/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getAdSet, updateAdSet, setAdSetMetaId } from '@/lib/ads/adsets/store'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { logAdSetActivity } from '@/lib/ads/activity'
import type { ApiUser } from '@/lib/api/types'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)
    const capabilityError = enforceAgentCapability(user, 'spend', req)
    if (capabilityError) return capabilityError

    const { id } = await ctxParams.params
    const adSet = await getAdSet(id)
    if (!adSet || adSet.orgId !== orgId) return apiError('Ad set not found', 404)

    // Set status ACTIVE locally
    await updateAdSet(id, { status: 'ACTIVE' })

    if (adSet.platform === 'tiktok') {
      const tiktokData = (adSet.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const adgroupId = typeof tiktokData?.adgroupId === 'string' ? tiktokData.adgroupId : undefined
      if (!adgroupId) return apiError('Ad set has no TikTok adgroup id — create first', 400)

      const conn = await getConnection({ orgId, platform: 'tiktok' })
      if (!conn) return apiError('No TikTok ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
      const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
      if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

      const { resumeAdGroup: tiktokResumeAdGroup } = await import('@/lib/ads/providers/tiktok/adgroups')
      await tiktokResumeAdGroup({ advertiserId, accessToken, adgroupId })
    } else {
      const ctx = await requireMetaContext(req)
      if (ctx instanceof Response) return ctx

      // Resolve parent campaign's Meta ID — required for Meta ad set creation
      const campaign = await getCampaign(adSet.campaignId)
      const metaCampaignId = (campaign?.providerData?.meta as { id?: string } | undefined)?.id
      if (!metaCampaignId) {
        return apiError('Parent campaign not yet on Meta — launch the campaign first', 400)
      }

      const result = (await metaProvider.upsertAdSet!({
        accessToken: ctx.accessToken,
        adAccountId: ctx.adAccountId,
        adSet: { ...adSet, status: 'ACTIVE' } as any,
        metaCampaignId,
      })) as { metaAdSetId: string; created: boolean }

      if (result.created) {
        await setAdSetMetaId(id, result.metaAdSetId)
      }
    }

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logAdSetActivity({
      orgId,
      actor,
      action: 'launched',
      adSetId: id,
      adSetName: adSet.name,
    })

    const updated = await getAdSet(id)
    return apiSuccess(updated)
  },
)
