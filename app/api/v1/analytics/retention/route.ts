import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeRetention } from '@/lib/analytics/retention-compute'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { RetentionGranularity } from '@/lib/analytics/types'
import type { ApiUser } from '@/lib/api/types'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const cohortEvent = searchParams.get('cohortEvent') ?? '$pageview'
  const returnEvent = searchParams.get('returnEvent') ?? '$pageview'
  const granularity = (searchParams.get('granularity') ?? 'day') as RetentionGranularity
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!propertyId) return apiError('propertyId required', 400)
  if (!from || !to) return apiError('from and to are required', 400)

  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (isNaN(fromDate.getTime())) return apiError('Invalid from date', 400)
  if (isNaN(toDate.getTime())) return apiError('Invalid to date', 400)
  if (!['day', 'week'].includes(granularity)) return apiError('granularity must be day or week', 400)

  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const snap = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .where('serverTime', '>=', fromDate)
      .where('serverTime', '<=', toDate)
      .orderBy('serverTime', 'desc')
      .limit(20000)
      .get()

    const events = snap.docs
      .map(d => {
        const data = d.data()
        const ts = data.serverTime?.toDate?.()?.getTime?.() ?? 0
        return { distinctId: data.distinctId as string, event: data.event as string, timestamp: ts }
      })
      .filter(e =>
        (e.event === cohortEvent || e.event === returnEvent) &&
        e.timestamp >= fromMs &&
        e.timestamp <= toMs
      )

    const result = computeRetention(events, cohortEvent, returnEvent, granularity, fromMs, toMs)

    return apiSuccess({ result })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-retention]', e)
    return apiError('Failed to compute retention', 500)
  }
})
