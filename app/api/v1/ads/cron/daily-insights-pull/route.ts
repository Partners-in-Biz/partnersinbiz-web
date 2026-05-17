// app/api/v1/ads/cron/daily-insights-pull/route.ts
import { NextRequest } from 'next/server'
import { listConnections, decryptAccessToken } from '@/lib/ads/connections/store'
import { listCampaigns } from '@/lib/ads/campaigns/store'
import { listAdSets } from '@/lib/ads/adsets/store'
import { listAds } from '@/lib/ads/ads/store'
import { refreshEntityInsights } from '@/lib/ads/insights/refresh'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { AdConnection } from '@/lib/ads/types'

export async function POST(req: NextRequest) {
  // Vercel Cron sends CRON_SECRET in the Authorization header
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return apiError('Unauthorized', 401)
  }

  const { adminDb } = await import('@/lib/firebase/admin')

  let totalProcessed = 0
  let totalFailed = 0
  const errors: string[] = []

  // ── Meta: walk all active Meta connections ────────────────────────────────
  const metaConnsSnap = await adminDb
    .collection('ad_connections')
    .where('platform', '==', 'meta')
    .where('status', '==', 'active')
    .get()

  for (const connDoc of metaConnsSnap.docs) {
    const conn = connDoc.data() as { orgId: string }
    try {
      const allConns = await listConnections({ orgId: conn.orgId })
      const meta = allConns.find((c) => c.platform === 'meta')
      if (!meta) continue
      const accessToken = decryptAccessToken(meta)

      // List entities at all 3 levels with ACTIVE or PAUSED status
      const [campaigns, adSets, ads] = await Promise.all([
        listCampaigns({ orgId: conn.orgId }),
        listAdSets({ orgId: conn.orgId }),
        listAds({ orgId: conn.orgId }),
      ])

      type MetaTarget = {
        metaObjectId: string
        level: 'campaign' | 'adset' | 'ad'
        pibEntityId: string
      }
      const targets: MetaTarget[] = []

      for (const c of campaigns) {
        const metaId = (c.providerData?.meta as { id?: string } | undefined)?.id
        if (metaId && (c.status === 'ACTIVE' || c.status === 'PAUSED')) {
          targets.push({ metaObjectId: metaId, level: 'campaign', pibEntityId: c.id })
        }
      }
      for (const s of adSets) {
        const metaId = (s.providerData?.meta as { id?: string } | undefined)?.id
        if (metaId && (s.status === 'ACTIVE' || s.status === 'PAUSED')) {
          targets.push({ metaObjectId: metaId, level: 'adset', pibEntityId: s.id })
        }
      }
      for (const a of ads) {
        const metaId = (a.providerData?.meta as { id?: string } | undefined)?.id
        if (metaId && (a.status === 'ACTIVE' || a.status === 'PAUSED')) {
          targets.push({ metaObjectId: metaId, level: 'ad', pibEntityId: a.id })
        }
      }

      for (const t of targets) {
        try {
          await refreshEntityInsights({
            platform: 'meta',
            orgId: conn.orgId,
            accessToken,
            ...t,
            daysBack: 2, // daily cron covers yesterday + today
          })
          totalProcessed++
        } catch (err) {
          totalFailed++
          errors.push(
            `${conn.orgId}/${t.level}/${t.pibEntityId}: ${(err as Error).message}`,
          )
        }
      }
    } catch (err) {
      errors.push(`Meta org ${conn.orgId} setup: ${(err as Error).message}`)
    }
  }

  // ── Google: walk all active Google connections ────────────────────────────
  const googleConnsSnap = await adminDb
    .collection('ad_connections')
    .where('platform', '==', 'google')
    .where('status', '==', 'active')
    .get()

  for (const connDoc of googleConnsSnap.docs) {
    const connRaw = connDoc.data() as AdConnection
    const orgId = connRaw.orgId
    try {
      const allConns = await listConnections({ orgId })
      const google = allConns.find((c) => c.platform === 'google')
      if (!google) continue

      const accessToken = decryptAccessToken(google)
      // customerId is stored in defaultAdAccountId (numeric, no dashes)
      const customerId = google.defaultAdAccountId
      if (!customerId) {
        errors.push(`Google org ${orgId}: no defaultAdAccountId — skipping`)
        continue
      }
      // MCC login-customer-id from connection meta
      const loginCustomerId = (
        (google.meta as { google?: { loginCustomerId?: string } } | undefined)?.google
          ?.loginCustomerId
      ) ?? undefined

      // List all Google entities (platform='google') at all 3 levels.
      // listAdSets/listAds do not expose a platform filter — filter client-side.
      const [campaigns, allAdSets, allAds] = await Promise.all([
        listCampaigns({ orgId, platform: 'google' }),
        listAdSets({ orgId }),
        listAds({ orgId }),
      ])
      const adSets = allAdSets.filter((s) => s.platform === 'google')
      const ads = allAds.filter((a) => a.platform === 'google')

      type GoogleTarget = {
        googleEntityId: string
        level: 'campaign' | 'ad_group' | 'ad'
        pibEntityId: string
      }
      const gTargets: GoogleTarget[] = []

      for (const c of campaigns) {
        const gId = (c.providerData?.meta as { id?: string } | undefined)?.id
          ?? (c.providerData as { google?: { id?: string } })?.google?.id
        if (gId && (c.status === 'ACTIVE' || c.status === 'PAUSED')) {
          gTargets.push({ googleEntityId: gId, level: 'campaign', pibEntityId: c.id })
        }
      }
      for (const s of adSets) {
        const gId = (s.providerData as { google?: { id?: string } })?.google?.id
        if (gId && (s.status === 'ACTIVE' || s.status === 'PAUSED')) {
          gTargets.push({ googleEntityId: gId, level: 'ad_group', pibEntityId: s.id })
        }
      }
      for (const a of ads) {
        const gId = (a.providerData as { google?: { id?: string } })?.google?.id
        if (gId && (a.status === 'ACTIVE' || a.status === 'PAUSED')) {
          gTargets.push({ googleEntityId: gId, level: 'ad', pibEntityId: a.id })
        }
      }

      for (const t of gTargets) {
        try {
          await refreshEntityInsights({
            platform: 'google',
            orgId,
            accessToken,
            customerId,
            loginCustomerId,
            ...t,
            daysBack: 2,
          })
          totalProcessed++
        } catch (err) {
          totalFailed++
          errors.push(
            `Google ${orgId}/${t.level}/${t.pibEntityId}: ${(err as Error).message}`,
          )
        }
      }
    } catch (err) {
      errors.push(`Google org ${orgId} setup: ${(err as Error).message}`)
    }
  }

  // ── LinkedIn: walk all active LinkedIn connections ────────────────────────
  const linkedinConnsSnap = await adminDb
    .collection('ad_connections')
    .where('platform', '==', 'linkedin')
    .where('status', '==', 'active')
    .get()

  for (const connDoc of linkedinConnsSnap.docs) {
    const connRaw = connDoc.data() as AdConnection
    const orgId = connRaw.orgId
    try {
      const allConns = await listConnections({ orgId })
      const linkedin = allConns.find((c) => c.platform === 'linkedin')
      if (!linkedin) continue

      const accessToken = decryptAccessToken(linkedin)

      // Read currency from connection meta if stored (fall back to USD)
      const linkedinMeta = (
        (linkedin.meta as { linkedin?: { currencyCode?: string } } | undefined)?.linkedin
      )
      const currencyCode = linkedinMeta?.currencyCode ?? 'USD'

      // Fetch campaigns tagged as LinkedIn
      const campaigns = await listCampaigns({ orgId, platform: 'linkedin' })

      for (const campaign of campaigns.filter(
        (c) => c.status === 'ACTIVE' || c.status === 'PAUSED',
      )) {
        const linkedinData = (
          campaign.providerData as { linkedin?: { campaignGroupUrn?: string } } | undefined
        )?.linkedin
        const campaignGroupUrn = linkedinData?.campaignGroupUrn
        if (!campaignGroupUrn) continue

        try {
          await refreshEntityInsights({
            platform: 'linkedin',
            orgId,
            accessToken,
            pibEntityId: campaign.id,
            linkedinEntityUrn: campaignGroupUrn,
            level: 'campaign',
            currencyCode,
            daysBack: 2,
          })
          totalProcessed++
        } catch (err) {
          totalFailed++
          errors.push(
            `LinkedIn ${orgId}/campaign/${campaign.id}: ${(err as Error).message}`,
          )
        }
      }
    } catch (err) {
      errors.push(`LinkedIn org ${orgId} setup: ${(err as Error).message}`)
    }
  }

  return apiSuccess({
    processed: totalProcessed,
    failed: totalFailed,
    errors: errors.slice(0, 20),
  })
}
