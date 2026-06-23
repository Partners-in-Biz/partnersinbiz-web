import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import {
  parseRange, rangeIsValid, fetchSessions, sessionDurationSec, isBounce,
} from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

/**
 * Campaign breakdown (US-131) — groups sessions by source/medium/campaign and
 * reports sessions, visitors, bounce rate and avg duration for each.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const sessions = await fetchSessions(property.id, range)

    interface Agg { sessions: number; visitors: Set<string>; bounces: number; durationSum: number }
    const groups = new Map<string, Agg>()

    for (const s of sessions) {
      if (!s.utmSource && !s.utmMedium && !s.utmCampaign) continue // only attributed traffic
      const key = `${s.utmSource ?? '(none)'}|${s.utmMedium ?? '(none)'}|${s.utmCampaign ?? '(none)'}`
      const g = groups.get(key) ?? { sessions: 0, visitors: new Set<string>(), bounces: 0, durationSum: 0 }
      g.sessions++
      g.visitors.add(s.distinctId)
      if (isBounce(s)) g.bounces++
      g.durationSum += sessionDurationSec(s)
      groups.set(key, g)
    }

    const rows = [...groups.entries()].map(([key, g]) => {
      const [source, medium, campaign] = key.split('|')
      return {
        source, medium, campaign,
        sessions: g.sessions,
        visitors: g.visitors.size,
        bounceRate: g.sessions > 0 ? Math.round((g.bounces / g.sessions) * 1000) / 10 : 0,
        avgDurationSec: g.sessions > 0 ? Math.round(g.durationSum / g.sessions) : 0,
      }
    }).sort((a, b) => b.sessions - a.sessions)

    return apiSuccess({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      campaigns: rows,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-campaigns]', e)
    return apiError('Failed to compute campaigns', 500)
  }
})
