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

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  if (from && isNaN(new Date(from).getTime())) return apiError('Invalid from date', 400)
  if (to && isNaN(new Date(to).getTime())) return apiError('Invalid to date', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    let q = adminDb.collection('product_sessions')
      .where('propertyId', '==', property.id) as FirebaseFirestore.Query

    if (from) q = q.where('startedAt', '>=', Timestamp.fromDate(new Date(from)))
    if (to) q = q.where('startedAt', '<=', Timestamp.fromDate(new Date(to)))

    q = q.orderBy('startedAt', 'desc').limit(limit)

    const snap = await q.get()
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    return apiSuccess(data)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-sessions-get]', e)
    return apiError('Failed to query sessions', 500)
  }
})
