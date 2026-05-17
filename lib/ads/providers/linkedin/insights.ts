// lib/ads/providers/linkedin/insights.ts
// LinkedIn /rest/adAnalytics client. Returns canonical LinkedinDailyInsightRow[].
// Sub-3b Phase 4 Batch 1.

import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'
import { urnId } from './urn'

export type LinkedinInsightLevel = 'campaign' | 'adset' | 'ad'

/**
 * Maps canonical insight level to LinkedIn pivot enum + URN-list query param name.
 * - 'campaign' (PiB AdCampaign = LI Campaign Group) → pivot=CAMPAIGN_GROUP, param=campaignGroups
 * - 'adset' (PiB AdSet = LI Campaign) → pivot=CAMPAIGN, param=campaigns
 * - 'ad' (PiB Ad = LI Creative) → pivot=CREATIVE, param=creatives
 */
export interface LevelMapping {
  pivot: 'CAMPAIGN_GROUP' | 'CAMPAIGN' | 'CREATIVE'
  urnListParam: 'campaignGroups' | 'campaigns' | 'creatives'
}

export function levelMappingFor(level: LinkedinInsightLevel): LevelMapping {
  switch (level) {
    case 'campaign': return { pivot: 'CAMPAIGN_GROUP', urnListParam: 'campaignGroups' }
    case 'adset': return { pivot: 'CAMPAIGN', urnListParam: 'campaigns' }
    case 'ad': return { pivot: 'CREATIVE', urnListParam: 'creatives' }
  }
}

export interface LinkedinDailyInsightRow {
  /** ISO date YYYY-MM-DD */
  date: string
  /** Full LinkedIn URN of the entity */
  entityUrn: string
  /** Numeric id extracted from URN */
  entityId: string
  /** Canonical metrics */
  impressions: number
  clicks: number
  /** Spend in major currency (decimal string parsed) */
  spendMajor: number
  /** Spend in cents-integer for canonical metric rows */
  spendCents: number
  /** Currency code from caller (we don't get currency from the API response — caller passes account currency) */
  currencyCode: string
  conversions: number  // externalWebsiteConversions
  leads: number        // oneClickLeads
  landingPageClicks: number
  videoViews: number
  conversionValueMajor: number
}

