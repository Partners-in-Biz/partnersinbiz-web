import { adminDb } from '@/lib/firebase/admin'
import { getPageRank } from '@/lib/seo/integrations/openpagerank'

export type DashboardTopPage = {
  url: string
  impressions: number
  clicks: number
  ctr: number
  avgPosition: number
}

export type DashboardTrendPoint = { date: string; impressions: number; clicks: number; avgPosition: number }

export type SeoDashboard = {
  orgId: string
  sprintId: string | null
  siteUrl: string
  totals: { impressions: number; clicks: number; avgPosition: number; ctr: number }
  deltas: { impressions: number; clicks: number; avgPosition: number } | null
  domainAuthority: number | null
  backlinks: { total: number; referringDomains: number }
  keywords: { tracked: number; top3: number; top10: number; ranking: number }
  trend: DashboardTrendPoint[]
  topPages: DashboardTopPage[]
  latestAudit: { id: string; capturedAt: string; snapshotDay: number } | null
  lastUpdatedAt: string | null
}

type KeywordDoc = {
  positions?: { pulledAt: string; position: number; impressions?: number; clicks?: number; ctr?: number }[]
  currentPosition?: number
  currentImpressions?: number
  currentClicks?: number
  targetPageUrl?: string
  status?: string
}

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Build a full SEO dashboard payload for a sprint by aggregating keyword
 * position history (GSC-sourced), backlinks, audits, and domain authority.
 *
 * The 90-day trend is reconstructed from the per-keyword `positions[]` arrays:
 * each pull contributes impressions/clicks; the position is impression-weighted.
 */
export async function buildSeoDashboard(orgId: string, sprintId: string | null, siteUrl: string): Promise<SeoDashboard> {
  if (!sprintId) {
    return {
      orgId, sprintId: null, siteUrl,
      totals: { impressions: 0, clicks: 0, avgPosition: 0, ctr: 0 },
      deltas: null, domainAuthority: null,
      backlinks: { total: 0, referringDomains: 0 },
      keywords: { tracked: 0, top3: 0, top10: 0, ranking: 0 },
      trend: [], topPages: [], latestAudit: null, lastUpdatedAt: null,
    }
  }

  const [kwSnap, blSnap, auditSnap] = await Promise.all([
    adminDb.collection('seo_keywords').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
    adminDb.collection('seo_backlinks').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
    adminDb.collection('seo_audits').where('sprintId', '==', sprintId).get(),
  ])

  const keywords = kwSnap.docs.map((d) => d.data() as KeywordDoc)

  // --- totals + keyword status counts ---
  let impressions = 0, clicks = 0, posSum = 0, posN = 0
  let top3 = 0, top10 = 0, ranking = 0
  for (const k of keywords) {
    impressions += Number(k.currentImpressions ?? 0)
    clicks += Number(k.currentClicks ?? 0)
    if (k.currentPosition) { posSum += k.currentPosition; posN++ }
    if (k.status === 'top_3') top3++
    if (k.status === 'top_3' || k.status === 'top_10') top10++
    if (k.status === 'ranking' || k.status === 'top_10' || k.status === 'top_3') ranking++
  }
  const avgPosition = posN > 0 ? posSum / posN : 0
  const ctr = impressions > 0 ? clicks / impressions : 0

  // --- 90-day trend from position history, bucketed by day ---
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  const buckets = new Map<string, { impressions: number; clicks: number; posWeighted: number; posWeight: number }>()
  for (const k of keywords) {
    for (const p of k.positions ?? []) {
      const t = new Date(p.pulledAt).getTime()
      if (!Number.isFinite(t) || t < cutoff) continue
      const day = p.pulledAt.slice(0, 10)
      const b = buckets.get(day) ?? { impressions: 0, clicks: 0, posWeighted: 0, posWeight: 0 }
      const imp = Number(p.impressions ?? 0)
      b.impressions += imp
      b.clicks += Number(p.clicks ?? 0)
      const w = imp > 0 ? imp : 1
      b.posWeighted += p.position * w
      b.posWeight += w
      buckets.set(day, b)
    }
  }
  const trend: DashboardTrendPoint[] = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({
      date,
      impressions: b.impressions,
      clicks: b.clicks,
      avgPosition: b.posWeight > 0 ? Number((b.posWeighted / b.posWeight).toFixed(1)) : 0,
    }))

  // --- deltas: latest bucket vs first bucket in window ---
  const deltas = trend.length >= 2
    ? {
        impressions: trend[trend.length - 1].impressions - trend[0].impressions,
        clicks: trend[trend.length - 1].clicks - trend[0].clicks,
        avgPosition: Number((trend[0].avgPosition - trend[trend.length - 1].avgPosition).toFixed(1)),
      }
    : null

  // --- top pages: aggregate keyword metrics by target page ---
  const pageMap = new Map<string, { impressions: number; clicks: number; posWeighted: number; posWeight: number }>()
  for (const k of keywords) {
    const url = k.targetPageUrl
    if (!url) continue
    const p = pageMap.get(url) ?? { impressions: 0, clicks: 0, posWeighted: 0, posWeight: 0 }
    const imp = Number(k.currentImpressions ?? 0)
    p.impressions += imp
    p.clicks += Number(k.currentClicks ?? 0)
    const w = imp > 0 ? imp : 1
    if (k.currentPosition) { p.posWeighted += k.currentPosition * w; p.posWeight += w }
    pageMap.set(url, p)
  }
  const topPages: DashboardTopPage[] = Array.from(pageMap.entries())
    .map(([url, p]) => ({
      url,
      impressions: p.impressions,
      clicks: p.clicks,
      ctr: p.impressions > 0 ? p.clicks / p.impressions : 0,
      avgPosition: p.posWeight > 0 ? Number((p.posWeighted / p.posWeight).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 10)

  // --- backlinks ---
  const blDocs = blSnap.docs.map((d) => d.data() as { domain?: string })
  const referringDomains = new Set(blDocs.map((b) => b.domain).filter(Boolean)).size

  // --- domain authority (OpenPageRank, best-effort) ---
  let domainAuthority: number | null = null
  if (siteUrl) {
    try {
      const ranks = await getPageRank([domainOf(siteUrl)])
      const v = Object.values(ranks)[0]
      domainAuthority = typeof v === 'number' ? Number(v.toFixed(1)) : null
    } catch {
      domainAuthority = null
    }
  }

  // --- latest audit ---
  const audits = auditSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { capturedAt?: string; snapshotDay?: number; deleted?: boolean }) }))
    .filter((a) => !a.deleted)
    .sort((a, b) => (b.snapshotDay ?? 0) - (a.snapshotDay ?? 0))
  const latestAudit = audits[0]
    ? { id: audits[0].id, capturedAt: audits[0].capturedAt ?? '', snapshotDay: audits[0].snapshotDay ?? 0 }
    : null

  return {
    orgId, sprintId, siteUrl,
    totals: { impressions, clicks, avgPosition: Number(avgPosition.toFixed(1)), ctr },
    deltas, domainAuthority,
    backlinks: { total: blDocs.length, referringDomains },
    keywords: { tracked: keywords.length, top3, top10, ranking },
    trend, topPages, latestAudit,
    lastUpdatedAt: trend.length ? trend[trend.length - 1].date : null,
  }
}
