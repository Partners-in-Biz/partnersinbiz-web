import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import {
  parseRange, rangeIsValid, parseSegment, applySegmentToSessions,
  fetchSessions, fetchEvents, sessionDurationSec, isBounce,
  countBy, dailyBuckets, dayLabel, channelOf,
} from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const REALTIME_WINDOW_MS = 5 * 60 * 1000

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const segment = parseSegment(searchParams)

    const allSessions = await fetchSessions(property.id, range)
    const sessions = await applySegmentToSessions(allSessions, segment, property.orgId)

    // Pageview events for top-pages table (real $pageview events).
    const pageviews = await fetchEvents(property.id, range, '$pageview')

    const totalSessions = sessions.length
    const uniqueVisitors = new Set(sessions.map(s => s.distinctId)).size
    const totalPageviews = sessions.reduce((a, s) => a + s.pageCount, 0)
    const bounces = sessions.filter(isBounce).length
    const bounceRate = totalSessions > 0 ? Math.round((bounces / totalSessions) * 1000) / 10 : 0
    const avgDuration = totalSessions > 0
      ? Math.round(sessions.reduce((a, s) => a + sessionDurationSec(s), 0) / totalSessions)
      : 0
    const pagesPerSession = totalSessions > 0
      ? Math.round((totalPageviews / totalSessions) * 100) / 100
      : 0

    // Sessions-over-time line (daily buckets).
    const buckets = dailyBuckets(range)
    const dayCounts = new Map<string, number>(buckets.map(b => [b, 0]))
    for (const s of sessions) {
      const d = dayLabel(s.startedAt)
      if (dayCounts.has(d)) dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1)
    }
    const sessionsSeries = buckets.map(d => ({ date: d, sessions: dayCounts.get(d) ?? 0 }))

    // Traffic sources donut (by channel).
    const trafficSources = countBy(sessions, s => channelOf(s)).slice(0, 8)

    // Top-10 pages (by pageview event count, normalised path).
    const topPages = countBy(pageviews, e => {
      const url = e.pageUrl ?? (e.properties?.['$current_url'] as string) ?? null
      if (!url) return null
      try { return new URL(url).pathname } catch { return url }
    }).slice(0, 10)

    // Real-time active visitors (distinctIds with events in last 5 min).
    const liveEvents = await fetchEvents(
      property.id,
      { from: new Date(Date.now() - REALTIME_WINDOW_MS), to: new Date() },
    )
    const realtimeVisitors = new Set(liveEvents.map(e => e.distinctId)).size

    return apiSuccess({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      kpis: {
        sessions: totalSessions,
        uniqueVisitors,
        pageviews: totalPageviews,
        bounceRate,
        avgDurationSec: avgDuration,
        pagesPerSession,
        realtimeVisitors,
      },
      sessionsSeries,
      trafficSources,
      topPages,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-overview]', e)
    return apiError('Failed to compute overview', 500)
  }
})
