// app/api/v1/ads/ads/[id]/launch/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getAd, updateAd, setAdMetaIds } from '@/lib/ads/ads/store'
import { getAdSet } from '@/lib/ads/adsets/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { logAdActivity } from '@/lib/ads/activity'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ad = await getAd(id)
    if (!ad || ad.orgId !== orgId) return apiError('Ad not found', 404)

    // Set status ACTIVE locally
    await updateAd(id, { status: 'ACTIVE' })

    if (ad.platform === 'tiktok') {
      const tiktokData = (ad.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const adId = typeof tiktokData?.adId === 'string' ? tiktokData.adId : undefined
      if (!adId) return apiError('Ad has no TikTok ad id — create first', 400)

      const conn = await getConnection({ orgId, platform: 'tiktok' })
      if (!conn) return apiError('No TikTok ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
      const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
      if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

      const { resumeAd: tiktokResumeAd } = await import('@/lib/ads/providers/tiktok/ads')
      await tiktokResumeAd({ advertiserId, accessToken, adId })
    } else {
      const ctx = await requireMetaContext(req)
      if (ctx instanceof Response) return ctx

      // Phase 2: caller must supply pageId via X-Page-Id header
      // Phase 3+ will move this to org-level config
      const pageId = req.headers.get('X-Page-Id')
      if (!pageId) {
        return apiError('Missing X-Page-Id header — required for ad creative', 400)
      }

      // Resolve parent ad set's Meta ID — required for Meta ad creation
      const adSet = await getAdSet(ad.adSetId)
      const metaAdSetId = (adSet?.providerData?.meta as { id?: string } | undefined)?.id
      if (!metaAdSetId) {
        return apiError('Parent ad set not yet on Meta — launch the ad set first', 400)
      }

      const result = (await metaProvider.upsertAd!({
        accessToken: ctx.accessToken,
        adAccountId: ctx.adAccountId,
        ad: { ...ad, status: 'ACTIVE' } as any,
        metaAdSetId,
        pageId,
      })) as { metaAdId: string; metaCreativeId?: string; created: boolean }

      if (result.created) {
        await setAdMetaIds(id, {
          metaAdId: result.metaAdId,
          metaCreativeId: result.metaCreativeId ?? '',
        })
      }
    }

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logAdActivity({
      orgId,
      actor,
      action: 'launched',
      adId: id,
      adName: ad.name,
    })

    const updated = await getAd(id)
    return apiSuccess(updated)
  },
)
