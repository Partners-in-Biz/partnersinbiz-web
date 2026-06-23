/**
 * Branded SEO report builder (US-122).
 *
 * Assembles a `SeoReportData` payload for a sprint over a date range by reusing
 * the dashboard aggregation (traffic, rankings) and the backlink profile
 * (referring domains, new-this-month, DA). Traffic within the date range is
 * recomputed from per-keyword position history so the range selector is real.
 *
 * Server-only (Firestore). Consumed by the report API + share PDF route.
 */
import { adminDb } from '@/lib/firebase/admin'
import { buildSeoDashboard } from '@/lib/seo/dashboard'
import { buildBacklinkProfile } from '@/lib/seo/backlink-profile'
import type { SeoReportData } from '@/lib/seo/pdf/SeoReport'
import type { SeoKeyword } from './types'

export interface ReportConfig {
  clientName: string
  brandColor?: string
  logoDataUrl?: string
  from: string
  to: string
  sections: { traffic: boolean; rankings: boolean; backlinks: boolean }
}

function withinRange(iso: string, from: number, to: number): boolean {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && t >= from && t <= to
}

export async function buildReportData(sprintId: string, config: ReportConfig): Promise<SeoReportData> {
  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  const sprint = (sprintSnap.data() ?? {}) as { orgId?: string; siteUrl?: string; siteName?: string }

  const [dashboard, backlinkProfile, kwSnap] = await Promise.all([
    buildSeoDashboard(sprint.orgId ?? '', sprintId, sprint.siteUrl ?? ''),
    buildBacklinkProfile(sprintId),
    adminDb.collection('seo_keywords').where('sprintId', '==', sprintId).where('deleted', '==', false).get(),
  ])

  const keywords = kwSnap.docs.map((d) => d.data() as SeoKeyword)
  const fromMs = new Date(config.from).getTime()
  const toMs = new Date(config.to).getTime() + 24 * 60 * 60 * 1000 - 1

  // Range-scoped traffic from position history
  let impressions = 0
  let clicks = 0
  let posWeighted = 0
  let posWeight = 0
  const kwAgg = new Map<string, { keyword: string; impressions: number; clicks: number; posWeighted: number; posWeight: number; lastPos: number | null }>()

  for (const k of keywords) {
    let kImp = 0
    let kClicks = 0
    let kPosW = 0
    let kPosWeight = 0
    let lastPos: number | null = null
    for (const p of k.positions ?? []) {
      if (!withinRange(p.pulledAt, fromMs, toMs)) continue
      const imp = Number(p.impressions ?? 0)
      const w = imp > 0 ? imp : 1
      kImp += imp
      kClicks += Number(p.clicks ?? 0)
      kPosW += p.position * w
      kPosWeight += w
      lastPos = p.position
    }
    if (kPosWeight === 0 && (k.positions ?? []).length === 0) {
      // no history in range — fall back to current snapshot if present
      kImp = Number(k.currentImpressions ?? 0)
      kClicks = Number(k.currentClicks ?? 0)
      if (typeof k.currentPosition === 'number') { lastPos = k.currentPosition; kPosW = k.currentPosition; kPosWeight = 1 }
    }
    impressions += kImp
    clicks += kClicks
    posWeighted += kPosW
    posWeight += kPosWeight
    kwAgg.set(k.id, { keyword: k.keyword, impressions: kImp, clicks: kClicks, posWeighted: kPosW, posWeight: kPosWeight, lastPos })
  }

  const avgPosition = posWeight > 0 ? Number((posWeighted / posWeight).toFixed(1)) : dashboard.totals.avgPosition
  const ctr = impressions > 0 ? clicks / impressions : 0

  const topKeywords = Array.from(kwAgg.values())
    .map((k) => ({
      keyword: k.keyword,
      position: k.posWeight > 0 ? Number((k.posWeighted / k.posWeight).toFixed(1)) : k.lastPos,
      impressions: k.impressions,
      clicks: k.clicks,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 20)

  const topPages = dashboard.topPages.map((p) => ({
    url: p.url,
    impressions: p.impressions,
    clicks: p.clicks,
    avgPosition: p.avgPosition,
  }))

  return {
    clientName: config.clientName || sprint.siteName || sprint.siteUrl || 'Client',
    siteUrl: sprint.siteUrl ?? '',
    logoDataUrl: config.logoDataUrl,
    brandColor: config.brandColor,
    dateRange: { from: config.from, to: config.to },
    generatedAt: new Date().toISOString(),
    traffic: {
      impressions,
      clicks,
      ctr,
      avgPosition,
    },
    trafficDelta: dashboard.deltas,
    rankings: {
      tracked: dashboard.keywords.tracked,
      top3: dashboard.keywords.top3,
      top10: dashboard.keywords.top10,
      ranking: dashboard.keywords.ranking,
    },
    backlinks: {
      total: backlinkProfile.totals.backlinks,
      referringDomains: backlinkProfile.totals.referringDomains,
      newThisMonth: backlinkProfile.totals.newThisMonth,
      domainAuthority: dashboard.domainAuthority,
    },
    topKeywords,
    topPages,
    sections: config.sections,
  }
}
