import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import type { ApiUser } from '@/lib/api/types'

type RouteContext = { params: Promise<{ distinctId: string }> }

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { distinctId } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const rawLimit = parseInt(searchParams.get('limit') ?? '500', 10)
  const limit = isNaN(rawLimit) ? 500 : Math.min(rawLimit, 2000)

  if (!propertyId) return apiError('propertyId required', 400)

  let eventsSnap: FirebaseFirestore.QuerySnapshot
  let sessionsSnap: FirebaseFirestore.QuerySnapshot
  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    ;[eventsSnap, sessionsSnap] = await Promise.all([
      adminDb.collection('product_events')
        .where('propertyId', '==', property.id)
        .where('distinctId', '==', distinctId)
        .orderBy('serverTime', 'desc')
        .limit(limit)
        .get(),
      adminDb.collection('product_sessions')
        .where('propertyId', '==', property.id)
        .where('distinctId', '==', distinctId)
        .orderBy('startedAt', 'desc')
        .limit(50)
        .get(),
    ])
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-user-get]', e)
    return apiError('Failed to query user', 500)
  }

  if (eventsSnap.empty) return apiError('User not found', 404)

  const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  return apiSuccess({ distinctId, events, sessions })
})

export const DELETE = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { distinctId } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) return apiError('propertyId required', 400)

  let property: { id: string }
  try {
    property = await requireAnalyticsProperty(user, { propertyId })
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-user-delete-property]', e)
    return apiError('Failed to verify property', 500)
  }

  let totalEvents = 0
  let totalSessions = 0

  while (true) {
    const snap = await adminDb.collection('product_events')
      .where('propertyId', '==', property.id)
      .where('distinctId', '==', distinctId)
      .limit(490)
      .get()
    if (snap.empty) break
    const b = adminDb.batch()
    for (const doc of snap.docs) b.delete(doc.ref)
    await b.commit()
    totalEvents += snap.size
    if (snap.size < 490) break
  }

  while (true) {
    const snap = await adminDb.collection('product_sessions')
      .where('propertyId', '==', property.id)
      .where('distinctId', '==', distinctId)
      .limit(490)
      .get()
    if (snap.empty) break
    const b = adminDb.batch()
    for (const doc of snap.docs) b.delete(doc.ref)
    await b.commit()
    totalSessions += snap.size
    if (snap.size < 490) break
  }

  return apiSuccess({ deleted: { events: totalEvents, sessions: totalSessions } })
})
