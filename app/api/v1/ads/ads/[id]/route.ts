// app/api/v1/ads/ads/[id]/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getAd, updateAd, deleteAd } from '@/lib/ads/ads/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import { deleteAd as metaDeleteAd } from '@/lib/ads/providers/meta/ads'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import {
  updateAdGroupAd as googleUpdateAdGroupAd,
  removeAdGroupAd as googleRemoveAdGroupAd,
} from '@/lib/ads/providers/google/ads'
import type { UpdateAdInput } from '@/lib/ads/types'
import { logAdActivity } from '@/lib/ads/activity'
import type { ApiUser } from '@/lib/api/types'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ad = await getAd(id)

    if (!ad) return apiError('Ad not found', 404)
    if (ad.orgId !== orgId) return apiError('Ad not found', 404) // tenant isolation

    return apiSuccess(ad)
  },
)

export const PATCH = withAuth(
  'admin',
  async (req: NextRequest, _user: unknown, ctxParams: { params: Promise<{ id: string }> }) => {
    const orgId = req.headers.get('X-Org-Id')
    if (!orgId) return apiError('Missing X-Org-Id header', 400)

    const { id } = await ctxParams.params
    const ad = await getAd(id)
    if (!ad || ad.orgId !== orgId) return apiError('Ad not found', 404)

    const patch = (await req.json()) as UpdateAdInput
    await updateAd(id, patch)

    const warnings: string[] = []

    if (ad.platform === 'google') {
      const googleData = (ad.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.adGroupAdResourceName === 'string' ? googleData.adGroupAdResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const customerCtx = resolveGoogleAdsCustomerContext(conn)
            if (!(customerCtx instanceof Response)) {
              try {
                await googleUpdateAdGroupAd({
                  customerId: customerCtx.customerId,
                  accessToken,
                  developerToken,
                  loginCustomerId: customerCtx.loginCustomerId,
                  resourceName,
                  status: patch.status,
                })
              } catch (err) {
                warnings.push(`Google Ads sync warning: ${(err as Error).message}`)
              }
            }
          }
        }
      }
    } else if (ad.platform === 'tiktok') {
      const tiktokData = (ad.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const adId = typeof tiktokData?.adId === 'string' ? tiktokData.adId : undefined
      if (adId) {
        const conn = await getConnection({ orgId, platform: 'tiktok' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
          const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
          if (advertiserId) {
            try {
              const { updateAd: tiktokUpdateAd } = await import('@/lib/ads/providers/tiktok/ads')
              await tiktokUpdateAd({
                advertiserId,
                accessToken,
                adId,
                patch: {
                  ...(patch.name ? { adName: patch.name } : {}),
                },
              })
            } catch (err) {
              warnings.push(`TikTok Ads sync warning: ${(err as Error).message}`)
            }
          }
        }
      }
    } else if (ad.platform === 'linkedin') {
      const linkedinData = (ad.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const creativeUrn = typeof linkedinData?.creativeUrn === 'string' ? linkedinData.creativeUrn : undefined
      if (creativeUrn) {
        const conn = await getConnection({ orgId, platform: 'linkedin' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
          const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
          if (accountUrn) {
            try {
              const { updateCreative: linkedinUpdateCreative } = await import('@/lib/ads/providers/linkedin/ads')
              const { linkedinStatusFromCanonical } = await import('@/lib/ads/providers/linkedin/mappers')
              await linkedinUpdateCreative({
                accountUrn,
                accessToken,
                creativeUrn,
                patch: {
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
      // PATCH limited to: name, status
      // Creative changes require re-create (Meta API limitation — updateAd in meta/ads.ts)
      const metaId = (ad.providerData?.meta as { id?: string } | undefined)?.id
      if (metaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaProvider.upsertAd!({
              accessToken: ctx.accessToken,
              adAccountId: ctx.adAccountId,
              ad: { ...ad, ...patch } as any,
              metaAdSetId: (ad.providerData?.meta as { adSetId?: string } | undefined)?.adSetId ?? '',
              pageId: req.headers.get('X-Page-Id') ?? '',
            })
          } catch (err) {
            warnings.push(`Meta sync warning: ${(err as Error).message}`)
          }
        }
      }
    }

    const updated = await getAd(id)
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
    const ad = await getAd(id)
    if (!ad || ad.orgId !== orgId) return apiError('Ad not found', 404)
    const capabilityError = enforceAgentCapability(user, 'delete', req)
    if (capabilityError) return capabilityError

    if (ad.platform === 'tiktok') {
      const tiktokData = (ad.providerData as Record<string, unknown>)?.tiktok as Record<string, unknown> | undefined
      const adId = typeof tiktokData?.adId === 'string' ? tiktokData.adId : undefined
      if (adId) {
        const conn = await getConnection({ orgId, platform: 'tiktok' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as Record<string, unknown> | undefined
          const advertiserId = typeof tiktokMeta?.selectedAdvertiserId === 'string' ? tiktokMeta.selectedAdvertiserId : undefined
          if (advertiserId) {
            try {
              const { archiveAd: tiktokArchiveAd } = await import('@/lib/ads/providers/tiktok/ads')
              await tiktokArchiveAd({ advertiserId, accessToken, adId })
            } catch {
              // swallow — local delete is source of truth
            }
          }
        }
      }
    } else if (ad.platform === 'google') {
      const googleData = (ad.providerData as Record<string, unknown>)?.google as Record<string, unknown> | undefined
      const resourceName = typeof googleData?.adGroupAdResourceName === 'string' ? googleData.adGroupAdResourceName : undefined
      if (resourceName) {
        const conn = await getConnection({ orgId, platform: 'google' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const developerToken = readDeveloperToken()
          if (developerToken) {
            const customerCtx = resolveGoogleAdsCustomerContext(conn)
            if (!(customerCtx instanceof Response)) {
              try {
                await googleRemoveAdGroupAd({
                  customerId: customerCtx.customerId,
                  accessToken,
                  developerToken,
                  loginCustomerId: customerCtx.loginCustomerId,
                  resourceName,
                })
              } catch {
                // swallow — local delete is source of truth
              }
            }
          }
        }
      }
    } else if (ad.platform === 'linkedin') {
      const linkedinData = (ad.providerData as Record<string, unknown>)?.linkedin as Record<string, unknown> | undefined
      const creativeUrn = typeof linkedinData?.creativeUrn === 'string' ? linkedinData.creativeUrn : undefined
      if (creativeUrn) {
        const conn = await getConnection({ orgId, platform: 'linkedin' })
        if (conn) {
          const accessToken = decryptAccessToken(conn)
          const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
          const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
          if (accountUrn) {
            try {
              const { archiveCreative: linkedinArchiveCreative } = await import('@/lib/ads/providers/linkedin/ads')
              await linkedinArchiveCreative({ accountUrn, accessToken, creativeUrn })
            } catch {
              // swallow — local delete is source of truth
            }
          }
        }
      }
    } else {
      // Meta path — preserved verbatim
      const metaId = (ad.providerData?.meta as { id?: string } | undefined)?.id
      if (metaId) {
        const ctx = await requireMetaContext(req)
        if (!(ctx instanceof Response)) {
          try {
            await metaDeleteAd({ metaAdId: metaId, accessToken: ctx.accessToken })
          } catch {
            // swallow — local delete is source of truth
          }
        }
      }
    }

    await deleteAd(id)

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logAdActivity({
      orgId,
      actor,
      action: 'deleted',
      adId: id,
      adName: ad.name,
    })

    return apiSuccess({ deleted: true })
  },
)
