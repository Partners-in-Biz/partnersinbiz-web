import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { fetchEvents, countBy } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const ACTIVE_WINDOW_MS = 5 * 60 * 1000   // "active now"
const TREND_WINDOW_MS = 30 * 60 * 1000   // last-30-min chart

/**
 * Realtime dashboard data (US-141): active visitors, top active pages,
 * last-30-min per-minute chart, and top traffic sources right now.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const now = Date.now()
    const events = await fetchEvents(property.id, { from: new Date(now - TREND_WINDOW_MS), to: new Date(now) })

    const activeEvents = events.filter(e => e.timestamp >= now - ACTIVE_WINDOW_MS)
    const activeVisitors = new Set(activeEvents.map(e => e.distinctId)).size

    // Top active pages (pageviews in active window).
    const topPages = countBy(
      activeEvents.filter(e => e.event === '$pageview'),
      e => {
        const url = e.pageUrl ?? (e.properties?.['$current_url'] as string) ?? null
        if (!url) return null
        try { return new URL(url).pathname } catch { return url }
      },
    ).slice(0, 10)

    // Top traffic sources now (referrer host of active events).
    const topSources = countBy(activeEvents, e => {
      if (!e.referrer) return 'Direct'
      try { return new URL(e.referrer).hostname.replace(/^www\./, '') } catch { return e.referrer }
    }).slice(0, 8)

    // Last-30-min per-minute event count.
    const minutes: Array<{ minute: string; events: number; visitors: number }> = []
    for (let i = 29; i >= 0; i--) {
      const start = now - i * 60000
      const end = start + 60000
      const bucket = events.filter(e => e.timestamp >= start && e.timestamp < end)
      const d = new Date(start)
      minutes.push({
        minute: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        events: bucket.length,
        visitors: new Set(bucket.map(e => e.distinctId)).size,
      })
    }

    return apiSuccess({
      activeVisitors,
      activeWindowMin: ACTIVE_WINDOW_MS / 60000,
      topPages,
      topSources,
      trend: minutes,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-realtime]', e)
    return apiError('Failed to compute realtime', 500)
  }
})
