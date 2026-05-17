// lib/ads/insights/refresh.ts
import { metaProvider } from '@/lib/ads/providers/meta'
import { fetchInsights as fetchGoogleInsights } from '@/lib/ads/providers/google/insights'
import { pullInsights as pullLinkedinInsights } from '@/lib/ads/providers/linkedin/insights'
import { readDeveloperToken } from '@/lib/integrations/google_ads/oauth'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { MetaInsightRow, InsightLevel } from '@/lib/ads/providers/meta/insights'
import type { DailyInsightRow, GoogleInsightsLevel } from '@/lib/ads/providers/google/insights'
import type { LinkedinInsightLevel, LinkedinDailyInsightRow } from '@/lib/ads/providers/linkedin/insights'

// ─── Shared arg types ─────────────────────────────────────────────────────────

interface RefreshArgsBase {
  orgId: string
  accessToken: string
  /** Local PiB ID — used as dimensionId in metrics rows. */
  pibEntityId: string
  /** Days back from today. Default 7. */
  daysBack?: number
}

export interface MetaRefreshArgs extends RefreshArgsBase {
  platform: 'meta'
  /** Meta-side object ID — campaign/adset/ad ID on the Meta graph. */
  metaObjectId: string
  level: InsightLevel
}

export interface GoogleRefreshArgs extends RefreshArgsBase {
  platform: 'google'
  /** Google Ads numeric entity ID (campaign id, ad group id, ad id). */
  googleEntityId: string
  /** Google Ads customer ID (without dashes). */
  customerId: string
  level: GoogleInsightsLevel
  /** MCC login-customer-id header, when applicable. */
  loginCustomerId?: string
}

export interface LinkedinRefreshArgs extends RefreshArgsBase {
  platform: 'linkedin'
  /** Entity URN to fetch insights for (campaign group URN, campaign URN, or creative URN). */
  linkedinEntityUrn: string
  level: LinkedinInsightLevel
  /** ISO 4217 currency from the connected ad account (used for canonical spend cents derivation). */
  currencyCode: string
}

/** Union — callers pass `platform` to select the provider path. */
export type RefreshArgs = MetaRefreshArgs | GoogleRefreshArgs | LinkedinRefreshArgs

/**
 * Legacy form kept for backward-compat with existing callers that do not pass `platform`.
 * Treated as `platform: 'meta'`.
 */
export interface LegacyRefreshArgs extends RefreshArgsBase {
  metaObjectId: string
  level: InsightLevel
  platform?: never
}

/** Pull insights for one entity, upsert metric rows, update lastRefreshedAt on the entity. */
export async function refreshEntityInsights(args: RefreshArgs | LegacyRefreshArgs): Promise<{
  rowsWritten: number
  daysProcessed: number
}> {
  const daysBack = args.daysBack ?? 7
  const today = new Date()
  const since = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000)
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = today.toISOString().slice(0, 10)

  // ── Platform dispatch ────────────────────────────────────────────────────
  if ((args as RefreshArgs).platform === 'linkedin') {
    return _refreshLinkedin(args as LinkedinRefreshArgs, sinceStr, untilStr)
  }

  if ((args as RefreshArgs).platform === 'google') {
    return _refreshGoogle(args as GoogleRefreshArgs, sinceStr, untilStr)
  }

  // Default: Meta (includes legacy callers that don't pass `platform`)
  return _refreshMeta(args as MetaRefreshArgs | LegacyRefreshArgs, sinceStr, untilStr)
}

// ─── Meta path (unchanged) ────────────────────────────────────────────────────

async function _refreshMeta(
  args: MetaRefreshArgs | LegacyRefreshArgs,
  sinceStr: string,
  untilStr: string,
): Promise<{ rowsWritten: number; daysProcessed: number }> {
  const { data } = (await metaProvider.listInsights!({
    metaObjectId: args.metaObjectId,
    accessToken: args.accessToken,
    since: sinceStr,
    until: untilStr,
    level: args.level,
  })) as { data: MetaInsightRow[] }

  let rowsWritten = 0
  const batch = adminDb.batch()

  for (const row of data) {
    const metrics = mapInsightRow(row)
    for (const [metric, value] of Object.entries(metrics)) {
      if (value == null) continue
      const docId = `meta_ads_${args.orgId}_${args.level}_${args.pibEntityId}_${row.date_start}_${metric}`
      const ref = adminDb.collection('metrics').doc(docId)
      batch.set(ref, {
        orgId: args.orgId,
        source: 'meta_ads',
        level: args.level,
        dimensionId: args.pibEntityId,
        date: row.date_start,
        metric,
        value,
        updatedAt: Timestamp.now(),
      })
      rowsWritten++
    }
  }

  await batch.commit()

  const collection =
    args.level === 'campaign' ? 'ad_campaigns' : args.level === 'adset' ? 'ad_sets' : 'ads'
  await adminDb.collection(collection).doc(args.pibEntityId).update({
    lastRefreshedAt: Timestamp.now(),
  })

  return { rowsWritten, daysProcessed: data.length }
}

// ─── Google path ──────────────────────────────────────────────────────────────

