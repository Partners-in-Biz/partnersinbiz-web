import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import {
  parseRange, rangeIsValid, parseSegment, applySegmentToSessions,
  fetchSessions, sessionDurationSec, isBounce, countBy, channelOf,
} from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

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

    const total = sessions.length
    const bounces = sessions.filter(isBounce).length
    const bounceRate = total > 0 ? Math.round((bounces / total) * 1000) / 10 : 0
    const avgDuration = total > 0
      ? Math.round(sessions.reduce((a, s) => a + sessionDurationSec(s), 0) / total)
      : 0

    const devices = countBy(sessions, s => s.device)
    const countries = countBy(sessions, s => s.country)
    const sources = countBy(sessions, s => channelOf(s))
    const referrers = countBy(sessions, s => {
      if (!s.referrer) return null
      try { return new URL(s.referrer).hostname.replace(/^www\./, '') } catch { return s.referrer }
    }).slice(0, 15)

    // utm breakdown (source / medium pairs)
    const utmBreakdown = countBy(sessions, s =>
      s.utmSource ? `${s.utmSource} / ${s.utmMedium ?? '(none)'}` : null,
    ).slice(0, 15)

    return apiSuccess({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      totals: { sessions: total, bounceRate, avgDurationSec: avgDuration },
      devices,
      countries: countries.slice(0, 20),
      sources,
      referrers,
      utmBreakdown,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-traffic]', e)
    return apiError('Failed to compute traffic', 500)
  }
})
