import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (req: NextRequest, _user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params

  try {
    const sessionSnap = await adminDb.collection('product_sessions').doc(id).get()
    if (!sessionSnap.exists) return apiError('Session not found', 404)
    await requireAnalyticsProperty(_user, { propertyId: sessionSnap.data()?.propertyId })

    const eventsSnap = await adminDb.collection('product_events')
      .where('sessionId', '==', id)
      .orderBy('serverTime', 'asc')
      .limit(1000)
      .get()

    const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    return apiSuccess({ session: { id: sessionSnap.id, ...sessionSnap.data() }, events })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-session-detail]', e)
    return apiError('Failed to fetch session', 500)
  }
})
