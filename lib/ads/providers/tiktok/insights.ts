// lib/ads/providers/tiktok/insights.ts
// TikTok Marketing API /report/integrated/get/ client. Returns canonical TiktokDailyInsightRow[].
// Sub-3c Phase 5.

import { TIKTOK_ADS_API_BASE } from './constants'

export type TiktokInsightLevel = 'campaign' | 'adset' | 'ad'

export interface LevelMapping {
  dataLevel: 'AUCTION_CAMPAIGN' | 'AUCTION_ADGROUP' | 'AUCTION_AD'
  dimensionKey: 'campaign_id' | 'adgroup_id' | 'ad_id'
  filterField: 'campaign_ids' | 'adgroup_ids' | 'ad_ids'
}

export function levelMappingFor(level: TiktokInsightLevel): LevelMapping {
  switch (level) {
    case 'campaign': return { dataLevel: 'AUCTION_CAMPAIGN', dimensionKey: 'campaign_id', filterField: 'campaign_ids' }
    case 'adset': return { dataLevel: 'AUCTION_ADGROUP', dimensionKey: 'adgroup_id', filterField: 'adgroup_ids' }
    case 'ad': return { dataLevel: 'AUCTION_AD', dimensionKey: 'ad_id', filterField: 'ad_ids' }
  }
}

export interface TiktokDailyInsightRow {
  /** ISO date YYYY-MM-DD */
  date: string
  /** TikTok-side entity id (campaign_id / adgroup_id / ad_id) */
  entityId: string
  impressions: number
  clicks: number
  /** Spend in major currency units (float) */
  spendMajor: number
  /** Spend in cents-integer for canonical metric rows */
  spendCents: number
  /** ISO 4217 currency code from caller */
  currencyCode: string
  conversions: number
  cpc: number
  cpm: number
  ctr: number
  reach: number
}

/** Build the full /report/integrated/get/ URL for a single page request. */
export function buildInsightsUrl(args: {
  advertiserId: string
  level: TiktokInsightLevel
  ids: string[]
  startIso: string
  endIso: string
  page?: number
  pageSize?: number
  metrics?: string[]
}): string {
  const mapping = levelMappingFor(args.level)
  const u = new URL(`${TIKTOK_ADS_API_BASE}/report/integrated/get/`)
  u.searchParams.set('advertiser_id', args.advertiserId)
  u.searchParams.set('report_type', 'BASIC')
  u.searchParams.set('data_level', mapping.dataLevel)
  u.searchParams.set('dimensions', JSON.stringify([mapping.dimensionKey, 'stat_time_day']))
  u.searchParams.set(
    'metrics',
    JSON.stringify(
      args.metrics ?? ['impressions', 'clicks', 'spend', 'conversion', 'cpc', 'cpm', 'ctr', 'reach'],
    ),
  )
  u.searchParams.set('start_date', args.startIso)
  u.searchParams.set('end_date', args.endIso)
  u.searchParams.set('page', String(args.page ?? 1))
  u.searchParams.set('page_size', String(args.pageSize ?? 100))

  if (args.ids.length > 0) {
    u.searchParams.set(
      'filters',
      JSON.stringify([
        {
          field_name: mapping.filterField,
          filter_type: 'IN',
          filter_value: JSON.stringify(args.ids),
        },
      ]),
    )
  }

  return u.toString()
}

interface TiktokEnvelope<T> {
  code: number
  message: string
  data: T
}

/** Parse a single list element from the TikTok report response. */
export function parseInsightElement(
  el: Record<string, unknown>,
  currencyCode: string,
  dimensionKey: string,
): TiktokDailyInsightRow | null {
  const dims = el.dimensions as Record<string, unknown> | undefined
  const metrics = el.metrics as Record<string, unknown> | undefined
  if (!dims || !metrics) return null

  // TikTok returns stat_time_day as "YYYY-MM-DD HH:MM:SS" — slice to date portion
  const date = String(dims.stat_time_day ?? '').slice(0, 10)
  const entityId = String(dims[dimensionKey] ?? '')
  if (!date || !entityId) return null

  const spendMajor = parseFloat(String(metrics.spend ?? '0'))
  const safeMajor = Number.isFinite(spendMajor) ? spendMajor : 0

  return {
    date,
    entityId,
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    spendMajor: safeMajor,
    spendCents: Math.round(safeMajor * 100),
    currencyCode,
    conversions: Number(metrics.conversion ?? 0),
    cpc: parseFloat(String(metrics.cpc ?? '0')) || 0,
    cpm: parseFloat(String(metrics.cpm ?? '0')) || 0,
    ctr: parseFloat(String(metrics.ctr ?? '0')) || 0,
    reach: Number(metrics.reach ?? 0),
  }
}

/**
 * Pull daily insights from TikTok /report/integrated/get/.
 *
 * Phase 5 baseline: single-page (page_size=100). If the API returns more rows
 * than page_size the remaining pages are not fetched — a warning is logged.
 * Pagination support can be added in a future phase.
 */
export async function pullInsights(args: {
  advertiserId: string
  accessToken: string
  level: TiktokInsightLevel
  /** TikTok-side entity IDs to filter by (campaign_id / adgroup_id / ad_id). */
  ids: string[]
  /** Inclusive ISO date range YYYY-MM-DD */
  dateRange: { start: string; end: string }
  /** ISO 4217 currency code from the connected ad account. */
  currencyCode: string
  /** Inject fetch for testing */
  fetchImpl?: typeof fetch
}): Promise<TiktokDailyInsightRow[]> {
  if (args.ids.length === 0) return []

  const pageSize = 100
  const url = buildInsightsUrl({
    advertiserId: args.advertiserId,
    level: args.level,
    ids: args.ids,
    startIso: args.dateRange.start,
    endIso: args.dateRange.end,
    pageSize,
  })

  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: { 'Access-Token': args.accessToken },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TikTok adAnalytics HTTP ${res.status} — ${text.slice(0, 200)}`)
  }

  const env = (await res.json()) as TiktokEnvelope<{
    list?: Array<Record<string, unknown>>
    page_info?: { total_number?: number }
  }>

  if (env.code !== 0) {
    throw new Error(`TikTok adAnalytics code=${env.code} message=${env.message}`)
  }

  const totalNumber = env.data.page_info?.total_number ?? 0
  if (totalNumber > pageSize) {
    console.warn(
      `[tiktok/insights] pullInsights: total_number=${totalNumber} exceeds page_size=${pageSize}. ` +
      `Only first ${pageSize} rows returned. Implement pagination for full coverage.`,
    )
  }

  const mapping = levelMappingFor(args.level)
  return (env.data.list ?? [])
    .map((el) => parseInsightElement(el, args.currencyCode, mapping.dimensionKey))
    .filter((r): r is TiktokDailyInsightRow => r !== null)
}
