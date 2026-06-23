import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import {
  parseRange, rangeIsValid, fetchSessions, fetchEvents, channelOf,
} from '@/lib/analytics/query'
import { computeAttribution, type ConversionJourney } from '@/lib/analytics/attribution-compute'
import { computeGoalCompletions } from '@/lib/analytics/goal-compute'
import { toCsv, csvResponse } from '@/lib/analytics/csv'
import { VALID_ATTRIBUTION_MODELS, type AttributionModel, type AnalyticsGoal, type Touchpoint } from '@/lib/analytics/types'
import type { ApiUser } from '@/lib/api/types'
import type { SessionRow } from '@/lib/analytics/query'

export const dynamic = 'force-dynamic'

/** Build a touchpoint from a session's first-touch attributes. */
function touchpointOf(s: SessionRow): Touchpoint {
  const ch = channelOf(s)
  return {
    source: s.utmSource ?? (ch === 'Direct' ? '(direct)' : ch),
    medium: s.utmMedium ?? '(none)',
    campaign: s.utmCampaign ?? '(none)',
    timestamp: s.startedAt,
  }
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  const modelParam = (searchParams.get('model') ?? 'last') as AttributionModel
  if (!VALID_ATTRIBUTION_MODELS.includes(modelParam)) return apiError('Invalid model', 400)
  const goalId = searchParams.get('goalId')
  const contact = searchParams.get('distinctId') // contact-journey viewer
  const format = searchParams.get('format')

  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const sessions = await fetchSessions(property.id, range)
    const events = await fetchEvents(property.id, range)

    // Determine the conversion set + value per conversion.
    let goal: AnalyticsGoal | null = null
    let goalValue = 1
    let completions: Array<{ distinctId: string; timestamp: number }>
    if (goalId) {
      const snap = await adminDb.collection('product_goals').doc(goalId).get()
      if (!snap.exists) return apiError('Goal not found', 404)
      goal = { id: snap.id, ...snap.data() } as AnalyticsGoal
      if (goal.propertyId !== property.id) return apiError('Goal does not belong to property', 400)
      goalValue = goal.value || 1
      completions = computeGoalCompletions(goal, events, sessions)
        .map(c => ({ distinctId: c.distinctId, timestamp: c.timestamp }))
    } else {
      // Default conversion signal: $identify events (a known/identified visitor).
      completions = events
        .filter(e => e.event === '$identify')
        .map(e => ({ distinctId: e.distinctId, timestamp: e.timestamp }))
    }

    // Sessions grouped by distinctId, sorted ascending.
    const byUser = new Map<string, SessionRow[]>()
    for (const s of sessions) {
      const arr = byUser.get(s.distinctId) ?? []
      arr.push(s)
      byUser.set(s.distinctId, arr)
    }
    for (const arr of byUser.values()) arr.sort((a, b) => a.startedAt - b.startedAt)

    // Contact-journey viewer — single distinctId path (all sessions).
    if (contact) {
      const userSessions = byUser.get(contact) ?? []
      const journey = userSessions.map(s => ({
        sessionId: s.id,
        startedAt: new Date(s.startedAt).toISOString(),
        ...touchpointOf(s),
        landingUrl: s.landingUrl,
      }))
      return apiSuccess({ distinctId: contact, userId: userSessions[0]?.userId ?? null, sessions: journey })
    }

    // Build conversion journeys: touchpoints = sessions up to the conversion time.
    const journeys: ConversionJourney[] = []
    for (const c of completions) {
      const userSessions = byUser.get(c.distinctId) ?? []
      const tps = userSessions
        .filter(s => s.startedAt <= c.timestamp + 1000)
        .map(touchpointOf)
      if (tps.length === 0) continue
      journeys.push({
        distinctId: c.distinctId,
        userId: userSessions[0]?.userId ?? null,
        touchpoints: tps,
        convertedAt: c.timestamp,
        value: goalValue,
      })
    }

    const { channels, paths } = computeAttribution(journeys, modelParam)

    if (format === 'csv') {
      const csv = toCsv(
        ['channel', 'source', 'medium', 'conversions', 'value'],
        channels.map(c => ({ ...c })),
      )
      return csvResponse(`attribution-${modelParam}.csv`, csv)
    }

    return apiSuccess({
      model: modelParam,
      goal: goal ? { id: goal.id, name: goal.name, value: goal.value } : null,
      totalConversions: journeys.length,
      channels,
      topPaths: paths.slice(0, 20),
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-attribution]', e)
    return apiError('Failed to compute attribution', 500)
  }
})
