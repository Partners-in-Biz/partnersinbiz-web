import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import {
  parseRange, rangeIsValid, parseSegment, applySegmentToSessions,
  fetchSessions, fetchEvents, sessionDurationSec, countBy, classifyVisitors,
} from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

/** Parse browser + OS from a user-agent string (lightweight, no deps). */
function parseUaBrowser(ua: string): string {
  if (/edg/i.test(ua)) return 'Edge'
  if (/chrome|crios/i.test(ua)) return 'Chrome'
  if (/firefox|fxios/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua)) return 'Safari'
  if (/opr|opera/i.test(ua)) return 'Opera'
  return 'Other'
}
function parseUaOs(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  if (/mac os x/i.test(ua)) return 'macOS'
  if (/android/i.test(ua)) return 'Android'
  if (/linux/i.test(ua)) return 'Linux'
  return 'Other'
}

/** ISO week label e.g. 2026-W26. */
function isoWeek(ms: number): string {
  const d = new Date(ms)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

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
    const classes = classifyVisitors(sessions)
    let newCount = 0, returningCount = 0
    const seen = new Set<string>()
    for (const s of sessions) {
      if (seen.has(s.distinctId)) continue
      seen.add(s.distinctId)
      if (classes.get(s.distinctId) === 'returning') returningCount++
      else newCount++
    }

    const avgDuration = total > 0
      ? Math.round(sessions.reduce((a, s) => a + sessionDurationSec(s), 0) / total)
      : 0
    const totalPages = sessions.reduce((a, s) => a + s.pageCount, 0)
    const pagesPerSession = total > 0 ? Math.round((totalPages / total) * 100) / 100 : 0

    const devices = countBy(sessions, s => s.device)
    const countries = countBy(sessions, s => s.country).slice(0, 20)

    // browser/OS need user-agent; sessions don't store UA, so derive from events.
    const events = await fetchEvents(property.id, range)
    const sessionIds = new Set(sessions.map(s => s.id))
    const uaBySession = new Map<string, string>()
    for (const e of events) {
      if (!sessionIds.has(e.sessionId)) continue
      const ua = (e.properties?.['$user_agent'] as string) ?? null
      if (ua && !uaBySession.has(e.sessionId)) uaBySession.set(e.sessionId, ua)
    }
    const uaList = [...uaBySession.values()]
    const browsers = countBy(uaList, ua => parseUaBrowser(ua))
    const oses = countBy(uaList, ua => parseUaOs(ua))

    // Acquisition-week cohort table: first session week per distinctId.
    const firstWeek = new Map<string, number>()
    for (const s of sessions) {
      const prev = firstWeek.get(s.distinctId)
      if (prev === undefined || s.startedAt < prev) firstWeek.set(s.distinctId, s.startedAt)
    }
    const cohortCounts = new Map<string, number>()
    for (const ms of firstWeek.values()) {
      const w = isoWeek(ms)
      cohortCounts.set(w, (cohortCounts.get(w) ?? 0) + 1)
    }
    const cohorts = [...cohortCounts.entries()]
      .map(([week, visitors]) => ({ week, newVisitors: visitors }))
      .sort((a, b) => a.week.localeCompare(b.week))

    return apiSuccess({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      visitors: { new: newCount, returning: returningCount, total: newCount + returningCount },
      engagement: { avgDurationSec: avgDuration, pagesPerSession },
      devices,
      browsers,
      operatingSystems: oses,
      countries,
      cohorts,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-audience]', e)
    return apiError('Failed to compute audience', 500)
  }
})
