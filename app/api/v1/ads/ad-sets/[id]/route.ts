// app/api/v1/ads/ad-sets/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getAdSet, updateAdSet, deleteAdSet } from '@/lib/ads/adsets/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { deleteAdSet as metaDeleteAdSet } from '@/lib/ads/providers/meta/adsets'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import {
  updateAdGroup as googleUpdateAdGroup,
  removeAdGroup as googleRemoveAdGroup,
} from '@/lib/ads/providers/google/adgroups'
import type { UpdateAdSetInput } from '@/lib/ads/types'
import { logAdSetActivity } from '@/lib/ads/activity'
import type { ApiUser } from '@/lib/api/types'

function ignoreBestEffortFailure() {
  return undefined
}

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const adSet = await getAdSet(id)

    if (!adSet) return apiError('Ad set not found', 404)
    if (adSet.orgId !== orgId) return apiError('Ad set not found', 404) // tenant isolation

    return apiSuccess(adSet)
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const adSet = await getAdSet(id)
    if (!adSet || adSet.orgId !== orgId) return apiError('Ad set not found', 404)

    const patch = (await req.json()) as UpdateAdSetInput
    await updateAdSet(id, patch)

    const warnings: string[] = []

    if (adSet.platform === 'google') {
      const googleData = (adSet.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.adGroupResourceName === 'string' ? googleData.adGroupResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const customerCtx = resolveGoogleAdsCustomerContext(conn)
            if (!(customerCtx instanceof Response)) {
              try {
                await googleUpdateAdGroup({
                  customerId: customerCtx.customerId,
                  accessToken,
                  developerToken,
                  loginCustomerId: customerCtx.loginCustomerId,
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
    } else if (adSet.platform === 'tiktok') {
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
              const { updateAdGroup: tiktokUpdateAdGroup } = await import('@/lib/ads/providers/tiktok/adgroups')
              await tiktokUpdateAdGroup({
                advertiserId,
                accessToken,
                adgroupId,
                patch: {
                  ...(patch.name ? { name: patch.name } : {}),
                },
              })
            } catch (err) {
              warnings.push(`TikTok Ads sync warning: ${(err as Error).message}`)
            }
          }
        }
      }
    } else if (adSet.platform === 'linkedin') {
      const linkedinData = (adSet.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const campaignUrn = typeof linkedinData?.campaignUrn === 'string' ? linkedinData.campaignUrn : undefined
      if (campaignUrn) {
        const conn = await getConnection({ orgId, platform: 'linkedin' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
          const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
          if (accountUrn) {
            try {
              const { updateCampaign: linkedinUpdateCampaign } = await import('@/lib/ads/providers/linkedin/adsets')
              const { linkedinStatusFromCanonical } = await import('@/lib/ads/providers/linkedin/mappers')
              await linkedinUpdateCampaign({
                accountUrn,
                accessToken,
                campaignUrn,
                patch: {
                  ...(patch.name ? { name: patch.name } : {}),
                  ...(patch.status ? { status: linkedinStatusFromCanonical(patch.status) } : {}),
                },
              })
            } catch (err) {
              warnings.push(`LinkedIn Ads sync warning: ${(err as Error).message}`)
            }
          }
        }
      }
    } else {
      // Meta path — preserved verbatim
      // PATCH limited to: name, status, dailyBudget, lifetimeBudget, bidAmount
      // Targeting changes require re-create (Meta API limitation)
      const metaId = (adSet.providerData?.meta as { id?: string } | undefined)?.id
      if (metaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaProvider.upsertAdSet!({
              accessToken: ctx.accessToken,
              adAccountId: ctx.adAccountId,
              adSet: { ...adSet, ...patch } as any,
              metaCampaignId: (adSet.providerData?.meta as { campaignId?: string } | undefined)?.campaignId ?? '',
            })
          } catch (err) {
            warnings.push(`Meta sync warning: ${(err as Error).message}`)
          }
        }
      }
    }

    const updated = await getAdSet(id)
    const responseData = warnings.length ? { ...updated, warnings } : updated
    return apiSuccess(responseData)
  },
)

export const DELETE = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const adSet = await getAdSet(id)
    if (!adSet || adSet.orgId !== orgId) return apiError('Ad set not found', 404)
    const capabilityError = enforceAgentCapability(user, 'delete', req)
    if (capabilityError) return capabilityError

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
              const { archiveAdGroup: tiktokArchiveAdGroup } = await import('@/lib/ads/providers/tiktok/adgroups')
              await tiktokArchiveAdGroup({ advertiserId, accessToken, adgroupId })
            } catch { ignoreBestEffortFailure() }
          }
        }
      }
    } else if (adSet.platform === 'google') {
      const googleData = (adSet.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.adGroupResourceName === 'string' ? googleData.adGroupResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const customerCtx = resolveGoogleAdsCustomerContext(conn)
            if (!(customerCtx instanceof Response)) {
              try {
                await googleRemoveAdGroup({
                  customerId: customerCtx.customerId,
                  accessToken,
                  developerToken,
                  loginCustomerId: customerCtx.loginCustomerId,
                  resourceName,
                })
              } catch { ignoreBestEffortFailure() }
            }
          }
        }
      }
    } else if (adSet.platform === 'linkedin') {
      const linkedinData = (adSet.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const campaignUrn = typeof linkedinData?.campaignUrn === 'string' ? linkedinData.campaignUrn : undefined
      if (campaignUrn) {
        const conn = await getConnection({ orgId, platform: 'linkedin' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
          const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
          if (accountUrn) {
            try {
              const { archiveCampaign: linkedinArchiveCampaign } = await import('@/lib/ads/providers/linkedin/adsets')
              await linkedinArchiveCampaign({ accountUrn, accessToken, campaignUrn })
            } catch { ignoreBestEffortFailure() }
          }
        }
      }
    } else {
      // Meta path — preserved verbatim
      const metaId = (adSet.providerData?.meta as { id?: string } | undefined)?.id
      if (metaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaDeleteAdSet({ metaAdSetId: metaId, accessToken: ctx.accessToken })
          } catch { ignoreBestEffortFailure() }
        }
      }
    }

    await deleteAdSet(id)

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logAdSetActivity({
      orgId,
      actor,
      action: 'deleted',
      adSetId: id,
      adSetName: adSet.name,
    })

    return apiSuccess({ deleted: true })
  },
)
