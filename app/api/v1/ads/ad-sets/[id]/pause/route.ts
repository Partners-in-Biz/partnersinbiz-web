// app/api/v1/ads/ad-sets/[id]/pause/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getAdSet, updateAdSet } from '@/lib/ads/adsets/store'
import { getCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { logAdSetActivity } from '@/lib/ads/activity'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const adSet = await getAdSet(id)
    if (!adSet || adSet.orgId !== orgId) return apiError('Ad set not found', 404)

    await updateAdSet(id, { status: 'PAUSED' })

    if (adSet.platform === 'tiktok') {
      const tiktokData = (adSet.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const adgroupId = typeof tiktokData?.adgroupId === 'string' ? tiktokData.adgroupId : undefined
      if (adgroupId) {
        const conn = await getConnection({ orgId, platform: 'tiktok' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
          const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
          if (advertiserId) {
            try {
              const { pauseAdGroup: tiktokPauseAdGroup } = await import('@/lib/ads/providers/tiktok/adgroups')
              await tiktokPauseAdGroup({ advertiserId, accessToken, adgroupId })
            } catch {
              // Status already updated locally; TikTok sync failure is non-blocking
            }
          }
        }
      }
    }

    // Best-effort Meta sync — only if ad set is already pushed to Meta
    const metaId = (adSet.providerData?.meta as { id?: string } | undefined)?.id
    if (metaId) {
      const ctx = await requireMetaContext(req)
      if (!(ctx instanceof Response)) {
        try {
          // Resolve parent campaign's metaCampaignId for the upsert call
          const campaign = await getCampaign(adSet.campaignId)
          const metaCampaignId =
            (campaign?.providerData?.meta as { id?: string } | undefined)?.id ?? ''

          await metaProvider.upsertAdSet!({
            accessToken: ctx.accessToken,
            adAccountId: ctx.adAccountId,
            adSet: { ...adSet, status: 'PAUSED' } as any,
            metaCampaignId,
          })
        } catch {
          // Status already updated locally; Meta sync failure is non-blocking
        }
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
      action: 'paused',
      adSetId: id,
      adSetName: adSet.name,
    })

    const updated = await getAdSet(id)
    return apiSuccess(updated)
  },
)
