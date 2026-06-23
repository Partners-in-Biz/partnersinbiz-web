import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { parseRange, rangeIsValid, fetchEvents } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'
import type { EventRow } from '@/lib/analytics/query'

export const dynamic = 'force-dynamic'

// Event names treated as clicks / scroll-depth, in priority order. Raw pixel
// coordinates are NOT captured by the SDK, so we aggregate by element/selector
// (the closest real equivalent) and report scroll-depth from depth properties.
const CLICK_EVENTS = ['$click', '$autocapture', 'click', 'element_click']
const SCROLL_EVENTS = ['$scroll', 'scroll_depth', 'scroll']

function matchUrl(e: EventRow, urlFilter: string | null): boolean {
  if (!urlFilter) return true
  const url = e.pageUrl ?? (e.properties?.['$current_url'] as string) ?? ''
  try { return new URL(url).pathname === urlFilter || url.includes(urlFilter) } catch { return url.includes(urlFilter) }
}

function selectorOf(e: EventRow): string {
  const p = e.properties ?? {}
  return (
    (p.selector as string) ??
    (p.element as string) ??
    (p['$el_selector'] as string) ??
    (p['$element_text'] as string) ??
    (p.text as string) ??
    (p.target as string) ??
    '(unknown element)'
  ).toString().slice(0, 120)
}

function scrollDepthOf(e: EventRow): number | null {
  const p = e.properties ?? {}
  const raw = p.depth ?? p.scrollDepth ?? p['$scroll_depth'] ?? p.percent
  const n = Number(raw)
  if (isNaN(n)) return null
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n))
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)
  const urlFilter = searchParams.get('url')
  const deviceFilter = searchParams.get('device') // mobile | desktop | tablet | null

  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const all = await fetchEvents(property.id, range)

    const filtered = all.filter(e =>
      matchUrl(e, urlFilter) && (!deviceFilter || e.device === deviceFilter),
    )

    // Distinct page URLs available (for the URL selector dropdown).
    const urls = new Map<string, number>()
    for (const e of all) {
      if (e.event !== '$pageview') continue
      const url = e.pageUrl ?? (e.properties?.['$current_url'] as string) ?? ''
      if (!url) continue
      let path = url
      try { path = new URL(url).pathname } catch { /* keep raw */ }
      urls.set(path, (urls.get(path) ?? 0) + 1)
    }

    // Click aggregation by element/selector.
    const clickEvents = filtered.filter(e => CLICK_EVENTS.includes(e.event))
    const clickMap = new Map<string, number>()
    for (const e of clickEvents) {
      const sel = selectorOf(e)
      clickMap.set(sel, (clickMap.get(sel) ?? 0) + 1)
    }
    const clicks = [...clickMap.entries()]
      .map(([selector, count]) => ({ selector, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)

    // Scroll-depth buckets (0-25, 25-50, 50-75, 75-100).
    const scrollEvents = filtered.filter(e => SCROLL_EVENTS.includes(e.event))
    const scrollBuckets = [
      { band: '0-25%', count: 0 },
      { band: '25-50%', count: 0 },
      { band: '50-75%', count: 0 },
      { band: '75-100%', count: 0 },
    ]
    let scrollSamples = 0
    for (const e of scrollEvents) {
      const d = scrollDepthOf(e)
      if (d === null) continue
      scrollSamples++
      const idx = Math.min(3, Math.floor(d / 25))
      scrollBuckets[idx].count++
    }

    return apiSuccess({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      // honest labelling — coords not captured
      mode: 'element-aggregation',
      note: 'Raw click coordinates are not captured by the SDK; clicks are aggregated by element/selector. Scroll depth is derived from scroll-event depth properties.',
      urls: [...urls.entries()].map(([url, views]) => ({ url, views })).sort((a, b) => b.views - a.views),
      clicks,
      clickTotal: clickEvents.length,
      scrollBuckets,
      scrollSamples,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-heatmaps]', e)
    return apiError('Failed to compute heatmap', 500)
  }
})
