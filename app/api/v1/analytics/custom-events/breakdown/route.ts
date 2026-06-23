import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { parseRange, rangeIsValid, fetchEvents } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

/** Per-event property-value breakdown from real product_events. */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const event = searchParams.get('event')
  if (!propertyId) return apiError('propertyId is required', 400)
  if (!event) return apiError('event is required', 400)

  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const events = await fetchEvents(property.id, range, event)

    // Count distinct values per property key (top values only).
    const byKey = new Map<string, Map<string, number>>()
    for (const e of events) {
      for (const [k, v] of Object.entries(e.properties ?? {})) {
        if (k.startsWith('$')) continue
        const val = v === null || v === undefined ? '(null)' : String(v).slice(0, 80)
        const m = byKey.get(k) ?? new Map<string, number>()
        m.set(val, (m.get(val) ?? 0) + 1)
        byKey.set(k, m)
      }
    }

    const breakdown = [...byKey.entries()].map(([key, values]) => ({
      key,
      values: [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    }))

    return apiSuccess({
      event,
      total: events.length,
      uniqueUsers: new Set(events.map(e => e.distinctId)).size,
      breakdown,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-custom-events-breakdown]', e)
    return apiError('Failed to compute breakdown', 500)
  }
})
