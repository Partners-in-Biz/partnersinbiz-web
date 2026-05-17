// app/api/v1/ads/campaigns/[id]/launch/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaign, updateCampaign, setCampaignMetaId } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { resumeCampaign as googleResumeCampaign } from '@/lib/ads/providers/google/campaigns'
import { logCampaignActivity } from '@/lib/ads/activity'
import { notifyCampaignLaunched } from '@/lib/ads/notifications'

export const POST = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)
    if (!campaign || campaign.orgId !== orgId) return apiError('Campaign not found', 404)

    // Set status ACTIVE locally first
    await updateCampaign(id, { status: 'ACTIVE' })

    if (campaign.platform === 'linkedin') {
      const linkedinData = (campaign.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const groupUrn = typeof linkedinData?.campaignGroupUrn === 'string' ? linkedinData.campaignGroupUrn : undefined
      if (!groupUrn) return apiError('Campaign has no LinkedIn Campaign Group URN — create first', 400)

      const conn = await getConnection({ orgId, platform: 'linkedin' })
      if (!conn) return apiError('No LinkedIn ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
      const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
      if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

      const { resumeCampaignGroup } = await import('@/lib/ads/providers/linkedin/campaigns')
      await resumeCampaignGroup({ accountUrn, accessToken, groupUrn })
    } else if (campaign.platform === 'google') {
      const conn = await getConnection({ orgId, platform: 'google' })
      if (!conn) return apiError('No Google Ads connection for org', 400)
      const accessToken = decryptAccessToken(conn)
      const developerToken = readDeveloperToken()
      if (!developerToken) return apiError('Google Ads developer token not configured', 500)
      const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
      const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
      if (!loginCustomerId) return apiError('No Customer ID set on Google connection', 400)

      const googleData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.campaignResourceName === 'string' ? googleData.campaignResourceName : undefined
      if (!resourceName) return apiError('Campaign has no Google resource name — create first', 400)

      await googleResumeCampaign({
        customerId: loginCustomerId,
        accessToken,
        developerToken,
        loginCustomerId,
        resourceName,
      })
    } else {
      // Meta path — preserved verbatim
      const ctx = await requireMetaContext(req)
      if (ctx instanceof Response) return ctx

      const result = (await metaProvider.upsertCampaign!({
        accessToken: ctx.accessToken,
        adAccountId: ctx.adAccountId,
        campaign: { ...campaign, status: 'ACTIVE' } as any,
      })) as { metaCampaignId: string; created: boolean }

      if (result.created) {
        await setCampaignMetaId(id, result.metaCampaignId)
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
      action: 'launched',
      campaignId: id,
      campaignName: campaign.name,
    })
    const orgSlug = req.headers.get('X-Org-Slug') ?? ''
    if (orgSlug) {
      await notifyCampaignLaunched({
        orgId,
        orgSlug,
        campaignId: id,
        campaignName: campaign.name,
        objective: campaign.objective,
      })
    }

    const updated = await getCampaign(id)
    return apiSuccess(updated)
  },
)
