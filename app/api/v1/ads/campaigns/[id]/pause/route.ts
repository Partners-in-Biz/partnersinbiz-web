// app/api/v1/ads/campaigns/[id]/pause/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaign, updateCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { pauseCampaign as googlePauseCampaign } from '@/lib/ads/providers/google/campaigns'
import { logCampaignActivity } from '@/lib/ads/activity'
import { notifyCampaignPaused } from '@/lib/ads/notifications'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)
    if (!campaign || campaign.orgId !== orgId) return apiError('Campaign not found', 404)

    await updateCampaign(id, { status: 'PAUSED' })

    if (campaign.platform === 'tiktok') {
      const tiktokData = (campaign.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const campaignId = typeof tiktokData?.campaignId === 'string' ? tiktokData.campaignId : undefined
      if (campaignId) {
        const conn = await getConnection({ orgId, platform: 'tiktok' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
          const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
          if (advertiserId) {
            try {
              const { pauseCampaign: tiktokPauseCampaign } = await import('@/lib/ads/providers/tiktok/campaigns')
              await tiktokPauseCampaign({ advertiserId, accessToken, campaignId })
            } catch {
              // Status already updated locally; TikTok sync failure is non-blocking
            }
          }
        }
      }
    } else if (campaign.platform === 'linkedin') {
      // Best-effort LinkedIn sync — only if campaign has been pushed to LinkedIn
      const linkedinData = (campaign.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const groupUrn = typeof linkedinData?.campaignGroupUrn === 'string' ? linkedinData.campaignGroupUrn : undefined
      if (groupUrn) {
        const conn = await getConnection({ orgId, platform: 'linkedin' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
          const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
          if (accountUrn) {
            try {
              const { pauseCampaignGroup } = await import('@/lib/ads/providers/linkedin/campaigns')
              await pauseCampaignGroup({ accountUrn, accessToken, groupUrn })
            } catch {
              // Status already updated locally; LinkedIn sync failure is non-blocking
            }
          }
        }
      }
    } else if (campaign.platform === 'google') {
      // Best-effort Google sync — only if campaign has been pushed to Google
      const googleData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.campaignResourceName === 'string' ? googleData.campaignResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const customerCtx = resolveGoogleAdsCustomerContext(conn)
            if (!(customerCtx instanceof Response)) {
              try {
                await googlePauseCampaign({
                  customerId: customerCtx.customerId,
                  accessToken,
                  developerToken,
                  loginCustomerId: customerCtx.loginCustomerId,
                  resourceName,
                })
              } catch {
                // Status already updated locally; Google sync failure is non-blocking
              }
            }
          }
        }
      }
    } else {
      // Meta path — preserved verbatim
      const metaId = (campaign.providerData?.meta as { id?: string } | undefined)?.id
      if (metaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaProvider.upsertCampaign!({
              accessToken: ctx.accessToken,
              adAccountId: ctx.adAccountId,
              campaign: { ...campaign, status: 'PAUSED' } as any,
            })
          } catch {
            // Status already updated locally; Meta sync failure is non-blocking
          }
        }
      }
    }

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logCampaignActivity({
      orgId,
      actor,
      action: 'paused',
      campaignId: id,
      campaignName: campaign.name,
    })
    const orgSlug = req.headers.get('X-Org-Slug') ?? ''
    if (orgSlug) {
      await notifyCampaignPaused({
        orgId,
        orgSlug,
        campaignId: id,
        campaignName: campaign.name,
      })
    }

    const updated = await getCampaign(id)
    return apiSuccess(updated)
  },
)
