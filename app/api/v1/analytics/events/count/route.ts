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

  if (from && isNaN(new Date(from).getTime())) return apiError('Invalid from date', 400)
  if (to && isNaN(new Date(to).getTime())) return apiError('Invalid to date', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    let q = adminDb.collection('product_events')
      .where('propertyId', '==', property.id) as FirebaseFirestore.Query

    if (from) q = q.where('serverTime', '>=', Timestamp.fromDate(new Date(from)))
    if (to) q = q.where('serverTime', '<=', Timestamp.fromDate(new Date(to)))

    q = q.orderBy('serverTime', 'desc').limit(5000)

    const snap = await q.get()
    const counts = new Map<string, number>()
    for (const doc of snap.docs) {
      const ev = doc.data().event as string
      counts.set(ev, (counts.get(ev) ?? 0) + 1)
    }

    const groups = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }))

    return apiSuccess({ groups, total: snap.docs.length })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-events-count]', e)
    return apiError('Failed to count events', 500)
  }
})
