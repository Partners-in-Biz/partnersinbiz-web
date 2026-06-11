// app/api/v1/ads/custom-audiences/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { listCustomAudiences, createCustomAudience, setCustomAudienceMetaId } from '@/lib/ads/custom-audiences/store'
import { requireMetaContext, resolveGoogleAdsCustomerContext } from '@/lib/ads/api-helpers'
import { metaProvider } from '@/lib/ads/providers/meta'
import type { AdCustomAudienceType, AdCustomAudienceStatus, CreateAdCustomAudienceInput } from '@/lib/ads/types'
import { logCustomAudienceActivity } from '@/lib/ads/activity'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getConnection, decryptAccessToken } from '@/lib/ads/connections/store'
import { getCampaign } from '@/lib/ads/campaigns/store'
import {
  approvalOverrideErrorMessage,
  findUntrustedApprovalOverride,
  requireApprovedCampaignForAdsAction,
} from '@/lib/ads/approval-gates'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import crypto from 'crypto'

export const GET = withAuth('admin', async (req: NextRequest) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  const url = new URL(req.url)
  const type = url.searchParams.get('type') as AdCustomAudienceType | null
  const status = url.searchParams.get('status') as AdCustomAudienceStatus | null
  const cas = await listCustomAudiences({
    orgId,
    type: type ?? undefined,
    status: status ?? undefined,
  })
  return apiSuccess(cas)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const orgId = req.headers.get('X-Org-Id')
  if (!orgId) return apiError('Missing X-Org-Id header', 400)

  // Parse body — may be { input: ... } for Meta or flat body for Google
  let rawBody: Record<string, unknown>
  try {
    rawBody = await req.json()
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const approvalOverridePath = findUntrustedApprovalOverride(rawBody)
  if (approvalOverridePath) return apiError(approvalOverrideErrorMessage(approvalOverridePath), 400)

  const approvalCampaignId =
    typeof rawBody.approvalCampaignId === 'string'
      ? rawBody.approvalCampaignId
      : typeof (rawBody.input as { approvalCampaignId?: unknown } | undefined)?.approvalCampaignId === 'string'
        ? ((rawBody.input as { approvalCampaignId: string }).approvalCampaignId)
        : undefined
  if (!approvalCampaignId) return apiError('Audience creation requires approvalCampaignId for persisted campaign approval evidence', 400)
  const approvalCampaign = await getCampaign(approvalCampaignId)
  if (!approvalCampaign || approvalCampaign.orgId !== orgId) return apiError('Campaign not found', 404)
  const approvalError = requireApprovedCampaignForAdsAction(approvalCampaign, 'audience')
  if (approvalError) return apiError(approvalError, 403)

  // ─── Google branch ────────────────────────────────────────────────────────
  if (rawBody.platform === 'google') {
    const body = rawBody as {
      platform: 'google'
      name?: string
      description?: string
      providerData?: {
        google?: {
          subtype?: string
          uploadKeyType?: string
          membershipLifeSpanDays?: number
          rule?: { kind: string; value: string }
          segmentType?: string
          values?: unknown[]
          audienceResourceName?: string
          categoryName?: string
          [key: string]: unknown
        }
      }
    }

    if (!body.name) return apiError('name is required', 400)

    const subtype = body.providerData?.google?.subtype
    if (!subtype) return apiError('Google audience requires providerData.google.subtype', 400)

    const conn = await getConnection({ orgId, platform: 'google' })
    if (!conn) return apiError('No Google Ads connection for org', 400)

    const accessToken = decryptAccessToken(conn)
    const developerToken = readDeveloperToken()
    if (!developerToken) return apiError('GOOGLE_ADS_DEVELOPER_TOKEN not configured', 500)

    const customerCtx = resolveGoogleAdsCustomerContext(conn)
    if (customerCtx instanceof Response) return customerCtx
    const { customerId, loginCustomerId } = customerCtx

    let result: { resourceName: string; id: string }

    switch (subtype) {
      case 'CUSTOMER_MATCH': {
        const { createCustomerMatchList } = await import('@/lib/ads/providers/google/audiences/customer-match')
        result = await createCustomerMatchList({
          customerId,
          accessToken,
          developerToken,
          loginCustomerId,
          name: body.name,
          description: body.description,
          uploadKeyType: body.providerData?.google?.uploadKeyType as 'CONTACT_INFO' | 'CRM_ID' | 'MOBILE_ADVERTISING_ID' | undefined,
        })
        break
      }
      case 'REMARKETING': {
        const { createRemarketingList } = await import('@/lib/ads/providers/google/audiences/remarketing')
        const rule = body.providerData?.google?.rule as { kind: string; value: string } | undefined
        if (!rule) return apiError('Remarketing requires providerData.google.rule', 400)
        result = await createRemarketingList({
          customerId,
          accessToken,
          developerToken,
          loginCustomerId,
          name: body.name,
          description: body.description,
          membershipLifeSpanDays: body.providerData?.google?.membershipLifeSpanDays,
          rule: rule as Parameters<typeof createRemarketingList>[0]['rule'],
        })
        break
      }
      case 'CUSTOM_SEGMENT': {
        const { createCustomSegment } = await import('@/lib/ads/providers/google/audiences/custom-segments')
        const segmentType = body.providerData?.google?.segmentType
        const values = body.providerData?.google?.values
        if (!segmentType || !Array.isArray(values)) {
          return apiError('Custom Segment requires providerData.google.{segmentType, values[]}', 400)
        }
        result = await createCustomSegment({
          customerId,
          accessToken,
          developerToken,
          loginCustomerId,
          name: body.name,
          description: body.description,
          type: segmentType as 'KEYWORD' | 'URL' | 'APP',
          values: values as string[],
        })
        break
      }
      case 'AFFINITY':
      case 'IN_MARKET':
      case 'DETAILED_DEMOGRAPHICS': {
        // Predefined audiences aren't created via mutate — they're selected from the catalog.
        // Persist the canonical doc with the user-supplied resourceName + categoryName.
        const audienceResourceName = body.providerData?.google?.audienceResourceName
        const categoryName = body.providerData?.google?.categoryName
        if (!audienceResourceName || !categoryName) {
          return apiError(`${subtype} requires providerData.google.{audienceResourceName, categoryName}`, 400)
        }
        result = {
          resourceName: audienceResourceName as string,
          id: (audienceResourceName as string).split('/').pop() ?? '',
        }
        break
      }
      default:
        return apiError(`Unsupported Google audience subtype: ${subtype}`, 400)
    }

    // Persist canonical doc directly (store.createCustomAudience hardcodes platform:'meta')
    const id = `ca_${crypto.randomBytes(8).toString('hex')}`
    const now = Timestamp.now()
    const googleProviderData = {
      ...body.providerData?.google,
      userListResourceName: result.resourceName,
    }
    const canonicalDoc = {
      id,
      orgId,
      platform: 'google' as const,
      name: body.name,
      description: body.description ?? '',
      type: subtypeToCanonicalType(subtype),
      status: 'BUILDING' as const,
      source: { kind: 'CUSTOMER_LIST' as const, csvStoragePath: '', hashCount: 0, uploadedAt: now },
      providerData: { google: googleProviderData },
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      createdAt: now,
      updatedAt: now,
    }

    await adminDb.collection('custom_audiences').doc(id).set(canonicalDoc)

    return apiSuccess(canonicalDoc, 201)
  }

  // ─── LinkedIn branch ──────────────────────────────────────────────────────
  if (rawBody.platform === 'linkedin') {
    const body = rawBody as {
      platform: 'linkedin'
      name?: string
      description?: string
      type?: 'CUSTOMER_LIST' | 'WEBSITE' | 'LOOKALIKE' | 'APP' | 'ENGAGEMENT'
      providerData?: {
        linkedin?: {
          insightTagId?: string
          websiteRules?: Array<{ matchType: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH'; url: string }>
          sourceSegmentUrn?: string
          organizationUrn?: string
          engagementType?: 'VISITORS' | 'FOLLOWERS' | 'VIDEO_VIEWERS'
        }
      }
    }

    if (!body.name) return apiError('name is required', 400)
    if (!body.type) return apiError('type is required', 400)

    const conn = await getConnection({ orgId, platform: 'linkedin' })
    if (!conn) return apiError('No LinkedIn ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const linkedinMeta = ((conn.meta ?? {}) as Record<string, unknown>).linkedin as Record<string, unknown> | undefined
    const accountUrn = typeof linkedinMeta?.selectedAdAccountUrn === 'string' ? linkedinMeta.selectedAdAccountUrn : undefined
    if (!accountUrn) return apiError('No Ad Account URN set on LinkedIn connection', 400)

    let result: { urn: string; id: string }
    try {
      switch (body.type) {
        case 'CUSTOMER_LIST': {
          const { createContactListAudience } = await import('@/lib/ads/providers/linkedin/audiences')
          result = await createContactListAudience({ accountUrn, accessToken, name: body.name })
          break
        }
        case 'WEBSITE': {
          const insightTagId = body.providerData?.linkedin?.insightTagId
          const rules = body.providerData?.linkedin?.websiteRules
          if (!insightTagId || !Array.isArray(rules) || rules.length === 0) {
            return apiError('WEBSITE requires providerData.linkedin.{insightTagId, websiteRules[]}', 400)
          }
          const { createWebsiteAudience } = await import('@/lib/ads/providers/linkedin/audiences')
          result = await createWebsiteAudience({ accountUrn, accessToken, name: body.name, insightTagId, rules })
          break
        }
        case 'LOOKALIKE': {
          const sourceSegmentUrn = body.providerData?.linkedin?.sourceSegmentUrn
          if (!sourceSegmentUrn) return apiError('LOOKALIKE requires providerData.linkedin.sourceSegmentUrn', 400)
          const { createLookalikeAudience } = await import('@/lib/ads/providers/linkedin/audiences')
          result = await createLookalikeAudience({ accountUrn, accessToken, name: body.name, sourceSegmentUrn })
          break
        }
        case 'ENGAGEMENT': {
          const organizationUrn = body.providerData?.linkedin?.organizationUrn
          const engagementType = body.providerData?.linkedin?.engagementType
          if (!organizationUrn || !engagementType) {
            return apiError('ENGAGEMENT requires providerData.linkedin.{organizationUrn, engagementType}', 400)
          }
          const { createEngagementAudience } = await import('@/lib/ads/providers/linkedin/audiences')
          result = await createEngagementAudience({ accountUrn, accessToken, name: body.name, organizationUrn, engagementType })
          break
        }
        case 'APP': {
          return apiError(
            'LinkedIn does not support App audiences natively. ' +
            'Workaround: create a CUSTOMER_LIST seeded by your app analytics events, then create a LOOKALIKE from that list.',
            400,
          )
        }
        default:
          return apiError(`Unsupported LinkedIn audience type: ${(body as { type?: string }).type}`, 400)
      }
    } catch (err) {
      return apiError(`LinkedIn audience create failed: ${(err as Error).message}`, 500)
    }

    const ca = await createCustomAudience({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      platform: 'linkedin',
      input: {
        name: body.name,
        description: body.description ?? '',
        type: body.type,
        status: 'BUILDING',
        source: { kind: 'CUSTOMER_LIST', csvStoragePath: '', hashCount: 0, uploadedAt: Timestamp.now() },
      } as CreateAdCustomAudienceInput,
    })

    const linkedinProviderData = {
      dmpSegmentUrn: result.urn,
      ...body.providerData?.linkedin,
    }
    await adminDb.collection('custom_audiences').doc(ca.id).update({
      providerData: { linkedin: linkedinProviderData },
    })
    const updated = await (await import('@/lib/ads/custom-audiences/store')).getCustomAudience(ca.id)
    return apiSuccess(updated, 201)
  }

  // ─── TikTok branch ───────────────────────────────────────────────────────
  if (rawBody.platform === 'tiktok') {
    const body = rawBody as {
      platform: 'tiktok'
      name?: string
      description?: string
      type?: 'CUSTOMER_LIST' | 'WEBSITE' | 'LOOKALIKE' | 'APP' | 'ENGAGEMENT'
      providerData?: {
        tiktok?: {
          sourceCustomAudienceId?: string
          locationIds?: number[]
          lookalikeSpec?: 'BALANCE' | 'EXPAND' | 'PRECISION'
        }
      }
    }

    if (!body.name) return apiError('name is required', 400)
    if (!body.type) return apiError('type is required', 400)

    const conn = await getConnection({ orgId, platform: 'tiktok' })
    if (!conn) return apiError('No TikTok ads connection for org', 400)
    const accessToken = decryptAccessToken(conn)
    const tiktokMeta = ((conn.meta ?? {}) as Record<string, unknown>).tiktok as
      | Record<string, unknown>
      | undefined
    const advertiserId =
      typeof tiktokMeta?.selectedAdvertiserId === 'string'
        ? tiktokMeta.selectedAdvertiserId
        : undefined
    if (!advertiserId) return apiError('No advertiserId set on TikTok connection', 400)

    let result: { customAudienceId: string }
    try {
      if (body.type === 'LOOKALIKE') {
        const source = body.providerData?.tiktok?.sourceCustomAudienceId
        const locationIds = body.providerData?.tiktok?.locationIds
        if (!source || !Array.isArray(locationIds) || locationIds.length === 0) {
          return apiError(
            'LOOKALIKE requires providerData.tiktok.{sourceCustomAudienceId, locationIds[]}',
            400,
          )
        }
        const { createLookalikeAudience } = await import(
          '@/lib/ads/providers/tiktok/audiences'
        )
        result = await createLookalikeAudience({
          advertiserId,
          accessToken,
          name: body.name,
          sourceCustomAudienceId: source,
          locationIds,
          lookalikeSpec: body.providerData?.tiktok?.lookalikeSpec,
        })
      } else {
        const audienceType =
          body.type === 'CUSTOMER_LIST'
            ? 'CUSTOMER_FILE'
            : body.type === 'APP'
              ? 'APP_ACTIVITY'
              : 'ENGAGEMENT' // WEBSITE + ENGAGEMENT both map to ENGAGEMENT
        const { createAudience } = await import('@/lib/ads/providers/tiktok/audiences')
        result = await createAudience({
          advertiserId,
          accessToken,
          name: body.name,
          audienceType: audienceType as 'CUSTOMER_FILE' | 'ENGAGEMENT' | 'APP_ACTIVITY',
          description: body.description,
        })
      }
    } catch (err) {
      return apiError(`TikTok audience create failed: ${(err as Error).message}`, 500)
    }

    const ca = await createCustomAudience({
      orgId,
      createdBy: (user as { uid?: string }).uid ?? 'unknown',
      platform: 'tiktok',
      input: {
        name: body.name,
        description: body.description ?? '',
        type: body.type,
        status: 'BUILDING',
        source: {
          kind: 'CUSTOMER_LIST',
          csvStoragePath: '',
          hashCount: 0,
          uploadedAt: Timestamp.now(),
        },
      } as CreateAdCustomAudienceInput,
    })
    await adminDb.collection('custom_audiences').doc(ca.id).update({
      providerData: {
        tiktok: {
          customAudienceId: result.customAudienceId,
          ...body.providerData?.tiktok,
        },
      },
    })
    const updated = await (
      await import('@/lib/ads/custom-audiences/store')
    ).getCustomAudience(ca.id)
    return apiSuccess(updated, 201)
  }

  // ─── Meta branch (existing, unchanged) ────────────────────────────────────
  const ctx = await requireMetaContext(req)
  if (ctx instanceof Response) return ctx
  const body = rawBody as { input?: CreateAdCustomAudienceInput & { approvalCampaignId?: string } }
  const { approvalCampaignId: _approvalCampaignId, ...audienceInput } = body.input ?? {}
  if (!audienceInput.name || !audienceInput.type || !audienceInput.source) {
    return apiError('Missing required fields: name, type, source', 400)
  }

  // Phase 4: local create first (with status BUILDING for upload-pending types)
  const initialStatus: AdCustomAudienceStatus = 'BUILDING'
  const ca = await createCustomAudience({
    orgId: ctx.orgId,
    createdBy: (user as { uid?: string }).uid ?? 'unknown',
    platform: 'meta',
    input: { ...audienceInput, status: initialStatus } as CreateAdCustomAudienceInput,
  })

  // Meta sync (non-CUSTOMER_LIST creates immediately; CUSTOMER_LIST needs upload step)
  try {
    const result = await metaProvider.customAudienceCRUD!({
      op: 'create',
      accessToken: ctx.accessToken,
      adAccountId: ctx.adAccountId,
      ca,
    })
    const metaCaId = (result as { metaCaId: string }).metaCaId
    await setCustomAudienceMetaId(ca.id, metaCaId)
    const updated = await (await import('@/lib/ads/custom-audiences/store')).getCustomAudience(ca.id)

    const actor = {
      id: (user as { uid?: string }).uid ?? 'unknown',
      name: (user as { email?: string }).email ?? 'Admin',
      role: 'admin' as const,
    }
    await logCustomAudienceActivity({
      orgId: ctx.orgId,
      actor,
      action: 'created',
      audienceId: ca.id,
      audienceName: ca.name,
      audienceType: ca.type,
    })

    return apiSuccess(updated, 201)
  } catch (err) {
    // Local doc still exists; surface the Meta error
    return apiError(`Meta sync failed: ${(err as Error).message}`, 500)
  }
})

/** Map Google audience subtype to canonical AdCustomAudienceType. */
function subtypeToCanonicalType(subtype: string): AdCustomAudienceType {
  switch (subtype) {
    case 'CUSTOMER_MATCH': return 'CUSTOMER_LIST'
    case 'REMARKETING': return 'WEBSITE'
    case 'CUSTOM_SEGMENT': return 'ENGAGEMENT'
    case 'AFFINITY':
    case 'IN_MARKET':
    case 'DETAILED_DEMOGRAPHICS':
    default:
      return 'APP'
  }
}