async function _refreshGoogle(
  args: GoogleRefreshArgs,
  sinceStr: string,
  untilStr: string,
): Promise<{ rowsWritten: number; daysProcessed: number }> {
  const developerToken = readDeveloperToken()
  if (!developerToken) {
    throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN not set — cannot refresh Google insights')
  }

  const rows: DailyInsightRow[] = await fetchGoogleInsights({
    customerId: args.customerId,
    accessToken: args.accessToken,
    developerToken,
    loginCustomerId: args.loginCustomerId,
    level: args.level,
    entityId: args.googleEntityId,
    dateRange: { startDate: sinceStr, endDate: untilStr },
  })

  let rowsWritten = 0
  const batch = adminDb.batch()

  for (const row of rows) {
    const metrics = mapGoogleInsightRow(row)
    for (const [metric, value] of Object.entries(metrics)) {
      if (value == null) continue
      const docId = `google_ads_${args.orgId}_${args.level}_${args.pibEntityId}_${row.date}_${metric}`
      const ref = adminDb.collection('metrics').doc(docId)
      batch.set(ref, {
        orgId: args.orgId,
        source: 'google_ads',
        level: args.level,
        dimensionId: args.pibEntityId,
        date: row.date,
        metric,
        value,
        updatedAt: Timestamp.now(),
      })
      rowsWritten++
    }
  }

  await batch.commit()

  // Map Google insight level to entity collection name
  const collection =
    args.level === 'campaign'
      ? 'ad_campaigns'
      : args.level === 'ad_group'
        ? 'ad_sets'
        : 'ads'
  await adminDb.collection(collection).doc(args.pibEntityId).update({
    lastRefreshedAt: Timestamp.now(),
  })

  return { rowsWritten, daysProcessed: rows.length }
}

// ─── LinkedIn path ────────────────────────────────────────────────────────────

async function _refreshLinkedin(
  args: LinkedinRefreshArgs,
  sinceStr: string,
  untilStr: string,
): Promise<{ rowsWritten: number; daysProcessed: number }> {
  const rows = await pullLinkedinInsights({
    accessToken: args.accessToken,
    level: args.level,
    ids: [args.linkedinEntityUrn],
    dateRange: { start: sinceStr, end: untilStr },
    currencyCode: args.currencyCode,
  })

  let rowsWritten = 0
  const batch = adminDb.batch()

  for (const row of rows) {
    const metrics = mapLinkedinInsightRow(row)
    for (const [metric, value] of Object.entries(metrics)) {
      if (value == null) continue
      const docId = `linkedin_ads_${args.orgId}_${args.level}_${args.pibEntityId}_${row.date}_${metric}`
      const ref = adminDb.collection('metrics').doc(docId)
      batch.set(ref, {
        orgId: args.orgId,
        source: 'linkedin_ads',
        level: args.level,
        dimensionId: args.pibEntityId,
        date: row.date,
        metric,
        value,
        updatedAt: Timestamp.now(),
      })
      rowsWritten++
    }
  }

  await batch.commit()

  const collection =
    args.level === 'campaign' ? 'ad_campaigns' : args.level === 'adset' ? 'ad_sets' : 'ads'
  await adminDb.collection(collection).doc(args.pibEntityId).update({
    lastRefreshedAt: Timestamp.now(),
  })

  return { rowsWritten, daysProcessed: rows.length }
}

/**
 * Map a LinkedIn daily insight row to canonical metric values.
 * Exported for testing.
 */
export function mapLinkedinInsightRow(row: LinkedinDailyInsightRow): Record<string, number | null | undefined> {
  return {
    impressions: row.impressions,
    clicks: row.clicks,
    spend_cents: row.spendCents,
    conversions: row.conversions,
    leads: row.leads,
    landing_page_clicks: row.landingPageClicks,
    video_views: row.videoViews,
    conversion_value_cents: Math.round(row.conversionValueMajor * 100),
  }
}

/**
 * Map a Google DailyInsightRow to canonical metric values.
 * Google does not return CPM — that field is omitted (not null) so callers that
 * write only non-null values will simply skip it.
 * Exported for testing.
 */
export function mapGoogleInsightRow(row: DailyInsightRow): Record<string, number | null> {
  return {
    ad_spend: row.ad_spend ?? null,
    impressions: row.impressions ?? null,
    clicks: row.clicks ?? null,
    ctr: row.ctr ?? null,
    cpc: row.cpc ?? null,
    conversions: row.conversions ?? null,
    conversions_value: row.conversions_value ?? null,
    roas: row.roas ?? null,
    // cpm is not returned by Google Ads searchStream — intentionally omitted
  }
}

/**
 * Map a Meta insights row to canonical metric values.
 * Exported for testing; not part of the public API of this module.
 */
export function mapInsightRow(row: MetaInsightRow): Record<string, number | null> {
  const out: Record<string, number | null> = {
    ad_spend: row.spend ? parseFloat(row.spend) : null,
    impressions: row.impressions ? parseInt(row.impressions, 10) : null,
    clicks: row.clicks ? parseInt(row.clicks, 10) : null,
    // Meta returns CTR as a percent string e.g. "1.234"; canonical is 0-1 fraction
    ctr: row.ctr ? parseFloat(row.ctr) / 100 : null,
    cpc: row.cpc ? parseFloat(row.cpc) : null,
    cpm: row.cpm ? parseFloat(row.cpm) : null,
  }

  // Conversions = sum of relevant action types
  const convActionTypes = ['purchase', 'lead', 'complete_registration', 'omni_purchase']
  const convActions = row.actions?.filter((a) => convActionTypes.includes(a.action_type))
  if (convActions && convActions.length > 0) {
    out.conversions = convActions.reduce((sum, a) => sum + parseFloat(a.value), 0)
  }

  // ROAS = total purchase/omni_purchase revenue / spend (only when both are present)
  const revenueActionTypes = ['purchase', 'omni_purchase']
  const convValues = row.action_values?.filter((a) => revenueActionTypes.includes(a.action_type))
  const conversionsRevenue = convValues?.reduce((sum, a) => sum + parseFloat(a.value), 0) ?? 0
  if (conversionsRevenue > 0 && out.ad_spend != null && out.ad_spend > 0) {
    out.roas = conversionsRevenue / out.ad_spend
  }

  return out
}
