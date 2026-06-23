import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  fetchEvents,
  fetchSessions,
  parseRange,
  rangeIsValid,
  dailyBuckets,
  dayLabel,
  countBy,
  isBounce,
  type EventRow,
  type SessionRow,
} from '@/lib/analytics/query'
import {
  requireAnalyticsProperty,
  analyticsPropertyErrorResponse,
} from '@/lib/analytics/property-access'
import type { SeoArticle } from '@/lib/content/types'
import { serializeArticle } from '../seo/serialize'

export const dynamic = 'force-dynamic'

const PAGEVIEW_EVENTS = new Set(['pageview', '$pageview', 'page_view'])

/** Normalize a pathname for slug matching: lowercase, trimmed, no trailing slash. */
function normPath(input: string | null | undefined): string {
  if (!input) return ''
  let p = input.trim().toLowerCase()
  // Strip query/hash if a full path slipped through.
  const q = p.indexOf('?')
  if (q >= 0) p = p.slice(0, q)
  const h = p.indexOf('#')
  if (h >= 0) p = p.slice(0, h)
  // Strip trailing slash (but keep root "/").
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p
}

/** Derive a pathname from an event: pageUrl, then properties.path / properties.url. */
function eventPath(ev: EventRow): string {
  const candidates: Array<unknown> = [
    ev.pageUrl,
    ev.properties?.path,
    ev.properties?.url,
  ]
  for (const c of candidates) {
    if (typeof c !== 'string' || !c.trim()) continue
    const raw = c.trim()
    // Try to parse as a full URL first; fall back to treating it as a path.
    try {
      const u = new URL(raw)
      return normPath(u.pathname)
    } catch {
      // Not a full URL — treat the string as a path directly.
      return normPath(raw)
    }
  }
  return ''
}

/** Does this event's path match the given article slug? */
function pathMatchesSlug(path: string, slug: string): boolean {
  if (!path || !slug) return false
  const s = slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '')
  if (!s) return false
  const target = `/${s}`
  return path === target || path.endsWith(target) || path.includes(target)
}

/** Hostname from a referrer URL, or null. */
function referrerHost(ref: string | null): string | null {
  if (!ref || !ref.trim()) return null
  try {
    return new URL(ref).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export const GET = withAuth('admin', async (req, user) => {
  try {
    const url = new URL(req.url)
    const searchParams = url.searchParams

    const range = parseRange(searchParams.get('from'), searchParams.get('to'))
    if (!rangeIsValid(range)) {
      return apiError('Invalid date range', 400)
    }

    const propertyId = searchParams.get('propertyId')?.trim() || null

    // Load all SEO articles (platform-scoped collection).
    const articlesSnap = await adminDb.collection('admin_seo_articles').get()
    const articles: SeoArticle[] = articlesSnap.docs.map((d) =>
      serializeArticle(d.id, d.data()),
    )

    const rangeMeta = {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    }
    const buckets = dailyBuckets(range)

    // No analytics property configured: render honestly with zeros.
    if (!propertyId) {
      return apiSuccess({
        range: rangeMeta,
        hasProperty: false,
        articles: articles.map((a) => ({
          id: a.id,
          title: a.title,
          slug: a.slug,
          status: a.status,
          views: 0,
          sessions: 0,
          bounceRate: 0,
          topReferrers: [] as Array<{ label: string; count: number }>,
          socialShares: 0,
          keyword: a.keyword || null,
          keywordPosition: null,
        })),
        series: buckets.map((date) => ({ date, views: 0 })),
        totals: { views: 0, sessions: 0 },
      })
    }

    // Validate property access (throws AnalyticsPropertyAccessError on failure).
    await requireAnalyticsProperty(user, { propertyId })

    // Pull real events + sessions for the property over the range.
    const [events, sessions] = await Promise.all([
      fetchEvents(propertyId, range),
      fetchSessions(propertyId, range),
    ])

    const pageviews = events.filter((e) => PAGEVIEW_EVENTS.has(e.event))
    const shares = events.filter((e) => e.event === 'share')

    // Precompute a path for each pageview / share event once.
    const pageviewPaths = pageviews.map((e) => ({ ev: e, path: eventPath(e) }))
    const sharePaths = shares.map((e) => ({ ev: e, path: eventPath(e) }))

    // Session lookup by id for bounce determination.
    const sessionById = new Map<string, SessionRow>()
    for (const s of sessions) sessionById.set(s.id, s)

    // Time series: total pageviews per day across ALL articles (only those
    // matching some article, since the series describes article traffic).
    const matchedAnySlug = (path: string) =>
      articles.some((a) => pathMatchesSlug(path, a.slug))

    const seriesCounts = new Map<string, number>()
    for (const b of buckets) seriesCounts.set(b, 0)

    let totalViews = 0
    const allMatchedSessionIds = new Set<string>()

    const articleMetrics = articles.map((a) => {
      const matches = pageviewPaths.filter((p) => pathMatchesSlug(p.path, a.slug))
      const views = matches.length

      const sessionIds = new Set<string>()
      for (const m of matches) {
        if (m.ev.sessionId) sessionIds.add(m.ev.sessionId)
      }

      // Bounce rate: among the sessions that touched this article, share that
      // are bounces (per the session's isBounce()).
      let touched = 0
      let bounced = 0
      for (const sid of sessionIds) {
        const s = sessionById.get(sid)
        if (!s) continue
        touched++
        if (isBounce(s)) bounced++
        allMatchedSessionIds.add(sid)
      }
      const bounceRate = touched > 0 ? Math.round((bounced / touched) * 100) : 0

      const topReferrers = countBy(
        matches.map((m) => m.ev),
        (e) => referrerHost(e.referrer),
      ).slice(0, 5)

      const socialShares = sharePaths.filter((p) =>
        pathMatchesSlug(p.path, a.slug),
      ).length

      return {
        id: a.id,
        title: a.title,
        slug: a.slug,
        status: a.status,
        views,
        sessions: sessionIds.size,
        bounceRate,
        topReferrers,
        socialShares,
        keyword: a.keyword || null,
        keywordPosition: null as number | null,
      }
    })

    // Fill the daily series from matched pageviews.
    for (const p of pageviewPaths) {
      if (!matchedAnySlug(p.path)) continue
      const day = dayLabel(p.ev.timestamp)
      if (seriesCounts.has(day)) {
        seriesCounts.set(day, (seriesCounts.get(day) ?? 0) + 1)
        totalViews++
      }
    }

    const series = buckets.map((date) => ({
      date,
      views: seriesCounts.get(date) ?? 0,
    }))

    return apiSuccess({
      range: rangeMeta,
      hasProperty: true,
      articles: articleMetrics,
      series,
      totals: {
        views: totalViews,
        sessions: allMatchedSessionIds.size,
      },
    })
  } catch (err) {
    const propErr = analyticsPropertyErrorResponse(err)
    if (propErr) return propErr
    return apiErrorFromException(err)
  }
})
