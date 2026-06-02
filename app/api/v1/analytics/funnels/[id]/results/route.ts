import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeFunnelResults } from '@/lib/analytics/funnel-compute'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'
import type { FunnelWindow } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req: NextRequest, _user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return apiError('from and to query params are required', 400)
  if (isNaN(new Date(from).getTime())) return apiError('Invalid from date', 400)
  if (isNaN(new Date(to).getTime())) return apiError('Invalid to date', 400)

  try {
    const funnelSnap = await adminDb.collection('product_funnels').doc(id).get()
    if (!funnelSnap.exists) return apiError('Funnel not found', 404)

    const funnel = funnelSnap.data()!
    const property = await requireAnalyticsProperty(_user, { propertyId: funnel.propertyId })
    const stepEvents = funnel.steps.map((s: { event: string }) => s.event) as string[]

    const eventsSnap = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .where('serverTime', '>=', Timestamp.fromDate(new Date(from)))
      .where('serverTime', '<=', Timestamp.fromDate(new Date(to)))
      .orderBy('serverTime', 'asc')
      .limit(10000)
      .get()

    const rawEvents = eventsSnap.docs
      .map(d => {
        const data = d.data()
        return {
          event: data.event as string,
          distinctId: data.distinctId as string,
          sessionId: data.sessionId as string,
          timestamp: data.serverTime?.toMillis?.()
            ?? data.serverTime?.toDate?.()?.getTime?.()
            ?? ((data.serverTime?._seconds ?? data.serverTime?.seconds ?? 0) * 1000),
        }
      })
      .filter(e => stepEvents.includes(e.event))

    const results = computeFunnelResults(rawEvents, funnel.steps, funnel.window as FunnelWindow)
    return apiSuccess(results)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnel-results]', e)
    return apiError('Failed to compute funnel results', 500)
  }
})
