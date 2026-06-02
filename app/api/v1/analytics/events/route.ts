import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  const event = searchParams.get('event')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const distinctId = searchParams.get('distinctId')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500)

  if (from && isNaN(new Date(from).getTime())) return apiError('Invalid from date', 400)
  if (to && isNaN(new Date(to).getTime())) return apiError('Invalid to date', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    let q = adminDb.collection('product_events')
      .where('propertyId', '==', property.id) as FirebaseFirestore.Query

    if (event) q = q.where('event', '==', event)
    if (distinctId) q = q.where('distinctId', '==', distinctId)
    if (from) q = q.where('serverTime', '>=', Timestamp.fromDate(new Date(from)))
    if (to) q = q.where('serverTime', '<=', Timestamp.fromDate(new Date(to)))

    q = q.orderBy('serverTime', 'desc').limit(limit)

    const snap = await q.get()
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    return apiSuccess(data)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-events-get]', e)
    return apiError('Failed to query events', 500)
  }
})
