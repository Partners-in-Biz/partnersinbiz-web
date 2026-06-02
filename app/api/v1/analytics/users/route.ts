import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const rawLimit = parseInt(searchParams.get('limit') ?? '200', 10)
  const limit = isNaN(rawLimit) ? 200 : Math.min(rawLimit, 500)

  if (!propertyId) return apiError('propertyId required', 400)

  let snap: FirebaseFirestore.QuerySnapshot
  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    snap = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .orderBy('serverTime', 'desc')
      .limit(limit * 10)
      .get()
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-users-get]', e)
    return apiError('Failed to query users', 500)
  }

  const seen = new Map<string, {
    distinctId: string
    userId: string | null
    firstSeen: string
    lastSeen: string
    eventCount: number
  }>()

  for (const doc of snap.docs) {
    const d = doc.data()
    const key = d.distinctId as string
    if (!key) continue
    const ts = (d.serverTime?.toDate?.() ?? new Date()).toISOString()
    if (!seen.has(key)) {
      seen.set(key, { distinctId: key, userId: d.userId ?? null, firstSeen: ts, lastSeen: ts, eventCount: 1 })
    } else {
      const entry = seen.get(key)!
      entry.eventCount++
      if (ts < entry.firstSeen) entry.firstSeen = ts
      if (ts > entry.lastSeen) entry.lastSeen = ts
    }
  }

  const users = [...seen.values()].slice(0, limit)
  return apiSuccess({ users, total: users.length })
})