/** Generate inclusive list of YYYY-MM-DD dates between start and end (UTC). */
export function expandDateRange(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const start = new Date(`${startIso}T00:00:00Z`).getTime()
  const end = new Date(`${endIso}T00:00:00Z`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out
  const dayMs = 24 * 60 * 60 * 1000
  for (let t = start; t <= end; t += dayMs) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** Chunk an ISO-date range into ≤ chunkDays slices. */
export function chunkDateRange(
  startIso: string,
  endIso: string,
  chunkDays = 30,
): Array<{ start: string; end: string }> {
  const all = expandDateRange(startIso, endIso)
  const chunks: Array<{ start: string; end: string }> = []
  for (let i = 0; i < all.length; i += chunkDays) {
    const slice = all.slice(i, i + chunkDays)
    chunks.push({ start: slice[0], end: slice[slice.length - 1] })
  }
  return chunks
}

/** Build the /rest/adAnalytics URL for a single chunk. Returns absolute URL string. */
export function buildInsightsUrl(args: {
  level: LinkedinInsightLevel
  ids: string[]  // entity URNs
  startIso: string
  endIso: string
  /** Optional list of additional fields to request (Phase 4 default set is built-in). */
  fields?: string[]
  version?: string
}): string {
  const mapping = levelMappingFor(args.level)
  const u = new URL(`${LINKEDIN_ADS_API_BASE}/adAnalytics`)
  u.searchParams.set('q', 'analytics')
  u.searchParams.set('pivot', mapping.pivot)
  u.searchParams.set('timeGranularity', 'DAILY')

  const start = new Date(`${args.startIso}T00:00:00Z`)
  const end = new Date(`${args.endIso}T00:00:00Z`)
  u.searchParams.set('dateRange.start.day', String(start.getUTCDate()))
  u.searchParams.set('dateRange.start.month', String(start.getUTCMonth() + 1))
  u.searchParams.set('dateRange.start.year', String(start.getUTCFullYear()))
  u.searchParams.set('dateRange.end.day', String(end.getUTCDate()))
  u.searchParams.set('dateRange.end.month', String(end.getUTCMonth() + 1))
  u.searchParams.set('dateRange.end.year', String(end.getUTCFullYear()))

  const defaultFields = [
    'impressions', 'clicks', 'costInLocalCurrency',
    'oneClickLeads', 'landingPageClicks', 'videoViews',
    'externalWebsiteConversions', 'conversionValueInLocalCurrency',
    'pivotValues',
  ]
  u.searchParams.set('fields', (args.fields ?? defaultFields).join(','))

  // URN list: LinkedIn REST.li 2.0 format: campaignGroups=List(urn:li:...,urn:li:...)
  // NOTE: do NOT URL-encode the colons in the URN — LinkedIn parses the raw value.
  // URL constructor will encode but LinkedIn's parser tolerates encoded URNs.
  const listValue = `List(${args.ids.join(',')})`
  u.searchParams.set(mapping.urnListParam, listValue)

  return u.toString()
}

/** Parse a single /adAnalytics element into a LinkedinDailyInsightRow. */
export function parseInsightElement(
  el: Record<string, unknown>,
  currencyCode: string,
): LinkedinDailyInsightRow | null {
  const dateRange = el.dateRange as {
    start?: { day: number; month: number; year: number }
    end?: { day: number; month: number; year: number }
  } | undefined
  if (!dateRange?.start) return null
  const dStart = dateRange.start
  const iso = `${dStart.year.toString().padStart(4, '0')}-${String(dStart.month).padStart(2, '0')}-${String(dStart.day).padStart(2, '0')}`
  const pivotValues = el.pivotValues as string[] | undefined
  const entityUrn = pivotValues?.[0] ?? ''
  let entityId = ''
  if (entityUrn) {
    try {
      entityId = urnId(entityUrn)
    } catch {
      entityId = entityUrn.split(':').pop() ?? ''
    }
  }

  const spendMajorRaw = el.costInLocalCurrency
  const spendMajor = typeof spendMajorRaw === 'string'
    ? parseFloat(spendMajorRaw)
    : (typeof spendMajorRaw === 'number' ? spendMajorRaw : 0)
  const conversionValueRaw = el.conversionValueInLocalCurrency
  const conversionValueMajor = typeof conversionValueRaw === 'string'
    ? parseFloat(conversionValueRaw)
    : (typeof conversionValueRaw === 'number' ? conversionValueRaw : 0)

  return {
    date: iso,
    entityUrn,
    entityId,
    impressions: Number(el.impressions ?? 0),
    clicks: Number(el.clicks ?? 0),
    spendMajor,
    spendCents: Math.round(spendMajor * 100),
    currencyCode,
    conversions: Number(el.externalWebsiteConversions ?? 0),
    leads: Number(el.oneClickLeads ?? 0),
    landingPageClicks: Number(el.landingPageClicks ?? 0),
    videoViews: Number(el.videoViews ?? 0),
    conversionValueMajor,
  }
}

/** Fetch insights for a single chunk. */
async function fetchChunk(args: {
  level: LinkedinInsightLevel
  ids: string[]
  startIso: string
  endIso: string
  accessToken: string
  currencyCode: string
  version?: string
  fetchImpl?: typeof fetch
}): Promise<LinkedinDailyInsightRow[]> {
  const url = buildInsightsUrl({
    level: args.level,
    ids: args.ids,
    startIso: args.startIso,
    endIso: args.endIso,
    version: args.version,
  })
  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'LinkedIn-Version': args.version ?? LINKEDIN_ADS_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LinkedIn adAnalytics failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { elements?: Array<Record<string, unknown>> }
  return (data.elements ?? [])
    .map((e) => parseInsightElement(e, args.currencyCode))
    .filter((r): r is LinkedinDailyInsightRow => r !== null)
}

/** Top-level pull — chunks long date ranges + concatenates results. */
export async function pullInsights(args: {
  level: LinkedinInsightLevel
  /** Entity URNs to query (canonical URNs from providerData.linkedin.*) */
  ids: string[]
  /** Inclusive ISO date range YYYY-MM-DD */
  dateRange: { start: string; end: string }
  accessToken: string
  /** Currency code from the account (caller knows; we don't get it in the response). */
  currencyCode: string
  /** Override version header */
  version?: string
  /** Days per chunk (default 30) */
  chunkDays?: number
  /** Inject fetch for testing */
  fetchImpl?: typeof fetch
}): Promise<LinkedinDailyInsightRow[]> {
  if (args.ids.length === 0) return []
  const chunks = chunkDateRange(args.dateRange.start, args.dateRange.end, args.chunkDays ?? 30)
  if (chunks.length === 0) return []

  const out: LinkedinDailyInsightRow[] = []
  for (const ch of chunks) {
    const rows = await fetchChunk({
      level: args.level,
      ids: args.ids,
      startIso: ch.start,
      endIso: ch.end,
      accessToken: args.accessToken,
      currencyCode: args.currencyCode,
      version: args.version,
      fetchImpl: args.fetchImpl,
    })
    out.push(...rows)
  }
  return out
}
