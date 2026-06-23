import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { tsToMillis } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

/**
 * Install verification (US-129): returns the property's ingestKey + propertyId
 * plus whether ANY events have been received, the most recent event time, and
 * a 24h count — so the install page can show a real "verified" status.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })

    const latest = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .orderBy('serverTime', 'desc')
      .limit(1)
      .get()

    const received = !latest.empty
    const lastEventAt = received ? tsToMillis(latest.docs[0].data().serverTime) : null

    let last24h = 0
    if (received) {
      const since = new Date(Date.now() - 24 * 3600 * 1000)
      const cnt = await adminDb.collection('product_events')
        .where('propertyId', '==', property.id)
        .where('serverTime', '>=', since)
        .count()
        .get()
      last24h = cnt.data().count
    }

    return apiSuccess({
      propertyId: property.id,
      ingestKey: property.ingestKey,
      domain: property.domain,
      received,
      lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
      last24h,
    })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-verify]', e)
    return apiError('Failed to verify install', 500)
  }
})
