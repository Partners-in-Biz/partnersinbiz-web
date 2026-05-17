// app/api/v1/ads/campaigns/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getCampaign, updateCampaign, deleteCampaign } from '@/lib/ads/campaigns/store'
import { requireMetaContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { deleteCampaign as metaDeleteCampaign } from '@/lib/ads/providers/meta/campaigns'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import {
  updateCampaign as googleUpdateCampaign,
  removeCampaign as googleRemoveCampaign,
} from '@/lib/ads/providers/google/campaigns'
import type { UpdateAdCampaignInput } from '@/lib/ads/types'
import { logCampaignActivity } from '@/lib/ads/activity'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)

    if (!campaign) return apiError('Campaign not found', 404)
    if (campaign.orgId !== orgId) return apiError('Campaign not found', 404) // tenant isolation

    return apiSuccess(campaign)
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)
    if (!campaign || campaign.orgId !== orgId) return apiError('Campaign not found', 404)

    const patch = (await req.json()) as UpdateAdCampaignInput
    await updateCampaign(id, patch)

    const warnings: string[] = []

    if (campaign.platform === 'linkedin') {
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
              const { updateCampaignGroup } = await import('@/lib/ads/providers/linkedin/campaigns')
              await updateCampaignGroup({
                accountUrn,
                accessToken,
                groupUrn,
                patch: {
                  ...(patch.name ? { name: patch.name } : {}),
                  ...(patch.status ? { status: patch.status === 'ACTIVE' ? 'ACTIVE' : patch.status === 'PAUSED' ? 'PAUSED' : 'ARCHIVED' } : {}),
                },
              })
            } catch (err) {
              warnings.push(`LinkedIn sync warning: ${(err as Error).message}`)
            }
          }
        }
      }
    } else if (campaign.platform === 'google') {
      const googleData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.campaignResourceName === 'string' ? googleData.campaignResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
            const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
            if (loginCustomerId) {
              try {
                await googleUpdateCampaign({
                  customerId: loginCustomerId,
                  accessToken,
                  developerToken,
                  loginCustomerId,
                  resourceName,
                  name: patch.name,
                  status: patch.status,
                })
              } catch (err) {
                warnings.push(`Google Ads sync warning: ${(err as Error).message}`)
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
              campaign: { ...campaign, ...patch } as any,
            })
          } catch (err) {
            warnings.push(`Meta sync warning: ${(err as Error).message}`)
          }
        }
      }
    }

    const updated = await getCampaign(id)
    const responseData = warnings.length ? { ...updated, warnings } : updated
    return apiSuccess(responseData)
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const campaign = await getCampaign(id)
    if (!campaign || campaign.orgId !== orgId) return apiError('Campaign not found', 404)

    if (campaign.platform === 'linkedin') {
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
              const { archiveCampaignGroup } = await import('@/lib/ads/providers/linkedin/campaigns')
              await archiveCampaignGroup({ accountUrn, accessToken, groupUrn })
            } catch {
              // swallow — local delete is source of truth
            }
          }
        }
      }
    } else if (campaign.platform === 'google') {
      const googleData = (campaign.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.campaignResourceName === 'string' ? googleData.campaignResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const googleMeta = ((conn.meta ?? {}) as Record<string, unknown>).google as Record<string, unknown> | undefined
            const loginCustomerId = typeof googleMeta?.loginCustomerId === 'string' ? googleMeta.loginCustomerId : undefined
            if (loginCustomerId) {
              try {
                await googleRemoveCampaign({
                  customerId: loginCustomerId,
                  accessToken,
                  developerToken,
                  loginCustomerId,
                  resourceName,
                })
              } catch {
                // swallow — local delete is source of truth
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
            await metaDeleteCampaign({ metaCampaignId: metaId, accessToken: ctx.accessToken })
          } catch {
            // swallow — local delete is source of truth
          }
        }
      }
    }

    await deleteCampaign(id)

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logCampaignActivity({
      orgId,
      actor,
      action: 'deleted',
      campaignId: id,
      campaignName: campaign.name,
    })

    return apiSuccess({ deleted: true })
  },
)
