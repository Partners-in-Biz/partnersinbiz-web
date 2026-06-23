import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { parseRange, rangeIsValid, fetchEvents, fetchSessions } from '@/lib/analytics/query'
import { computeGoalCompletions, goalTimeSeries, revenueByChannel } from '@/lib/analytics/goal-compute'
import type { ApiUser } from '@/lib/api/types'
import type { AnalyticsGoal } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!rangeIsValid(range)) return apiError('Invalid date range', 400)

  try {
    const snap = await adminDb.collection('product_goals').doc(id).get()
    if (!snap.exists) return apiError('Goal not found', 404)
    const goal = { id: snap.id, ...snap.data() } as AnalyticsGoal
    const property = await requireAnalyticsProperty(user, { propertyId: goal.propertyId })

    const events = goal.type === 'duration' ? [] : await fetchEvents(property.id, range)
    const sessions = await fetchSessions(property.id, range)

    const completions = computeGoalCompletions(goal, events, sessions)
    const totalSessions = sessions.length
    const completionRate = totalSessions > 0
      ? Math.round((completions.length / totalSessions) * 1000) / 10
      : 0

    const series = goalTimeSeries(completions, range, goal.value)
    const byChannel = revenueByChannel(completions, goal.value)
    const totalValue = completions.length * goal.value

    return apiSuccess({
      goal: { id: goal.id, name: goal.name, type: goal.type, target: goal.target, value: goal.value },
      completions: completions.length,
      totalSessions,
      completionRate,
      totalValue,
      series,
      revenueByChannel: byChannel,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-goal-results]', e)
    return apiError('Failed to compute goal results', 500)
  }
})
