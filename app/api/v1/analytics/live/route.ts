import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

const LIVE_WINDOW_MS = 5 * 60 * 1000
const MAX_LIVE_EVENTS = 100

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) return apiError('propertyId required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    const since = new Date(Date.now() - LIVE_WINDOW_MS)

    const snap = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .where('serverTime', '>=', since)
      .orderBy('serverTime', 'desc')
      .limit(MAX_LIVE_EVENTS)
      .get()

    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    return apiSuccess({ events, since: since.toISOString() })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-live]', e)
    return apiError('Failed to query live events', 500)
  }
})
